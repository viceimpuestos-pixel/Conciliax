/**
 * Indicadores ejecutivos de la conciliación.
 */

import type { BankTx, LedgerTx, MatchStatus, ReconciliationResult } from '../types';
import { round2 } from '../normalize/money';

export interface Kpis {
  /** Saldo final del extracto (columna Saldo) o neto de movimientos. */
  saldoBanco: number;
  saldoBancoEsNeto: boolean;
  /** Saldo según contabilidad (neto de débitos - créditos del auxiliar). */
  saldoContable: number;
  /** Banco - Contabilidad. */
  diferencia: number;

  totalMovBanco: number;
  totalMovContable: number;

  conciliados: number;
  probables: number;
  pendientes: number;
  noConciliados: number;
  duplicados: number;
  difValor: number;
  difFecha: number;
  ignorados: number;

  valorConciliado: number;
  valorPendiente: number;
  valorNoConciliado: number;

  porcentajeConciliacion: number;
  porcentajeValorConciliado: number;

  ingresosBanco: number;
  egresosBanco: number;
  ingresosContables: number;
  egresosContables: number;

  /** Diferencia acumulada de los cruces con diferencia de valor. */
  diferenciaEnCruces: number;
}

const CONCILIADOS: MatchStatus[] = ['CONCILIADO'];
const PENDIENTES: MatchStatus[] = ['PROBABLE', 'REVISION', 'DIF_VALOR', 'DIF_FECHA'];

export function isConciliado(s: MatchStatus): boolean {
  return CONCILIADOS.includes(s);
}
export function isPendiente(s: MatchStatus): boolean {
  return PENDIENTES.includes(s);
}

export function computeKpis(
  bank: BankTx[],
  ledger: LedgerTx[],
  result: ReconciliationResult,
): Kpis {
  let ingresosBanco = 0;
  let egresosBanco = 0;
  for (const b of bank) {
    ingresosBanco += b.credit;
    egresosBanco += b.debit;
  }

  let ingresosContables = 0;
  let egresosContables = 0;
  for (const l of ledger) {
    if (l.amount >= 0) ingresosContables += Math.abs(l.amount);
    else egresosContables += Math.abs(l.amount);
  }

  // Saldo bancario: si el extracto trae columna de saldo, se usa el último valor.
  const withBalance = bank.filter((b) => b.balance !== null && Number.isFinite(b.balance));
  const ordered = withBalance
    .slice()
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || a.rowIndex - b.rowIndex);
  const saldoBancoEsNeto = ordered.length === 0;
  const saldoBanco = saldoBancoEsNeto
    ? round2(ingresosBanco - egresosBanco)
    : round2(ordered[ordered.length - 1].balance as number);

  const saldoContable = round2(ledger.reduce((acc, l) => acc + l.amount, 0));

  let conciliados = 0;
  let probables = 0;
  let pendientes = 0;
  let noConciliados = 0;
  let duplicados = 0;
  let difValor = 0;
  let difFecha = 0;
  let ignorados = 0;

  let valorConciliado = 0;
  let valorPendiente = 0;
  let valorNoConciliado = 0;

  for (const b of bank) {
    const s = result.bankStatus.get(b.id) ?? 'NO_CONCILIADO';
    const abs = Math.abs(b.amount);
    switch (s) {
      case 'CONCILIADO':
        conciliados++;
        valorConciliado += abs;
        break;
      case 'PROBABLE':
        probables++;
        valorPendiente += abs;
        break;
      case 'REVISION':
        pendientes++;
        valorPendiente += abs;
        break;
      case 'DIF_VALOR':
        difValor++;
        valorPendiente += abs;
        break;
      case 'DIF_FECHA':
        difFecha++;
        valorPendiente += abs;
        break;
      case 'DUPLICADO':
        duplicados++;
        valorNoConciliado += abs;
        break;
      case 'IGNORADO':
        ignorados++;
        break;
      default:
        noConciliados++;
        valorNoConciliado += abs;
    }
  }

  const base = bank.length - ignorados;
  const totalValor = valorConciliado + valorPendiente + valorNoConciliado;

  const diferenciaEnCruces = round2(
    result.matches.reduce((acc, m) => acc + Math.abs(m.amountDiff), 0),
  );

  return {
    saldoBanco,
    saldoBancoEsNeto,
    saldoContable,
    diferencia: round2(saldoBanco - saldoContable),
    totalMovBanco: bank.length,
    totalMovContable: ledger.length,
    conciliados,
    probables,
    pendientes,
    noConciliados,
    duplicados,
    difValor,
    difFecha,
    ignorados,
    valorConciliado: round2(valorConciliado),
    valorPendiente: round2(valorPendiente),
    valorNoConciliado: round2(valorNoConciliado),
    porcentajeConciliacion: base > 0 ? round2((conciliados / base) * 100) : 0,
    porcentajeValorConciliado: totalValor > 0 ? round2((valorConciliado / totalValor) * 100) : 0,
    ingresosBanco: round2(ingresosBanco),
    egresosBanco: round2(egresosBanco),
    ingresosContables: round2(ingresosContables),
    egresosContables: round2(egresosContables),
    diferenciaEnCruces,
  };
}
