/**
 * Motor de conciliación.
 *
 * Estrategia:
 *  1. Indexación por valor absoluto (búsqueda binaria por rango) para evitar O(n²) real.
 *  2. Scoring multicriterio de cada par candidato.
 *  3. Asignación global 1:1 greedy por puntaje descendente.
 *  4. Reaplicación de las decisiones manuales del usuario.
 *  5. Clasificación final de cada movimiento.
 */

import type {
  BankTx,
  LedgerTx,
  ManualOverrides,
  Match,
  MatchStatus,
  ReconciliationResult,
} from '../types';
import { EMPTY_OVERRIDES } from '../types';
import type { ReconciliationConfig } from './config';
import { scorePair, type PairScore } from './scoring';
import { normalizeText } from '../normalize/text';
import { round2 } from '../normalize/money';
import { daysBetween } from '../normalize/dates';
import { findGroups, type GroupFound } from './grouping';

export interface CandidateSuggestion {
  ledgerId: string;
  score: number;
  explanation: string;
  amountDiff: number;
  daysDiff: number | null;
}

export function pairKey(bankId: string, ledgerId: string): string {
  return bankId + '|' + ledgerId;
}

/* ------------------------------------------------------------------ */
/* Índice por valor                                                    */
/* ------------------------------------------------------------------ */

interface AmountIndex {
  sorted: { abs: number; idx: number }[];
}

function buildIndex(ledger: LedgerTx[]): AmountIndex {
  const sorted = ledger
    .map((l, idx) => ({ abs: Math.abs(l.amount), idx }))
    .sort((a, b) => a.abs - b.abs);
  return { sorted };
}

/** Primer elemento con abs >= target. */
function lowerBound(arr: { abs: number }[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].abs < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function candidatesInRange(index: AmountIndex, value: number, window: number): number[] {
  const lo = lowerBound(index.sorted, value - window);
  const out: number[] = [];
  for (let i = lo; i < index.sorted.length; i++) {
    if (index.sorted[i].abs > value + window) break;
    out.push(index.sorted[i].idx);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Duplicados                                                          */
/* ------------------------------------------------------------------ */

/**
 * Sólo marca el caso clásico de duplicado accidental (EXACTAMENTE 2
 * coincidencias). Tres o más movimientos idénticos el mismo día casi siempre
 * son pagos recurrentes de valor fijo sin referencia propia (tasas,
 * aranceles, PSE a entidades de gobierno), no un error de doble registro.
 */
export function duplicateIds<T extends { id: string; date: Date | null; amount: number; description: string }>(
  rows: T[],
  extra: (r: T) => string = () => '',
): Set<string> {
  const seen = new Map<string, string[]>();
  for (const r of rows) {
    const key = [
      r.date ? r.date.getTime() : 'nd',
      r.amount,
      normalizeText(r.description).slice(0, 40),
      extra(r),
    ].join('|');
    const list = seen.get(key);
    if (list) list.push(r.id);
    else seen.set(key, [r.id]);
  }
  const out = new Set<string>();
  for (const list of seen.values()) {
    if (list.length === 2) list.forEach((id) => out.add(id));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Clasificación                                                       */
/* ------------------------------------------------------------------ */

function classify(
  score: number,
  amountDiff: number,
  daysDiff: number | null,
  cfg: ReconciliationConfig,
  ambiguous: boolean,
): MatchStatus {
  const th = cfg.thresholds;
  // Diferencias de centavos (redondeo del banco) no son diferencias de valor.
  const significantDiff = Math.abs(amountDiff) > roundingOf(cfg);
  const farDate = daysDiff !== null && Math.abs(daysDiff) > cfg.tolerances.dateWindowDays;

  if (score < th.revision) return 'NO_CONCILIADO';

  if (significantDiff) return 'DIF_VALOR';
  if (farDate) return 'DIF_FECHA';

  if (score >= th.conciliado) return ambiguous ? 'REVISION' : 'CONCILIADO';
  // Valor exacto (± redondeo), fecha dentro del rango y candidato único: es el
  // mismo movimiento aunque el extracto no traiga NIT ni nombre completo
  // (p. ej. PSE registrado un día después).
  if ((cfg.options.autoConciliarValorExacto ?? true) && score >= th.probable && !ambiguous) return 'CONCILIADO';
  if (score >= th.probable) return 'PROBABLE';
  return 'REVISION';
}

export function roundingOf(cfg: ReconciliationConfig): number {
  return cfg.tolerances.roundingAbsolute ?? 1;
}

/* ------------------------------------------------------------------ */
/* Motor                                                               */
/* ------------------------------------------------------------------ */

export interface ReconcileInput {
  bank: BankTx[];
  ledger: LedgerTx[];
  config: ReconciliationConfig;
  overrides?: ManualOverrides;
}

export function reconcile(input: ReconcileInput): ReconciliationResult {
  const started = performance.now();
  const { bank, ledger, config: cfg } = input;
  const ov = input.overrides ?? EMPTY_OVERRIDES;

  const rejected = new Set(ov.rejected);
  const ignoredBank = new Set(ov.ignoredBank);
  const ignoredLedger = new Set(ov.ignoredLedger);

  const bankById = new Map(bank.map((b) => [b.id, b]));
  const ledgerById = new Map(ledger.map((l) => [l.id, l]));

  const takenBank = new Set<string>();
  const takenLedger = new Set<string>();
  const matches: Match[] = [];

  const pushMatch = (m: Match) => {
    matches.push(m);
    takenBank.add(m.bankId);
    takenLedger.add(m.ledgerId);
  };

  /* --- 1. Vínculos manuales (prioridad máxima) ---------------------- */

  for (const link of ov.manualLinks) {
    const b = bankById.get(link.bankId);
    const l = ledgerById.get(link.ledgerId);
    if (!b || !l) continue;
    if (takenBank.has(b.id) || takenLedger.has(l.id)) continue;
    if (ignoredBank.has(b.id) || ignoredLedger.has(l.id)) continue;

    const s = scorePair(b, l, cfg);
    pushMatch({
      id: 'M' + (matches.length + 1),
      bankId: b.id,
      ledgerId: l.id,
      score: 100,
      status: 'CONCILIADO',
      reasons: [
        { code: 'MANUAL', label: 'Vinculado manualmente por el usuario', points: 100 },
        ...s.reasons,
      ],
      amountDiff: Math.round((b.amount - l.amount) * 100) / 100,
      daysDiff: s.daysDiff,
      origin: 'manual',
      explanation: 'Vinculación manual del usuario.',
    });
  }

  /* --- 2. Pares aceptados explícitamente ---------------------------- */

  for (const key of ov.accepted) {
    const [bankId, ledgerId] = key.split('|');
    const b = bankById.get(bankId);
    const l = ledgerById.get(ledgerId);
    if (!b || !l) continue;
    if (takenBank.has(bankId) || takenLedger.has(ledgerId)) continue;
    if (ignoredBank.has(bankId) || ignoredLedger.has(ledgerId)) continue;

    const s = scorePair(b, l, cfg);
    pushMatch({
      id: 'M' + (matches.length + 1),
      bankId,
      ledgerId,
      score: 100,
      status: 'CONCILIADO',
      reasons: [
        { code: 'ACEPTADO', label: 'Coincidencia aceptada por el usuario', points: 100 },
        ...s.reasons,
      ],
      amountDiff: Math.round((b.amount - l.amount) * 100) / 100,
      daysDiff: s.daysDiff,
      origin: 'manual',
      explanation: 'Aceptada manualmente. ' + s.explanation,
    });
  }

  /* --- 3. Generación de candidatos automáticos ---------------------- */

  const index = buildIndex(ledger);
  const t = cfg.tolerances;

  interface Pair {
    bankIdx: number;
    ledgerIdx: number;
    s: PairScore;
  }
  const pairs: Pair[] = [];
  /** Mejores candidatos por movimiento bancario (para sugerencias en pantalla). */
  const suggestions = new Map<string, CandidateSuggestion[]>();

  bank.forEach((b, bankIdx) => {
    if (ignoredBank.has(b.id) || takenBank.has(b.id)) return;

    const abs = Math.abs(b.amount);
    const window = Math.max(
      t.amountAbsolute,
      (abs * t.amountPercent) / 100,
      t.diffWindowAbsolute,
      (abs * t.diffWindowPercent) / 100,
    );

    const scored: Pair[] = [];
    for (const ledgerIdx of candidatesInRange(index, abs, window)) {
      const l = ledger[ledgerIdx];
      if (ignoredLedger.has(l.id) || takenLedger.has(l.id)) continue;
      if (rejected.has(pairKey(b.id, l.id))) continue;

      const s = scorePair(b, l, cfg);
      if (!s.viable || s.score <= 0) continue;
      scored.push({ bankIdx, ledgerIdx, s });
    }

    scored.sort((x, y) => y.s.score - x.s.score);
    const top = scored.slice(0, cfg.options.maxCandidates);
    pairs.push(...top);

    suggestions.set(
      b.id,
      top.slice(0, 5).map((p) => ({
        ledgerId: ledger[p.ledgerIdx].id,
        score: p.s.score,
        explanation: p.s.explanation,
        amountDiff: p.s.amountDiff,
        daysDiff: p.s.daysDiff,
      })),
    );
  });

  /* --- 4. Asignación global greedy ---------------------------------- */

  pairs.sort((a, b) => {
    if (b.s.score !== a.s.score) return b.s.score - a.s.score;
    // Desempate: menor diferencia de valor, luego menor diferencia de días.
    const ad = Math.abs(a.s.amountDiff) - Math.abs(b.s.amountDiff);
    if (ad !== 0) return ad;
    return Math.abs(a.s.daysDiff ?? 999) - Math.abs(b.s.daysDiff ?? 999);
  });

  // Detección de ambigüedad: un bancario con dos candidatos de puntaje idéntico.
  const candidatesByBank = new Map<string, Pair[]>();
  for (const p of pairs) {
    const id = bank[p.bankIdx].id;
    const list = candidatesByBank.get(id) ?? [];
    list.push(p);
    candidatesByBank.set(id, list);
  }
  /**
   * Dos candidatos empatados sólo son una ambigüedad real si son distintos.
   * Si tienen el mismo valor, fecha y tercero (p. ej. dos tasas idénticas de
   * INVIMA pagadas el mismo día) son intercambiables: cualquier asignación
   * deja la conciliación igual de correcta, no hay nada que revisar.
   */
  const fungibleKey = (l: LedgerTx) =>
    [l.amount, l.date ? l.date.toDateString() : 'nd', l.thirdPartyId || normalizeText(l.thirdPartyName)].join('|');

  /**
   * Movimientos bancarios idénticos (mismo valor y fecha) compiten por los
   * mismos candidatos. Si hay tantos bancarios como candidatos empatados, todos
   * quedan cruzados sea cual sea la asignación: no hay ambigüedad que revisar.
   */
  const twinKey = (b: BankTx) => b.amount + '|' + (b.date ? b.date.toDateString() : 'nd');
  const twins = new Map<string, number>();
  for (const b of bank) twins.set(twinKey(b), (twins.get(twinKey(b)) ?? 0) + 1);

  const rounding = roundingOf(cfg);
  const deferred: Pair[] = [];

  const assign = (p: Pair) => {
    const b = bank[p.bankIdx];
    const l = ledger[p.ledgerIdx];

    const tied = (candidatesByBank.get(b.id) ?? []).filter((c) => Math.abs(c.s.score - p.s.score) < 0.05);
    const ambiguous =
      cfg.options.flagAmbiguous &&
      tied.length > 1 &&
      tied.length > (twins.get(twinKey(b)) ?? 1) &&
      new Set(tied.map((c) => fungibleKey(ledger[c.ledgerIdx]))).size > 1;

    const status = classify(p.s.score, p.s.amountDiff, p.s.daysDiff, cfg, ambiguous);

    pushMatch({
      id: 'M' + (matches.length + 1),
      bankId: b.id,
      ledgerId: l.id,
      score: p.s.score,
      status,
      reasons: ambiguous
        ? [
            ...p.s.reasons,
            { code: 'AMBIGUO', label: 'Existe más de un candidato con el mismo puntaje', points: 0 },
          ]
        : p.s.reasons,
      amountDiff: p.s.amountDiff,
      daysDiff: p.s.daysDiff,
      origin: 'auto',
      explanation: ambiguous
        ? p.s.explanation + ' Requiere revisión: hay varios candidatos equivalentes.'
        : p.s.explanation,
    });
  };

  for (const p of pairs) {
    const b = bank[p.bankIdx];
    const l = ledger[p.ledgerIdx];
    if (takenBank.has(b.id) || takenLedger.has(l.id)) continue;
    if (p.s.score < cfg.thresholds.revision) continue;
    // Los pares con diferencia de valor se asignan después de buscar cruces
    // agrupados: un registro contable que es la suma exacta de varios
    // movimientos bancarios no debe quedar atado a uno solo "parecido".
    if (Math.abs(p.s.amountDiff) > rounding) {
      deferred.push(p);
      continue;
    }
    assign(p);
  }

  /* --- 5. Cruces agrupados (N:1, 1:N, gastos bancarios, bloques) ----- */

  if (cfg.options.groupMatching ?? true) {
    const groups = findGroups({
      bank,
      ledger,
      takenBank: new Set([...takenBank, ...ignoredBank]),
      takenLedger: new Set([...takenLedger, ...ignoredLedger]),
      rejected,
      roundingAbsolute: roundingOf(cfg),
      windowDays: cfg.options.groupWindowDays ?? 7,
    });
    groups.forEach((g, gi) => {
      for (const m of groupMatches(g, 'G' + (gi + 1), bankById, ledgerById, cfg, matches.length)) pushMatch(m);
    });
  }

  for (const p of deferred) {
    if (takenBank.has(bank[p.bankIdx].id) || takenLedger.has(ledger[p.ledgerIdx].id)) continue;
    assign(p);
  }

  /* --- 6. Índices y estados finales --------------------------------- */

  const byBank = new Map<string, Match>();
  const byLedger = new Map<string, Match>();
  for (const m of matches) {
    byBank.set(m.bankId, m);
    byLedger.set(m.ledgerId, m);
  }

  // Un movimiento repetido sólo es sospechoso si quedó sin contrapartida: si
  // las dos copias se cruzaron con dos registros distintos, son operaciones
  // reales (tasas o comisiones del mismo valor el mismo día).
  const dupBank = new Set(
    [...duplicateIds(bank, (b) => [b.document, b.reference, b.transactionNumber].join('|'))].filter(
      (id) => !byBank.has(id),
    ),
  );
  const dupLedger = new Set(
    [...duplicateIds(ledger, (l) => l.thirdPartyId + l.documentNumber)].filter((id) => !byLedger.has(id)),
  );

  const bankStatus = new Map<string, MatchStatus>();
  const ledgerStatus = new Map<string, MatchStatus>();
  const unmatchedBank: string[] = [];
  const unmatchedLedger: string[] = [];

  for (const b of bank) {
    if (ignoredBank.has(b.id)) {
      bankStatus.set(b.id, 'IGNORADO');
      continue;
    }
    const m = byBank.get(b.id);
    if (m) {
      bankStatus.set(b.id, m.status);
    } else {
      bankStatus.set(b.id, dupBank.has(b.id) ? 'DUPLICADO' : 'NO_CONCILIADO');
      unmatchedBank.push(b.id);
    }
  }

  for (const l of ledger) {
    if (ignoredLedger.has(l.id)) {
      ledgerStatus.set(l.id, 'IGNORADO');
      continue;
    }
    const m = byLedger.get(l.id);
    if (m) {
      ledgerStatus.set(l.id, m.status);
    } else {
      ledgerStatus.set(l.id, dupLedger.has(l.id) ? 'DUPLICADO' : 'NO_CONCILIADO');
      unmatchedLedger.push(l.id);
    }
  }

  const result: ReconciliationResult = {
    matches,
    byBank,
    byLedger,
    bankStatus,
    ledgerStatus,
    unmatchedBank,
    unmatchedLedger,
    duplicateBank: dupBank,
    duplicateLedger: dupLedger,
    ignoredBank,
    ignoredLedger,
    runAt: new Date(),
    elapsedMs: Math.round(performance.now() - started),
  };

  lastSuggestions = suggestions;
  return result;
}

const GROUP_LABEL: Record<GroupFound['kind'], string> = {
  GASTOS_BANCARIOS: 'Gastos bancarios del mes (4x1000, IVA, comisiones) contra su asiento contable',
  VARIOS_BANCO: 'Varios movimientos bancarios suman exactamente un registro contable',
  VARIOS_CONTABLE: 'Varios registros contables suman exactamente un movimiento bancario',
  BLOQUE_TERCERO: 'Los movimientos pendientes del mismo tercero suman lo mismo en banco y contabilidad',
};

/**
 * Convierte un grupo en filas Match. Cada movimiento del grupo (de ambos
 * lados) queda en al menos una fila, todas con el mismo groupId. La diferencia
 * de valor del grupo se reporta una sola vez (primera fila) para que las sumas
 * de diferencias no se dupliquen.
 */
function groupMatches(
  g: GroupFound,
  groupId: string,
  bankById: Map<string, BankTx>,
  ledgerById: Map<string, LedgerTx>,
  cfg: ReconciliationConfig,
  offset: number,
): Match[] {
  const bs = g.bankIds.map((id) => bankById.get(id)!);
  const ls = g.ledgerIds.map((id) => ledgerById.get(id)!);
  const diff = round2(bs.reduce((a, b) => a + b.amount, 0) - ls.reduce((a, l) => a + l.amount, 0));
  const status: MatchStatus = Math.abs(diff) <= roundingOf(cfg) ? 'CONCILIADO' : 'DIF_VALOR';
  const label =
    GROUP_LABEL[g.kind] + ' (' + bs.length + ' bancario' + (bs.length === 1 ? '' : 's') + ' · ' +
    ls.length + ' contable' + (ls.length === 1 ? '' : 's') + ')';
  const n = Math.max(bs.length, ls.length);
  const out: Match[] = [];
  for (let i = 0; i < n; i++) {
    const b = bs[Math.min(i, bs.length - 1)];
    const l = ls[Math.min(i, ls.length - 1)];
    out.push({
      id: 'M' + (offset + out.length + 1),
      bankId: b.id,
      ledgerId: l.id,
      score: 100,
      status,
      reasons: [{ code: 'GRUPO_' + g.kind, label, points: 100 }],
      amountDiff: i === 0 ? diff : 0,
      daysDiff: daysBetween(b.date, l.date),
      origin: 'auto',
      explanation: 'Cruce agrupado ' + groupId + ': ' + label + '.',
      groupId,
    });
  }
  return out;
}

/**
 * Sugerencias del último cálculo (top 5 candidatos por movimiento bancario).
 * Se usa en el panel de conciliación manual.
 */
let lastSuggestions = new Map<string, CandidateSuggestion[]>();

export function getSuggestions(bankId: string): CandidateSuggestion[] {
  return lastSuggestions.get(bankId) ?? [];
}

/**
 * Calcula candidatos bajo demanda para un movimiento bancario concreto,
 * ignorando qué está ya conciliado (para el diálogo de vinculación manual).
 */
export function findCandidates(
  b: BankTx,
  ledger: LedgerTx[],
  cfg: ReconciliationConfig,
  limit = 20,
): CandidateSuggestion[] {
  const out: CandidateSuggestion[] = [];
  for (const l of ledger) {
    const s = scorePair(b, l, cfg);
    if (!s.viable || s.score <= 0) continue;
    out.push({
      ledgerId: l.id,
      score: s.score,
      explanation: s.explanation,
      amountDiff: s.amountDiff,
      daysDiff: s.daysDiff,
    });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}

/** Igual que findCandidates pero desde el lado contable. */
export function findBankCandidates(
  l: LedgerTx,
  bank: BankTx[],
  cfg: ReconciliationConfig,
  limit = 20,
): { bankId: string; score: number; explanation: string; amountDiff: number; daysDiff: number | null }[] {
  const out: { bankId: string; score: number; explanation: string; amountDiff: number; daysDiff: number | null }[] = [];
  for (const b of bank) {
    const s = scorePair(b, l, cfg);
    if (!s.viable || s.score <= 0) continue;
    out.push({
      bankId: b.id,
      score: s.score,
      explanation: s.explanation,
      amountDiff: s.amountDiff,
      daysDiff: s.daysDiff,
    });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}
