/**
 * Motor de conciliación DIAN (documentos electrónicos) vs. auxiliar contable.
 *
 * A diferencia del cruce banco/contabilidad, aquí el número de documento es
 * (o debería ser) una llave casi determinística: una factura electrónica
 * válida trae NIT + prefijo/número únicos. Por eso el bloqueo de candidatos
 * se hace por NIT (no por rango de valor) y el número de documento pesa más
 * que el valor en el puntaje.
 *
 * Estrategia:
 *  1. Documentos RECHAZADO/ANULADO no requieren soporte contable: se marcan
 *     NO_VALIDO directamente, sin intentar cruzarlos.
 *  2. Bloqueo de candidatos por NIT (o por número de documento si el reporte
 *     no trae NIT).
 *  3. Scoring multicriterio de cada par candidato.
 *  4. Asignación global 1:1 greedy por puntaje descendente.
 *  5. Reaplicación de las decisiones manuales del usuario.
 */

import type {
  DianDocStatus,
  DianManualOverrides,
  DianMatch,
  DianMatchReason,
  DianMatchStatus,
  DianReconciliationResult,
  DianTx,
  LedgerTx,
} from '../types';
import { EMPTY_DIAN_OVERRIDES } from '../types';
import { duplicateIds } from './engine';
import { daysBetween } from '../normalize/dates';
import { calcDV, nitEquals } from '../normalize/nit';
import { nameSimilarity, normalizeRef, refMatches } from '../normalize/text';

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

export interface DianWeights {
  document: number;
  nit: number;
  amount: number;
  date: number;
  thirdPartyName: number;
}

export interface DianTolerances {
  amountAbsolute: number;
  amountPercent: number;
  dateWindowDays: number;
  maxDateDays: number;
}

export interface DianThresholds {
  conciliado: number;
  probable: number;
  revision: number;
}

export interface DianConfig {
  weights: DianWeights;
  tolerances: DianTolerances;
  thresholds: DianThresholds;
  flagAmbiguous: boolean;
  maxCandidates: number;
}

export const DEFAULT_DIAN_CONFIG: DianConfig = {
  weights: {
    document: 45,
    nit: 15,
    amount: 25,
    date: 10,
    thirdPartyName: 5,
  },
  tolerances: {
    amountAbsolute: 100,
    amountPercent: 0.5,
    // Una factura suele contabilizarse días o semanas después de emitida.
    dateWindowDays: 10,
    maxDateDays: 60,
  },
  thresholds: {
    conciliado: 90,
    probable: 70,
    revision: 45,
  },
  flagAmbiguous: true,
  maxCandidates: 20,
};

export function cloneDianConfig(c: DianConfig): DianConfig {
  return {
    weights: { ...c.weights },
    tolerances: { ...c.tolerances },
    thresholds: { ...c.thresholds },
    flagAmbiguous: c.flagAmbiguous,
    maxCandidates: c.maxCandidates,
  };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                              */
/* ------------------------------------------------------------------ */

export interface DianPairScore {
  score: number;
  reasons: DianMatchReason[];
  amountDiff: number;
  daysDiff: number | null;
  explanation: string;
  viable: boolean;
}

const REJECTED: DianPairScore = {
  score: 0,
  reasons: [],
  amountDiff: 0,
  daysDiff: null,
  explanation: 'Descartado',
  viable: false,
};

function buildExplanation(reasons: DianMatchReason[]): string {
  const positives = reasons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
  if (!positives.length) return 'Sin criterios coincidentes';
  const parts = positives.slice(0, 3).map((r) => r.label);
  const extra = positives.length > 3 ? ' + ' + (positives.length - 3) + ' criterio(s) más' : '';
  return 'Coincidencia encontrada por ' + parts.join(' + ') + extra + '.';
}

export function scoreDianPair(doc: DianTx, ledger: LedgerTx, cfg: DianConfig): DianPairScore {
  const { weights: w, tolerances: t } = cfg;

  const bothNit = Boolean(doc.nit) && Boolean(ledger.thirdPartyId);
  if (bothNit && !nitEquals(doc.nit, ledger.thirdPartyId)) return REJECTED;

  // El auxiliar no tiene un filtro de "misma naturaleza" como el de banco: una
  // factura de compra suele generar dos líneas espejo (débito y crédito) y
  // cualquiera de las dos es un candidato válido. Por eso amountDiff compara
  // siempre en valor absoluto — comparar con el signo crudo de `ledger.amount`
  // marcaría como "diferencia de valor" un cruce exacto cuyo lado contable
  // resultó negativo.
  const ledgerAbs = Math.abs(ledger.amount);
  const amountDiff = Math.round((doc.amount - ledgerAbs) * 100) / 100;
  const absDiff = Math.abs(amountDiff);
  const tolerance = Math.max(t.amountAbsolute, (doc.amount * t.amountPercent) / 100);
  // Ventana ampliada: un documento puede diferir bastante en valor y seguir
  // siendo el mismo si el número de documento coincide exacto (ej. retención
  // en la fuente aplicada, nota crédito parcial).
  const diffWindow = Math.max(tolerance * 6, doc.amount);
  if (absDiff > diffWindow) return REJECTED;

  const daysDiff = daysBetween(doc.issueDate, ledger.date);
  if (daysDiff !== null && Math.abs(daysDiff) > t.maxDateDays) return REJECTED;

  const reasons: DianMatchReason[] = [];
  let points = 0;
  let max = 0;
  const add = (code: string, label: string, pts: number) => {
    if (pts <= 0) return;
    points += pts;
    reasons.push({ code, label, points: Math.round(pts * 10) / 10 });
  };

  // 1. Número de documento --------------------------------------------
  // Se prefiere el campo "número de factura" (si el auxiliar lo trae aparte
  // del comprobante contable interno) porque suele ser el que realmente
  // corresponde al folio DIAN; "documentNumber" es el respaldo genérico.
  max += w.document;
  const ledgerInvoice = normalizeRef(ledger.invoiceNumber);
  const ledgerDoc = normalizeRef(ledger.documentNumber);
  const docKey = doc.documentKey;
  const numberOnly = normalizeRef(doc.number);
  if (docKey && ledgerInvoice && docKey === ledgerInvoice) {
    add('DOCUMENTO', 'Mismo número de factura (' + (doc.prefix ? doc.prefix + ' ' : '') + doc.number + ')', w.document);
  } else if (docKey && ledgerDoc && docKey === ledgerDoc) {
    add('DOCUMENTO', 'Mismo número de documento (' + (doc.prefix ? doc.prefix + ' ' : '') + doc.number + ')', w.document);
  } else if (numberOnly && ledgerInvoice && ledgerInvoice.length >= 3 && ledgerInvoice.includes(numberOnly)) {
    add('DOCUMENTO_PARCIAL', 'Número de factura contenido en el registro contable', w.document * 0.85);
  } else if (numberOnly && ledgerDoc && ledgerDoc.length >= 3 && ledgerDoc.includes(numberOnly)) {
    add('DOCUMENTO_PARCIAL', 'Número de documento contenido en el registro contable', w.document * 0.85);
  } else if (numberOnly.length >= 3 && refMatches(numberOnly, ledger.description)) {
    add('DOCUMENTO_DESC', 'Número de documento hallado en la descripción contable', w.document * 0.6);
  } else {
    reasons.push({ code: 'DOCUMENTO_DIFERENTE', label: 'Número de documento no coincide', points: 0 });
  }

  // 2. NIT --------------------------------------------------------------
  if (bothNit) {
    max += w.nit;
    add('NIT', 'Mismo NIT', w.nit);
  }

  // 3. Valor --------------------------------------------------------------
  max += w.amount;
  if (absDiff <= 0.01) {
    add('VALOR_EXACTO', 'Valor exacto', w.amount);
  } else if (absDiff <= tolerance) {
    const closeness = tolerance > 0 ? 1 - absDiff / tolerance : 0;
    add('VALOR_APROX', 'Valor aproximado (diferencia de ' + absDiff.toLocaleString('es-CO') + ')', w.amount * Math.max(0, closeness));
  } else {
    reasons.push({
      code: 'VALOR_DIFERENTE',
      label: 'Diferencia de valor de ' + absDiff.toLocaleString('es-CO'),
      points: 0,
    });
  }

  // 4. Fecha --------------------------------------------------------------
  if (doc.issueDate && ledger.date) {
    max += w.date;
    const d = Math.abs(daysDiff ?? 0);
    if (d === 0) {
      add('FECHA_EXACTA', 'Misma fecha', w.date);
    } else if (d <= t.dateWindowDays) {
      add('FECHA_RANGO', 'Diferencia de ' + d + (d === 1 ? ' día' : ' días'), w.date * (1 - d / (t.dateWindowDays + 1)));
    } else {
      reasons.push({ code: 'FECHA_LEJANA', label: 'Diferencia de ' + d + ' días', points: 0 });
    }
  }

  // 5. Tercero (desempate menor) ------------------------------------------
  if (doc.thirdPartyName && ledger.thirdPartyName) {
    max += w.thirdPartyName;
    const sim = nameSimilarity(doc.thirdPartyName, ledger.thirdPartyName);
    if (sim >= 0.5) add('TERCERO', 'Tercero coincidente (' + Math.round(sim * 100) + '%)', w.thirdPartyName * sim);
  }

  const score = max > 0 ? Math.max(0, Math.min(100, (points / max) * 100)) : 0;

  return {
    score: Math.round(score * 10) / 10,
    reasons,
    amountDiff,
    daysDiff,
    explanation: buildExplanation(reasons),
    viable: true,
  };
}

/* ------------------------------------------------------------------ */
/* Clasificación                                                       */
/* ------------------------------------------------------------------ */

function classify(
  score: number,
  amountDiff: number,
  daysDiff: number | null,
  cfg: DianConfig,
  ambiguous: boolean,
): DianMatchStatus {
  const th = cfg.thresholds;
  const significantDiff = Math.abs(amountDiff) > 0.01;
  const farDate = daysDiff !== null && Math.abs(daysDiff) > cfg.tolerances.dateWindowDays;

  if (score < th.revision) return 'NO_CONCILIADO';
  if (significantDiff) return 'DIF_VALOR';
  if (farDate) return 'DIF_FECHA';
  if (score >= th.conciliado) return ambiguous ? 'REVISION' : 'CONCILIADO';
  if (score >= th.probable) return 'PROBABLE';
  return 'REVISION';
}

/* ------------------------------------------------------------------ */
/* Motor                                                               */
/* ------------------------------------------------------------------ */

function pairKey(dianId: string, ledgerId: string): string {
  return dianId + '|' + ledgerId;
}

export { pairKey as dianPairKey };

export interface DianReconcileInput {
  dian: DianTx[];
  ledger: LedgerTx[];
  config: DianConfig;
  overrides?: DianManualOverrides;
}

const VALID_STATUSES: DianDocStatus[] = ['VALIDADO', 'OTRO'];

export function reconcileDian(input: DianReconcileInput): DianReconciliationResult {
  const started = performance.now();
  const { dian, ledger, config: cfg } = input;
  const ov = input.overrides ?? EMPTY_DIAN_OVERRIDES;

  const rejected = new Set(ov.rejected);
  const ignoredDian = new Set(ov.ignoredDian);
  const ignoredLedger = new Set(ov.ignoredLedger);

  const dianById = new Map(dian.map((d) => [d.id, d]));
  const ledgerById = new Map(ledger.map((l) => [l.id, l]));

  // Llave de "partida doble": una factura de compra suele generar dos líneas
  // contables espejo (débito y crédito) con el mismo NIT + número de factura
  // o documento. Se usa tanto para no penalizar como "ambiguo" el que ambas
  // líneas sean candidatas igual de buenas, como para propagar la cobertura
  // a la línea que no quedó formalmente cruzada.
  const ledgerGroupKey = (l: LedgerTx): string => {
    const doc = normalizeRef(l.invoiceNumber) || normalizeRef(l.documentNumber);
    if (!l.thirdPartyId || !doc) return '';
    return l.thirdPartyId + '|' + doc;
  };

  const takenDian = new Set<string>();
  const takenLedger = new Set<string>();
  const matches: DianMatch[] = [];

  const pushMatch = (m: DianMatch) => {
    matches.push(m);
    takenDian.add(m.dianId);
    takenLedger.add(m.ledgerId);
  };

  /* --- 1. Documentos no válidos ante la DIAN: no requieren soporte --- */
  const notValid = new Set<string>();
  for (const d of dian) {
    if (!VALID_STATUSES.includes(d.status)) notValid.add(d.id);
  }

  /* --- 2. Vínculos manuales ------------------------------------------ */
  for (const link of ov.manualLinks) {
    const d = dianById.get(link.dianId);
    const l = ledgerById.get(link.ledgerId);
    if (!d || !l) continue;
    if (takenDian.has(d.id) || takenLedger.has(l.id)) continue;
    if (ignoredDian.has(d.id) || ignoredLedger.has(l.id)) continue;

    const s = scoreDianPair(d, l, cfg);
    pushMatch({
      id: 'MD' + (matches.length + 1),
      dianId: d.id,
      ledgerId: l.id,
      score: 100,
      status: 'CONCILIADO',
      reasons: [{ code: 'MANUAL', label: 'Vinculado manualmente por el usuario', points: 100 }, ...s.reasons],
      amountDiff: Math.round((d.amount - l.amount) * 100) / 100,
      daysDiff: s.daysDiff,
      origin: 'manual',
      explanation: 'Vinculación manual del usuario.',
    });
  }

  /* --- 3. Pares aceptados explícitamente ------------------------------ */
  for (const key of ov.accepted) {
    const [dianId, ledgerId] = key.split('|');
    const d = dianById.get(dianId);
    const l = ledgerById.get(ledgerId);
    if (!d || !l) continue;
    if (takenDian.has(dianId) || takenLedger.has(ledgerId)) continue;
    if (ignoredDian.has(dianId) || ignoredLedger.has(ledgerId)) continue;

    const s = scoreDianPair(d, l, cfg);
    pushMatch({
      id: 'MD' + (matches.length + 1),
      dianId,
      ledgerId,
      score: 100,
      status: 'CONCILIADO',
      reasons: [{ code: 'ACEPTADO', label: 'Coincidencia aceptada por el usuario', points: 100 }, ...s.reasons],
      amountDiff: Math.round((d.amount - l.amount) * 100) / 100,
      daysDiff: s.daysDiff,
      origin: 'manual',
      explanation: 'Aceptada manualmente. ' + s.explanation,
    });
  }

  /* --- 4. Candidatos automáticos (bloqueo por NIT) -------------------- */

  // Es común que un lado traiga el dígito de verificación pegado al NIT y el
  // otro no (ej. "8002421062" vs "800242106"). El índice de bloqueo debe ser
  // tan tolerante como `nitEquals`, o esos pares nunca llegan a competir por
  // puntaje: se registran/consultan ambas formas (con y sin DV).
  function nitIndexKeys(nit: string): string[] {
    if (nit.length < 9) return [nit];
    const base = nit.slice(0, -1);
    const dv = calcDV(base);
    return dv !== null && String(dv) === nit.slice(-1) ? [nit, base] : [nit];
  }

  const byNit = new Map<string, number[]>();
  const byDoc = new Map<string, number[]>();
  const addToDoc = (key: string, idx: number) => {
    if (!key) return;
    const arr = byDoc.get(key) ?? [];
    arr.push(idx);
    byDoc.set(key, arr);
  };
  ledger.forEach((l, idx) => {
    if (l.thirdPartyId) {
      for (const key of nitIndexKeys(l.thirdPartyId)) {
        const arr = byNit.get(key) ?? [];
        arr.push(idx);
        byNit.set(key, arr);
      }
    }
    addToDoc(normalizeRef(l.invoiceNumber), idx);
    addToDoc(normalizeRef(l.documentNumber), idx);
  });

  interface Pair {
    dianIdx: number;
    ledgerIdx: number;
    s: DianPairScore;
  }
  const pairs: Pair[] = [];

  dian.forEach((d, dianIdx) => {
    if (ignoredDian.has(d.id) || takenDian.has(d.id) || notValid.has(d.id)) return;

    const candidateIdx = new Set<number>();
    if (d.nit) {
      for (const key of nitIndexKeys(d.nit)) {
        if (byNit.has(key)) byNit.get(key)!.forEach((i) => candidateIdx.add(i));
      }
    }
    if (!candidateIdx.size && d.documentKey && byDoc.has(d.documentKey)) {
      byDoc.get(d.documentKey)!.forEach((i) => candidateIdx.add(i));
    }

    const scored: Pair[] = [];
    for (const ledgerIdx of candidateIdx) {
      const l = ledger[ledgerIdx];
      if (ignoredLedger.has(l.id) || takenLedger.has(l.id)) continue;
      if (rejected.has(pairKey(d.id, l.id))) continue;

      const s = scoreDianPair(d, l, cfg);
      if (!s.viable || s.score <= 0) continue;
      scored.push({ dianIdx, ledgerIdx, s });
    }

    scored.sort((x, y) => y.s.score - x.s.score);
    pairs.push(...scored.slice(0, cfg.maxCandidates));
  });

  /* --- 5. Asignación global greedy -------------------------------------- */

  pairs.sort((a, b) => {
    if (b.s.score !== a.s.score) return b.s.score - a.s.score;
    const ad = Math.abs(a.s.amountDiff) - Math.abs(b.s.amountDiff);
    if (ad !== 0) return ad;
    return Math.abs(a.s.daysDiff ?? 999) - Math.abs(b.s.daysDiff ?? 999);
  });

  // Grupo de cada candidato; si no tiene NIT+documento para agrupar, se usa
  // su propio id de línea (nunca coincide con otra línea, así que cuenta
  // como candidato distinto para efectos de ambigüedad).
  const groupForLedger = (l: LedgerTx): string => ledgerGroupKey(l) || 'ID:' + l.id;

  const topScoreByDian = new Map<string, { score: number; group: string }[]>();
  for (const p of pairs) {
    const id = dian[p.dianIdx].id;
    const list = topScoreByDian.get(id) ?? [];
    list.push({ score: p.s.score, group: groupForLedger(ledger[p.ledgerIdx]) });
    topScoreByDian.set(id, list);
  }

  for (const p of pairs) {
    const d = dian[p.dianIdx];
    const l = ledger[p.ledgerIdx];
    if (takenDian.has(d.id) || takenLedger.has(l.id)) continue;
    if (p.s.score < cfg.thresholds.revision) continue;

    const candidates = topScoreByDian.get(d.id) ?? [];
    const myGroup = groupForLedger(l);
    // Dos líneas espejo de la misma factura (mismo grupo) no cuentan como
    // candidatos "distintos" para efectos de ambigüedad.
    const competingGroups = new Set(
      candidates.filter((c) => Math.abs(c.score - p.s.score) < 0.05 && c.group !== myGroup).map((c) => c.group),
    );
    const ambiguous = cfg.flagAmbiguous && competingGroups.size > 0;

    const status = classify(p.s.score, p.s.amountDiff, p.s.daysDiff, cfg, ambiguous);

    pushMatch({
      id: 'MD' + (matches.length + 1),
      dianId: d.id,
      ledgerId: l.id,
      score: p.s.score,
      status,
      reasons: ambiguous
        ? [...p.s.reasons, { code: 'AMBIGUO', label: 'Existe más de un candidato con el mismo puntaje', points: 0 }]
        : p.s.reasons,
      amountDiff: p.s.amountDiff,
      daysDiff: p.s.daysDiff,
      origin: 'auto',
      explanation: ambiguous
        ? p.s.explanation + ' Requiere revisión: hay varios candidatos equivalentes.'
        : p.s.explanation,
    });
  }

  /* --- 6. Índices y estados finales -------------------------------------- */

  const byDian = new Map<string, DianMatch>();
  const byLedger = new Map<string, DianMatch>();
  for (const m of matches) {
    byDian.set(m.dianId, m);
    byLedger.set(m.ledgerId, m);
  }

  const dupLedger = duplicateIds(ledger, (l) => l.thirdPartyId + normalizeRef(l.documentNumber));

  // NITs que sí reportan documentos DIAN (válidos). Un renglón del auxiliar
  // cuyo tercero nunca aparece en el reporte DIAN no es responsabilidad de
  // esta conciliación (nómina, activos fijos, impuestos, etc.) — se marca
  // "fuera de alcance" en vez de inflar "sin soporte DIAN".
  const dianNitSet = new Set<string>();
  for (const d of dian) {
    if (!notValid.has(d.id) && d.nit) dianNitSet.add(d.nit);
  }

  // Cobertura por partida doble: si una de las dos líneas espejo quedó
  // cruzada contra la DIAN, la otra no debe verse como "sin soporte".
  const groupCoverage = new Map<string, DianMatch>();
  for (const l of ledger) {
    const m = byLedger.get(l.id);
    if (!m) continue;
    const key = ledgerGroupKey(l);
    if (key) groupCoverage.set(key, m);
  }

  const dianStatus = new Map<string, DianMatchStatus>();
  const ledgerStatus = new Map<string, DianMatchStatus>();
  const unmatchedDian: string[] = [];
  const unmatchedLedger: string[] = [];

  for (const d of dian) {
    if (ignoredDian.has(d.id)) {
      dianStatus.set(d.id, 'IGNORADO');
      continue;
    }
    if (notValid.has(d.id)) {
      dianStatus.set(d.id, 'NO_VALIDO');
      continue;
    }
    const m = byDian.get(d.id);
    if (m) {
      dianStatus.set(d.id, m.status);
    } else {
      dianStatus.set(d.id, 'NO_CONCILIADO');
      unmatchedDian.push(d.id);
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
      continue;
    }
    const sibling = groupCoverage.get(ledgerGroupKey(l));
    if (sibling) {
      ledgerStatus.set(l.id, sibling.status);
      continue;
    }
    const knownVendor = l.thirdPartyId && nitIndexKeys(l.thirdPartyId).some((k) => dianNitSet.has(k));
    if (!knownVendor) {
      ledgerStatus.set(l.id, 'FUERA_DE_ALCANCE');
      continue;
    }
    ledgerStatus.set(l.id, dupLedger.has(l.id) ? 'REVISION' : 'NO_CONCILIADO');
    unmatchedLedger.push(l.id);
  }

  return {
    matches,
    byDian,
    byLedger,
    dianStatus,
    ledgerStatus,
    unmatchedDian,
    unmatchedLedger,
    ignoredDian,
    ignoredLedger,
    runAt: new Date(),
    elapsedMs: Math.round(performance.now() - started),
  };
}
