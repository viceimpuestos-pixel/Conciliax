/**
 * Scoring multicriterio entre un movimiento bancario y uno contable.
 *
 * Devuelve un puntaje 0..100 y la lista de razones que lo explican.
 * El puntaje se normaliza contra el máximo *aplicable* al par: si el extracto
 * no trae NIT, ese criterio no penaliza — simplemente no participa.
 */

import type { BankTx, LedgerTx, MatchReason } from '../types';
import type { ReconciliationConfig } from './config';
import { daysBetween } from '../normalize/dates';
import { nitEquals, normalizeNit } from '../normalize/nit';
import {
  extractNumbers,
  nameSimilarity,
  normalizeRef,
  normalizeText,
  refMatches,
  textSimilarity,
  tokenSetSimilarity,
} from '../normalize/text';

export interface PairScore {
  score: number;
  reasons: MatchReason[];
  amountDiff: number;
  daysDiff: number | null;
  explanation: string;
  /** false => el par es imposible (naturaleza opuesta o fecha fuera de rango). */
  viable: boolean;
}

const REJECTED: PairScore = {
  score: 0,
  reasons: [],
  amountDiff: 0,
  daysDiff: null,
  explanation: 'Descartado',
  viable: false,
};

/** Texto del lado bancario donde suele esconderse el tercero/documento. */
function bankHaystack(b: BankTx): string {
  return [b.description, b.reference, b.document, b.transactionNumber, b.thirdPartyName]
    .filter(Boolean)
    .join(' ');
}

export function scorePair(bank: BankTx, ledger: LedgerTx, cfg: ReconciliationConfig): PairScore {
  const { weights: w, tolerances: t, options: o } = cfg;

  const bankAbs = Math.abs(bank.amount);
  const ledgerAbs = Math.abs(ledger.amount);
  const amountDiff = Math.round((bank.amount - ledger.amount) * 100) / 100;
  const absDiff = Math.abs(bankAbs - ledgerAbs);
  const daysDiff = daysBetween(bank.date, ledger.date);

  /* --- Filtros duros ------------------------------------------------ */

  const sameDirection = Math.sign(bank.amount) === Math.sign(ledger.amount);
  if (o.requireDirectionMatch && !sameDirection) return REJECTED;

  if (daysDiff !== null && Math.abs(daysDiff) > t.maxDateDays) return REJECTED;

  const tolerance = Math.max(t.amountAbsolute, (bankAbs * t.amountPercent) / 100);
  // Ventana ampliada: permite detectar DIFERENCIAS DE VALOR (retención, GMF,
  // comisión). Estos pares no reciben puntos por valor, así que sólo sobreviven
  // si el tercero, el documento o la fecha los respaldan.
  const diffWindow = Math.max(
    tolerance,
    t.diffWindowAbsolute,
    (bankAbs * t.diffWindowPercent) / 100,
  );
  if (absDiff > Math.max(diffWindow, 0.01)) return REJECTED;

  /* --- Acumulación de puntos ---------------------------------------- */

  const reasons: MatchReason[] = [];
  let points = 0;
  let max = 0;

  const add = (code: string, label: string, pts: number) => {
    if (pts <= 0) return;
    points += pts;
    reasons.push({ code, label, points: Math.round(pts * 10) / 10 });
  };

  // 1-2. Valor -------------------------------------------------------
  max += w.exactAmount;
  if (absDiff <= 0.01) {
    add('VALOR_EXACTO', 'Valor exacto', w.exactAmount);
  } else if (absDiff <= tolerance) {
    const closeness = tolerance > 0 ? 1 - absDiff / tolerance : 0;
    add(
      'VALOR_APROX',
      'Valor aproximado (diferencia de ' + absDiff.toLocaleString('es-CO') + ')',
      w.approxAmount * Math.max(0, closeness),
    );
  } else {
    reasons.push({
      code: 'VALOR_DIFERENTE',
      label: 'Diferencia de valor de ' + absDiff.toLocaleString('es-CO'),
      points: 0,
    });
  }

  // 3-4. Fecha -------------------------------------------------------
  if (bank.date && ledger.date) {
    max += w.exactDate;
    const d = Math.abs(daysDiff ?? 0);
    if (d === 0) {
      add('FECHA_EXACTA', 'Misma fecha', w.exactDate);
    } else if (d <= t.dateWindowDays) {
      const pts = w.dateWindow * (1 - d / (t.dateWindowDays + 1));
      add('FECHA_RANGO', 'Diferencia de ' + d + (d === 1 ? ' día' : ' días'), pts);
    } else {
      reasons.push({
        code: 'FECHA_LEJANA',
        label: 'Diferencia de ' + d + ' días (fuera del rango configurado)',
        points: 0,
      });
    }
  }

  // 10. Naturaleza ---------------------------------------------------
  max += w.direction;
  if (sameDirection) {
    const label =
      bank.amount > 0
        ? 'Naturaleza coherente (crédito bancario / débito contable)'
        : 'Naturaleza coherente (débito bancario / crédito contable)';
    add('NATURALEZA', label, w.direction);
  } else {
    reasons.push({ code: 'NATURALEZA_OPUESTA', label: 'Naturaleza opuesta', points: 0 });
  }

  const haystack = bankHaystack(bank);

  // 5. NIT -----------------------------------------------------------
  const ledgerNit = normalizeNit(ledger.thirdPartyId);
  if (ledgerNit) {
    if (bank.thirdPartyId) {
      max += w.nit;
      if (nitEquals(bank.thirdPartyId, ledgerNit)) add('NIT', 'Mismo NIT', w.nit);
    } else if (ledgerNit.length >= 6) {
      // El extracto no trae columna de NIT: se busca dentro de la descripción.
      const found = extractNumbers(haystack, 6).some((n) => nitEquals(n, ledgerNit));
      if (found) {
        max += w.nit;
        add('NIT_TEXTO', 'NIT del tercero encontrado en la descripción bancaria', w.nit);
      }
    }
  }

  // 6. Nombre del tercero --------------------------------------------
  const ledgerName = ledger.thirdPartyName;
  if (ledgerName && ledgerName.length > 3) {
    let sim = 0;
    if (bank.thirdPartyName) {
      sim = nameSimilarity(bank.thirdPartyName, ledgerName);
      max += w.thirdPartyName;
    } else if (haystack) {
      // ¿Aparecen las palabras del tercero dentro del texto bancario?
      sim = tokenSetSimilarity(ledgerName, haystack);
      const compact = normalizeText(ledgerName).replace(/\s/g, '');
      if (compact.length > 5 && normalizeText(haystack).replace(/\s/g, '').includes(compact)) sim = 1;
      if (sim >= t.nameMin) max += w.thirdPartyName;
    }
    if (sim >= t.nameMin) {
      add('TERCERO', 'Tercero coincidente (' + Math.round(sim * 100) + '%)', w.thirdPartyName * sim);
    }
  }

  // 8. Número de documento -------------------------------------------
  const docLedger = normalizeRef(ledger.documentNumber);
  if (docLedger && docLedger.length >= 3) {
    const bankDocs = [bank.document, bank.transactionNumber, bank.reference]
      .map(normalizeRef)
      .filter(Boolean);
    const exact = bankDocs.some((d) => d === docLedger);
    const inside = !exact && refMatches(docLedger, haystack);
    if (exact || inside) {
      max += w.documentNumber;
      add(
        'DOCUMENTO',
        exact
          ? 'Mismo número de documento (' + ledger.documentNumber + ')'
          : 'Documento ' + ledger.documentNumber + ' hallado en el texto bancario',
        exact ? w.documentNumber : w.documentNumber * 0.8,
      );
    }
  }

  // 7. Referencia -----------------------------------------------------
  const refBank = normalizeRef(bank.reference || bank.transactionNumber);
  if (refBank && refBank.length >= 4) {
    const ledgerText = [ledger.description, ledger.documentNumber].filter(Boolean).join(' ');
    if (ledgerText && refMatches(refBank, ledgerText)) {
      max += w.reference;
      add('REFERENCIA', 'Referencia ' + refBank + ' presente en el movimiento contable', w.reference);
    }
  }

  // 9. Descripción ----------------------------------------------------
  if (bank.description && ledger.description) {
    const sim = textSimilarity(bank.description, ledger.description);
    if (sim >= t.descriptionMin) {
      max += w.description;
      add('DESCRIPCION', 'Descripción similar (' + Math.round(sim * 100) + '%)', w.description * sim);
    }
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

/** Construye la frase legible que explica el cruce. */
export function buildExplanation(reasons: MatchReason[]): string {
  const positives = reasons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
  if (!positives.length) return 'Sin criterios coincidentes';
  const parts = positives.slice(0, 4).map((r) => r.label);
  const extra = positives.length > 4 ? ' + ' + (positives.length - 4) + ' criterio(s) más' : '';
  return 'Coincidencia encontrada por ' + parts.join(' + ') + extra + '.';
}
