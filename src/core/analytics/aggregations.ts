/**
 * Agregaciones para los gráficos del dashboard y los módulos de análisis.
 */

import type { BankTx, LedgerTx, MatchStatus, ReconciliationResult } from '../types';
import { STATUS_LABEL } from '../types';
import { monthKey, monthLabel } from '../normalize/dates';
import { round2 } from '../normalize/money';

/* ------------------------------------------------------------------ */
/* Series por mes                                                      */
/* ------------------------------------------------------------------ */

export interface MonthlyPoint {
  key: string;
  label: string;
  ingresos: number;
  egresos: number;
  neto: number;
  ingresosContables: number;
  egresosContables: number;
  conciliados: number;
  pendientes: number;
  noConciliados: number;
  valorConciliado: number;
  valorNoConciliado: number;
}

export function monthlySeries(
  bank: BankTx[],
  ledger: LedgerTx[],
  result: ReconciliationResult,
): MonthlyPoint[] {
  const map = new Map<string, MonthlyPoint>();

  const get = (key: string): MonthlyPoint => {
    let p = map.get(key);
    if (!p) {
      p = {
        key,
        label: monthLabel(key),
        ingresos: 0,
        egresos: 0,
        neto: 0,
        ingresosContables: 0,
        egresosContables: 0,
        conciliados: 0,
        pendientes: 0,
        noConciliados: 0,
        valorConciliado: 0,
        valorNoConciliado: 0,
      };
      map.set(key, p);
    }
    return p;
  };

  for (const b of bank) {
    const k = monthKey(b.date);
    if (!k) continue;
    const p = get(k);
    p.ingresos += b.credit;
    p.egresos += b.debit;
    p.neto = round2(p.ingresos - p.egresos);

    const s = result.bankStatus.get(b.id) ?? 'NO_CONCILIADO';
    if (s === 'CONCILIADO') {
      p.conciliados++;
      p.valorConciliado += Math.abs(b.amount);
    } else if (s === 'NO_CONCILIADO' || s === 'DUPLICADO') {
      p.noConciliados++;
      p.valorNoConciliado += Math.abs(b.amount);
    } else if (s !== 'IGNORADO') {
      p.pendientes++;
      p.valorNoConciliado += Math.abs(b.amount);
    }
  }

  for (const l of ledger) {
    const k = monthKey(l.date);
    if (!k) continue;
    const p = get(k);
    if (l.amount >= 0) p.ingresosContables += Math.abs(l.amount);
    else p.egresosContables += Math.abs(l.amount);
  }

  return [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({
      ...p,
      ingresos: round2(p.ingresos),
      egresos: round2(p.egresos),
      ingresosContables: round2(p.ingresosContables),
      egresosContables: round2(p.egresosContables),
      valorConciliado: round2(p.valorConciliado),
      valorNoConciliado: round2(p.valorNoConciliado),
    }));
}

/* ------------------------------------------------------------------ */
/* Evolución de saldos                                                 */
/* ------------------------------------------------------------------ */

export interface BalancePoint {
  key: string;
  label: string;
  saldoBanco: number;
  saldoContable: number;
  diferencia: number;
}

/** Saldo acumulado por mes de banco y contabilidad. */
export function balanceEvolution(bank: BankTx[], ledger: LedgerTx[]): BalancePoint[] {
  const keys = new Set<string>();
  const bankByMonth = new Map<string, number>();
  const ledgerByMonth = new Map<string, number>();

  for (const b of bank) {
    const k = monthKey(b.date);
    if (!k) continue;
    keys.add(k);
    bankByMonth.set(k, (bankByMonth.get(k) ?? 0) + b.amount);
  }
  for (const l of ledger) {
    const k = monthKey(l.date);
    if (!k) continue;
    keys.add(k);
    ledgerByMonth.set(k, (ledgerByMonth.get(k) ?? 0) + l.amount);
  }

  let accBank = 0;
  let accLedger = 0;
  return [...keys].sort().map((k) => {
    accBank += bankByMonth.get(k) ?? 0;
    accLedger += ledgerByMonth.get(k) ?? 0;
    return {
      key: k,
      label: monthLabel(k),
      saldoBanco: round2(accBank),
      saldoContable: round2(accLedger),
      diferencia: round2(accBank - accLedger),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Distribución por estado                                             */
/* ------------------------------------------------------------------ */

export interface StatusSlice {
  status: MatchStatus;
  label: string;
  count: number;
  value: number;
}

export function statusDistribution(bank: BankTx[], result: ReconciliationResult): StatusSlice[] {
  const map = new Map<MatchStatus, StatusSlice>();
  for (const b of bank) {
    const s = result.bankStatus.get(b.id) ?? 'NO_CONCILIADO';
    let slice = map.get(s);
    if (!slice) {
      slice = { status: s, label: STATUS_LABEL[s], count: 0, value: 0 };
      map.set(s, slice);
    }
    slice.count++;
    slice.value += Math.abs(b.amount);
  }
  return [...map.values()]
    .map((s) => ({ ...s, value: round2(s.value) }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/* Análisis por tercero                                                */
/* ------------------------------------------------------------------ */

export interface ThirdPartySummary {
  key: string;
  nit: string;
  name: string;
  movimientos: number;
  debitos: number;
  creditos: number;
  neto: number;
  conciliados: number;
  pendientes: number;
  noConciliados: number;
  valorConciliado: number;
  valorPendiente: number;
  /** Suma de las diferencias de valor en los cruces de este tercero. */
  diferencia: number;
  cuentas: string[];
  ledgerIds: string[];
  bankIds: string[];
}

export function thirdPartySummaries(
  ledger: LedgerTx[],
  result: ReconciliationResult,
): ThirdPartySummary[] {
  const map = new Map<string, ThirdPartySummary>();

  for (const l of ledger) {
    const key = l.thirdPartyId || l.thirdPartyName || 'SIN_TERCERO';
    let t = map.get(key);
    if (!t) {
      t = {
        key,
        nit: l.thirdPartyId,
        name: l.thirdPartyName || 'Sin tercero identificado',
        movimientos: 0,
        debitos: 0,
        creditos: 0,
        neto: 0,
        conciliados: 0,
        pendientes: 0,
        noConciliados: 0,
        valorConciliado: 0,
        valorPendiente: 0,
        diferencia: 0,
        cuentas: [],
        ledgerIds: [],
        bankIds: [],
      };
      map.set(key, t);
    }
    if (!t.name || t.name === 'Sin tercero identificado') {
      if (l.thirdPartyName) t.name = l.thirdPartyName;
    }
    t.movimientos++;
    t.debitos += l.debit;
    t.creditos += l.credit;
    t.neto += l.amount;
    t.ledgerIds.push(l.id);

    const account = l.accountCode ? l.accountCode + (l.accountName ? ' — ' + l.accountName : '') : '';
    if (account && !t.cuentas.includes(account)) t.cuentas.push(account);

    const status = result.ledgerStatus.get(l.id) ?? 'NO_CONCILIADO';
    const abs = Math.abs(l.amount);
    if (status === 'CONCILIADO') {
      t.conciliados++;
      t.valorConciliado += abs;
    } else if (status === 'NO_CONCILIADO' || status === 'DUPLICADO') {
      t.noConciliados++;
    } else if (status !== 'IGNORADO') {
      t.pendientes++;
      t.valorPendiente += abs;
    }

    const match = result.byLedger.get(l.id);
    if (match) {
      t.bankIds.push(match.bankId);
      t.diferencia += Math.abs(match.amountDiff);
    }
  }

  return [...map.values()]
    .map((t) => ({
      ...t,
      debitos: round2(t.debitos),
      creditos: round2(t.creditos),
      neto: round2(t.neto),
      valorConciliado: round2(t.valorConciliado),
      valorPendiente: round2(t.valorPendiente),
      diferencia: round2(t.diferencia),
    }))
    .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto));
}

/** Top N terceros por valor absoluto movido. */
export function topThirdPartiesByValue(list: ThirdPartySummary[], n = 10): ThirdPartySummary[] {
  return list.slice().sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto)).slice(0, n);
}

/** Top N terceros por diferencias (cruces con diferencia + no conciliado). */
export function topThirdPartiesByDifference(list: ThirdPartySummary[], n = 10): ThirdPartySummary[] {
  return list
    .slice()
    .map((t) => ({ ...t, _score: t.diferencia + t.valorPendiente }))
    .sort((a, b) => (b as any)._score - (a as any)._score)
    .slice(0, n);
}

/* ------------------------------------------------------------------ */
/* Análisis por cuenta contable                                        */
/* ------------------------------------------------------------------ */

export interface AccountSummary {
  code: string;
  name: string;
  /** Grupo = primeros 4 dígitos del PUC. */
  group: string;
  movimientos: number;
  debitos: number;
  creditos: number;
  neto: number;
  conciliados: number;
  pendientes: number;
  noConciliados: number;
  valorPendiente: number;
  diferencia: number;
  terceros: number;
}

export function accountSummaries(
  ledger: LedgerTx[],
  result: ReconciliationResult,
): AccountSummary[] {
  const map = new Map<string, AccountSummary & { _parties: Set<string> }>();

  for (const l of ledger) {
    const code = l.accountCode || 'SIN CUENTA';
    let a = map.get(code);
    if (!a) {
      a = {
        code,
        name: l.accountName || '',
        group: code.replace(/\D/g, '').slice(0, 4) || '—',
        movimientos: 0,
        debitos: 0,
        creditos: 0,
        neto: 0,
        conciliados: 0,
        pendientes: 0,
        noConciliados: 0,
        valorPendiente: 0,
        diferencia: 0,
        terceros: 0,
        _parties: new Set<string>(),
      };
      map.set(code, a);
    }
    if (!a.name && l.accountName) a.name = l.accountName;
    a.movimientos++;
    a.debitos += l.debit;
    a.creditos += l.credit;
    a.neto += l.amount;
    if (l.thirdPartyId || l.thirdPartyName) a._parties.add(l.thirdPartyId || l.thirdPartyName);

    const status = result.ledgerStatus.get(l.id) ?? 'NO_CONCILIADO';
    if (status === 'CONCILIADO') a.conciliados++;
    else if (status === 'NO_CONCILIADO' || status === 'DUPLICADO') {
      a.noConciliados++;
      a.valorPendiente += Math.abs(l.amount);
    } else if (status !== 'IGNORADO') {
      a.pendientes++;
      a.valorPendiente += Math.abs(l.amount);
    }

    const match = result.byLedger.get(l.id);
    if (match) a.diferencia += Math.abs(match.amountDiff);
  }

  return [...map.values()]
    .map(({ _parties, ...a }) => ({
      ...a,
      terceros: _parties.size,
      debitos: round2(a.debitos),
      creditos: round2(a.creditos),
      neto: round2(a.neto),
      valorPendiente: round2(a.valorPendiente),
      diferencia: round2(a.diferencia),
    }))
    .sort((a, b) => b.valorPendiente + b.diferencia - (a.valorPendiente + a.diferencia));
}

/** Agrupa cuentas por grupo PUC (4 dígitos). */
export function accountGroups(list: AccountSummary[]): AccountSummary[] {
  const map = new Map<string, AccountSummary>();
  for (const a of list) {
    let g = map.get(a.group);
    if (!g) {
      g = { ...a, code: a.group, name: 'Grupo ' + a.group, movimientos: 0, debitos: 0, creditos: 0, neto: 0, conciliados: 0, pendientes: 0, noConciliados: 0, valorPendiente: 0, diferencia: 0, terceros: 0 };
      map.set(a.group, g);
    }
    g.movimientos += a.movimientos;
    g.debitos = round2(g.debitos + a.debitos);
    g.creditos = round2(g.creditos + a.creditos);
    g.neto = round2(g.neto + a.neto);
    g.conciliados += a.conciliados;
    g.pendientes += a.pendientes;
    g.noConciliados += a.noConciliados;
    g.valorPendiente = round2(g.valorPendiente + a.valorPendiente);
    g.diferencia = round2(g.diferencia + a.diferencia);
    g.terceros += a.terceros;
  }
  return [...map.values()].sort((a, b) => b.valorPendiente - a.valorPendiente);
}
