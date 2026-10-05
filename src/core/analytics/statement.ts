/**
 * Estado de conciliación bancaria en formato tradicional:
 *
 *   Saldo según libros
 *   (−) Débitos del banco no registrados en libros (GMF, pagos PSE, cheques cobrados…)
 *   (+) Créditos del banco no registrados en libros (consignaciones sin contabilizar)
 *   (+) Egresos registrados en libros que el banco aún no debita (cheques pendientes de cobro)
 *   (−) Ingresos registrados en libros que el banco aún no acredita (consignaciones en tránsito)
 *   (±) Diferencias de valor en partidas cruzadas
 *   = Saldo según banco
 *
 * Es lo que se le muestra a quien pregunta "¿de dónde sale la diferencia?".
 */

import type { BankTx, LedgerTx, ReconciliationResult } from '../types';
import type { Kpis } from './kpis';
import { round2 } from '../normalize/money';

export interface StatementItem {
  id: string;
  /** Fila del archivo original, para ubicarla en Excel. */
  row: number;
  date: Date | null;
  description: string;
  reference: string;
  /** Valor absoluto de la partida. */
  value: number;
}

export type StatementSectionId =
  | 'bancoDebitos'
  | 'bancoCreditos'
  | 'libroEgresos'
  | 'libroIngresos'
  | 'diferenciasCruces';

export interface StatementSection {
  id: StatementSectionId;
  title: string;
  /** Qué hacer para llevarla al extracto y por qué. */
  hint: string;
  /** +1 suma al saldo en libros, −1 resta. */
  sign: 1 | -1;
  items: StatementItem[];
  /** Suma de los valores absolutos de las partidas. */
  total: number;
}

export interface ReconciliationStatement {
  saldoLibros: number;
  saldoBanco: number;
  sections: StatementSection[];
  /** saldoLibros + Σ (sign × total) de las secciones. */
  saldoBancoConciliado: number;
  /** saldoBanco − saldoBancoConciliado. Debe ser 0. */
  sinExplicar: number;
}

export function buildStatement(
  bank: BankTx[],
  ledger: LedgerTx[],
  result: ReconciliationResult,
  kpis: Kpis,
): ReconciliationStatement {
  const bankDebits: StatementItem[] = [];
  const bankCredits: StatementItem[] = [];
  const ledgerOut: StatementItem[] = [];
  const ledgerIn: StatementItem[] = [];
  const diffs: StatementItem[] = [];

  for (const b of bank) {
    if (result.byBank.has(b.id)) continue;
    const item: StatementItem = {
      id: b.id,
      row: b.rowIndex,
      date: b.date,
      description: b.description || 'Sin descripción',
      reference: [b.reference, b.document, b.transactionNumber].filter(Boolean).join(' · '),
      value: round2(Math.abs(b.amount)),
    };
    (b.amount < 0 ? bankDebits : bankCredits).push(item);
  }

  for (const l of ledger) {
    if (result.byLedger.has(l.id)) continue;
    const item: StatementItem = {
      id: l.id,
      row: l.rowIndex,
      date: l.date,
      description: [l.thirdPartyName, l.description].filter(Boolean).join(' · ') || 'Sin descripción',
      reference: l.documentNumber,
      value: round2(Math.abs(l.amount)),
    };
    (l.amount < 0 ? ledgerOut : ledgerIn).push(item);
  }

  const bankById = new Map(bank.map((b) => [b.id, b]));
  const ledgerById = new Map(ledger.map((l) => [l.id, l]));
  for (const m of result.matches) {
    if (Math.abs(m.amountDiff) <= 0.004) continue;
    const b = bankById.get(m.bankId);
    const l = ledgerById.get(m.ledgerId);
    diffs.push({
      id: m.id,
      row: l?.rowIndex ?? b?.rowIndex ?? 0,
      date: b?.date ?? l?.date ?? null,
      description:
        (m.groupId ? 'Grupo ' + m.groupId + ' · ' : '') +
        (l?.thirdPartyName || b?.description || 'Cruce') +
        ' — banco ' + (b?.amount ?? 0).toLocaleString('es-CO') +
        ' vs libros ' + (l?.amount ?? 0).toLocaleString('es-CO'),
      reference: l?.documentNumber ?? '',
      // Con signo: banco − libros. Se suma tal cual al saldo en libros.
      value: round2(m.amountDiff),
    });
  }

  const byDate = (a: StatementItem, b: StatementItem) =>
    (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || a.row - b.row;
  const sum = (xs: StatementItem[]) => round2(xs.reduce((acc, x) => acc + x.value, 0));

  const sections: StatementSection[] = [
    {
      id: 'bancoDebitos',
      title: 'Débitos del banco no registrados en libros',
      hint: 'Pagos, cargos o cheques que el banco ya descontó y la contabilidad no tiene. Deben registrarse en el auxiliar.',
      sign: -1,
      items: bankDebits.sort(byDate),
      total: sum(bankDebits),
    },
    {
      id: 'bancoCreditos',
      title: 'Créditos del banco no registrados en libros',
      hint: 'Consignaciones o abonos que el banco ya acreditó y la contabilidad no tiene. Deben registrarse en el auxiliar.',
      sign: 1,
      items: bankCredits.sort(byDate),
      total: sum(bankCredits),
    },
    {
      id: 'libroEgresos',
      title: 'Egresos en libros aún no debitados por el banco',
      hint: 'Cheques o pagos registrados que no aparecen en el extracto: pendientes de cobro o registrados por error. Verificar en el extracto siguiente.',
      sign: 1,
      items: ledgerOut.sort(byDate),
      total: sum(ledgerOut),
    },
    {
      id: 'libroIngresos',
      title: 'Ingresos en libros aún no acreditados por el banco',
      hint: 'Consignaciones registradas que el banco todavía no refleja (en tránsito). Verificar en el extracto siguiente.',
      sign: -1,
      items: ledgerIn.sort(byDate),
      total: sum(ledgerIn),
    },
    {
      id: 'diferenciasCruces',
      title: 'Diferencias de valor en partidas cruzadas',
      hint: 'El movimiento está en ambos lados pero por distinto valor (centavos, retenciones, comisiones). Signo: banco − libros.',
      sign: 1,
      items: diffs.sort(byDate),
      total: sum(diffs),
    },
  ];

  const saldoBancoConciliado = round2(
    kpis.saldoContable + sections.reduce((acc, s) => acc + s.sign * s.total, 0),
  );

  return {
    saldoLibros: kpis.saldoContable,
    saldoBanco: kpis.saldoBanco,
    sections,
    saldoBancoConciliado,
    sinExplicar: round2(kpis.saldoBanco - saldoBancoConciliado),
  };
}
