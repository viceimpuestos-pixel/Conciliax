/**
 * Indicadores ejecutivos de la conciliación.
 */

import type { BankTx, LedgerTx, MatchStatus, ReconciliationResult } from '../types';
import { round2 } from '../normalize/money';

/**
 * Cómo se obtuvo el saldo del banco:
 * - 'extracto': última fila de la columna Saldo del extracto.
 * - 'inicial': saldo inicial informado (archivo o digitado) + neto de movimientos.
 * - 'supuesto': el extracto no trae saldo; se asume que el saldo inicial del
 *   banco es igual al saldo inicial del auxiliar + neto de movimientos.
 * - 'neto': sin ningún saldo inicial; se comparan netos de período en ambos lados.
 */
export type SaldoOrigen = 'extracto' | 'inicial' | 'supuesto' | 'neto';

export interface SaldoOptions {
  /** Saldo inicial del extracto (fila de saldo inicial o digitado por el usuario). */
  bankOpening?: number | null;
  /** Saldo inicial del auxiliar (fila "SALDO INICIAL"). */
  ledgerOpening?: number | null;
}

export interface Kpis {
  /** Saldo final del extracto (columna Saldo) o neto de movimientos. */
  saldoBanco: number;
  saldoBancoEsNeto: boolean;
  saldoBancoOrigen: SaldoOrigen;
  /** Saldo inicial usado para el banco (null si no se usó). */
  saldoInicialBanco: number | null;
  /** Saldo según contabilidad (saldo final del auxiliar) o neto de movimientos. */
  saldoContable: number;
  saldoContableEsNeto: boolean;
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

  /**
   * Parte de la diferencia banco − contabilidad que explican las partidas
   * conciliatorias: movimientos bancarios sin cruce − registros contables sin
   * cruce + diferencias de valor dentro de los cruces.
   */
  diferenciaExplicada: number;
  /** diferencia − diferenciaExplicada. Debe ser 0 en una conciliación cerrada. */
  diferenciaSinExplicar: number;
  partidasBanco: number;
  partidasContables: number;
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
  saldos: SaldoOptions = {},
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
  const netoBanco = round2(ingresosBanco - egresosBanco);
  const netoContable = round2(ledger.reduce((acc, l) => acc + l.amount, 0));

  // Saldo contable: si el auxiliar trae columna de saldo, se usa el último valor
  // (igual que el banco). Comparar un saldo final contra un neto de período habría
  // inflado artificialmente la diferencia cuando el auxiliar no arranca en cero.
  const ledgerWithBalance = ledger.filter((l) => l.balance !== null && Number.isFinite(l.balance));
  const ledgerOrdered = ledgerWithBalance
    .slice()
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || a.rowIndex - b.rowIndex);
  const ledgerOpening =
    saldos.ledgerOpening ??
    (ledgerOrdered.length
      ? round2((ledgerOrdered[0].balance as number) - ledgerOrdered[0].amount)
      : null);
  let saldoContableEsNeto = ledgerOrdered.length === 0 && ledgerOpening === null;
  let saldoContable = ledgerOrdered.length
    ? round2(ledgerOrdered[ledgerOrdered.length - 1].balance as number)
    : ledgerOpening !== null
      ? round2(ledgerOpening + netoContable)
      : netoContable;

  // Saldo del banco. Un neto de movimientos NUNCA se compara contra un saldo
  // final: si el extracto no trae saldo se le suma un saldo inicial, y si no
  // hay ninguno se comparan netos en ambos lados.
  let saldoBancoOrigen: SaldoOrigen;
  let saldoInicialBanco: number | null = null;
  let saldoBanco: number;
  if (ordered.length) {
    saldoBancoOrigen = 'extracto';
    saldoBanco = round2(ordered[ordered.length - 1].balance as number);
  } else if (saldos.bankOpening !== null && saldos.bankOpening !== undefined) {
    saldoBancoOrigen = 'inicial';
    saldoInicialBanco = saldos.bankOpening;
    saldoBanco = round2(saldos.bankOpening + netoBanco);
  } else if (ledgerOpening !== null) {
    saldoBancoOrigen = 'supuesto';
    saldoInicialBanco = ledgerOpening;
    saldoBanco = round2(ledgerOpening + netoBanco);
  } else {
    saldoBancoOrigen = 'neto';
    saldoBanco = netoBanco;
    saldoContable = netoContable;
    saldoContableEsNeto = true;
  }
  const saldoBancoEsNeto = saldoBancoOrigen === 'neto';

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

  // Partidas conciliatorias (los ignorados también son partidas: no se cruzaron).
  let partidasBanco = 0;
  let partidasContables = 0;
  let explicada = result.matches.reduce((acc, m) => acc + m.amountDiff, 0);
  for (const b of bank) {
    if (!result.byBank.has(b.id)) {
      explicada += b.amount;
      partidasBanco++;
    }
  }
  for (const l of ledger) {
    if (!result.byLedger.has(l.id)) {
      explicada -= l.amount;
      partidasContables++;
    }
  }
  const diferencia = round2(saldoBanco - saldoContable);

  return {
    saldoBanco,
    saldoBancoEsNeto,
    saldoBancoOrigen,
    saldoInicialBanco,
    saldoContable,
    saldoContableEsNeto,
    diferencia,
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
    diferenciaExplicada: round2(explicada),
    diferenciaSinExplicar: round2(diferencia - explicada),
    partidasBanco,
    partidasContables,
  };
}
