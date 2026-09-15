/**
 * Selectores derivados: analítica y filtrado.
 * Se memorizan por componente con useMemo para no recalcular en cada render.
 */

import { useMemo } from 'react';
import { useStore, type Filters } from './store';
import type { BankTx, LedgerTx, MatchStatus, ReconciliationResult } from '../core/types';
import { computeKpis, type Kpis } from '../core/analytics/kpis';
import {
  accountSummaries,
  accountGroups,
  balanceEvolution,
  monthlySeries,
  statusDistribution,
  thirdPartySummaries,
  type AccountSummary,
  type ThirdPartySummary,
} from '../core/analytics/aggregations';
import { buildAlerts, type Alert } from '../core/analytics/alerts';
import { fromISODate } from '../core/normalize/dates';
import { normalizeText } from '../core/normalize/text';
import { normalizeNit } from '../core/normalize/nit';

const EMPTY_RESULT: ReconciliationResult = {
  matches: [],
  byBank: new Map(),
  byLedger: new Map(),
  bankStatus: new Map(),
  ledgerStatus: new Map(),
  unmatchedBank: [],
  unmatchedLedger: [],
  duplicateBank: new Set(),
  duplicateLedger: new Set(),
  ignoredBank: new Set(),
  ignoredLedger: new Set(),
  runAt: new Date(0),
  elapsedMs: 0,
};

export function useBankRows(): BankTx[] {
  return useStore((s) => s.bankDataset?.rows) ?? [];
}
export function useLedgerRows(): LedgerTx[] {
  return useStore((s) => s.ledgerDataset?.rows) ?? [];
}
export function useResult(): ReconciliationResult {
  return useStore((s) => s.result) ?? EMPTY_RESULT;
}
export function useHasData(): boolean {
  return useStore((s) => Boolean(s.result && s.bankDataset && s.ledgerDataset));
}

export function useKpis(): Kpis {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  return useMemo(() => computeKpis(bank, ledger, result), [bank, ledger, result]);
}

export function useThirdParties(): ThirdPartySummary[] {
  const ledger = useLedgerRows();
  const result = useResult();
  return useMemo(() => thirdPartySummaries(ledger, result), [ledger, result]);
}

export function useAccounts(): AccountSummary[] {
  const ledger = useLedgerRows();
  const result = useResult();
  return useMemo(() => accountSummaries(ledger, result), [ledger, result]);
}

export function useAccountGroups(): AccountSummary[] {
  const accounts = useAccounts();
  return useMemo(() => accountGroups(accounts), [accounts]);
}

export function useMonthly() {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  return useMemo(() => monthlySeries(bank, ledger, result), [bank, ledger, result]);
}

export function useBalances() {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  return useMemo(() => balanceEvolution(bank, ledger), [bank, ledger]);
}

export function useStatusDistribution() {
  const bank = useBankRows();
  const result = useResult();
  return useMemo(() => statusDistribution(bank, result), [bank, result]);
}

export function useAlerts(): Alert[] {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  const thirdParties = useThirdParties();
  return useMemo(
    () => buildAlerts(bank, ledger, result, thirdParties),
    [bank, ledger, result, thirdParties],
  );
}

/* ------------------------------------------------------------------ */
/* Filtrado                                                            */
/* ------------------------------------------------------------------ */

export interface BankRowView {
  tx: BankTx;
  status: MatchStatus;
  score: number;
  ledger: LedgerTx | null;
  explanation: string;
  amountDiff: number;
  daysDiff: number | null;
  origin: 'auto' | 'manual' | null;
  reviewed: boolean;
  note: string;
}

export interface LedgerRowView {
  tx: LedgerTx;
  status: MatchStatus;
  score: number;
  bank: BankTx | null;
  explanation: string;
  reviewed: boolean;
  note: string;
}

function inRange(value: number, min: string, max: string): boolean {
  const abs = Math.abs(value);
  if (min && abs < Number(min.replace(/\D/g, '') || 0)) return false;
  if (max) {
    const m = Number(max.replace(/\D/g, '') || 0);
    if (m > 0 && abs > m) return false;
  }
  return true;
}

function matchesDate(d: Date | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!d) return false;
  const f = fromISODate(from);
  const t = fromISODate(to);
  if (f && d < f) return false;
  if (t && d > t) return false;
  return true;
}

export function useFilteredBank(): BankRowView[] {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  const filters = useStore((s) => s.filters);
  const overrides = useStore((s) => s.overrides);

  return useMemo(() => {
    const ledgerById = new Map(ledger.map((l) => [l.id, l]));
    const reviewed = new Set(overrides.reviewed);
    const search = normalizeText(filters.search);
    const tercero = normalizeText(filters.tercero);
    const nit = normalizeNit(filters.nit);
    const cuenta = normalizeText(filters.cuenta);

    const views: BankRowView[] = [];

    for (const tx of bank) {
      const status = result.bankStatus.get(tx.id) ?? 'NO_CONCILIADO';
      const match = result.byBank.get(tx.id);
      const l = match ? ledgerById.get(match.ledgerId) ?? null : null;

      if (filters.estados.length && !filters.estados.includes(status)) continue;
      if (!matchesDate(tx.date, filters.dateFrom, filters.dateTo)) continue;
      if (!inRange(tx.amount, filters.minValor, filters.maxValor)) continue;
      if (filters.naturaleza === 'debito' && tx.debit <= 0) continue;
      if (filters.naturaleza === 'credito' && tx.credit <= 0) continue;

      const score = match?.score ?? 0;
      if (score < filters.minConfianza || score > filters.maxConfianza) continue;

      if (tercero) {
        const name = normalizeText((l?.thirdPartyName ?? '') + ' ' + tx.thirdPartyName + ' ' + tx.description);
        if (!name.includes(tercero)) continue;
      }
      if (nit) {
        const candidate = normalizeNit(l?.thirdPartyId ?? tx.thirdPartyId);
        if (!candidate.includes(nit) && !normalizeText(tx.description).includes(nit)) continue;
      }
      if (cuenta) {
        const acc = normalizeText((l?.accountCode ?? '') + ' ' + (l?.accountName ?? ''));
        if (!acc.includes(cuenta)) continue;
      }
      if (search) {
        const haystack = normalizeText(
          [
            tx.description, tx.reference, tx.document, tx.transactionNumber, tx.id,
            l?.thirdPartyName, l?.documentNumber, l?.accountCode, l?.description,
            String(Math.abs(tx.amount)),
          ]
            .filter(Boolean)
            .join(' '),
        );
        if (!haystack.includes(search)) continue;
      }

      views.push({
        tx,
        status,
        score,
        ledger: l,
        explanation: match?.explanation ?? '',
        amountDiff: match?.amountDiff ?? 0,
        daysDiff: match?.daysDiff ?? null,
        origin: match?.origin ?? null,
        reviewed: reviewed.has(tx.id),
        note: overrides.notes[tx.id] ?? '',
      });
    }

    return views;
  }, [bank, ledger, result, filters, overrides]);
}

export function useFilteredLedger(): LedgerRowView[] {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  const filters = useStore((s) => s.filters);
  const overrides = useStore((s) => s.overrides);

  return useMemo(() => {
    const bankById = new Map(bank.map((b) => [b.id, b]));
    const reviewed = new Set(overrides.reviewed);
    const search = normalizeText(filters.search);
    const tercero = normalizeText(filters.tercero);
    const nit = normalizeNit(filters.nit);
    const cuenta = normalizeText(filters.cuenta);

    const views: LedgerRowView[] = [];

    for (const tx of ledger) {
      const status = result.ledgerStatus.get(tx.id) ?? 'NO_CONCILIADO';
      const match = result.byLedger.get(tx.id);
      const b = match ? bankById.get(match.bankId) ?? null : null;

      if (filters.estados.length && !filters.estados.includes(status)) continue;
      if (!matchesDate(tx.date, filters.dateFrom, filters.dateTo)) continue;
      if (!inRange(tx.amount, filters.minValor, filters.maxValor)) continue;
      if (filters.naturaleza === 'debito' && tx.debit <= 0) continue;
      if (filters.naturaleza === 'credito' && tx.credit <= 0) continue;

      const score = match?.score ?? 0;
      if (score < filters.minConfianza || score > filters.maxConfianza) continue;

      if (tercero && !normalizeText(tx.thirdPartyName).includes(tercero)) continue;
      if (nit && !normalizeNit(tx.thirdPartyId).includes(nit)) continue;
      if (cuenta && !normalizeText(tx.accountCode + ' ' + tx.accountName).includes(cuenta)) continue;

      if (search) {
        const haystack = normalizeText(
          [tx.thirdPartyName, tx.description, tx.documentNumber, tx.accountCode, tx.accountName, tx.id, String(Math.abs(tx.amount))]
            .filter(Boolean)
            .join(' '),
        );
        if (!haystack.includes(search)) continue;
      }

      views.push({
        tx,
        status,
        score,
        bank: b,
        explanation: match?.explanation ?? '',
        reviewed: reviewed.has(tx.id),
        note: overrides.notes[tx.id] ?? '',
      });
    }

    return views;
  }, [bank, ledger, result, filters, overrides]);
}

/** ¿Hay algún filtro activo? */
export function isFilterActive(f: Filters): boolean {
  return (
    Boolean(f.search || f.dateFrom || f.dateTo || f.tercero || f.nit || f.cuenta || f.minValor || f.maxValor) ||
    f.estados.length > 0 ||
    f.naturaleza !== 'todos' ||
    f.minConfianza > 0 ||
    f.maxConfianza < 100
  );
}
