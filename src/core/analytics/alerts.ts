/**
 * Panel de alertas: detecta situaciones que requieren atención del contador.
 */

import type { BankTx, LedgerTx, ReconciliationResult } from '../types';
import { round2 } from '../normalize/money';
import { formatDate } from '../normalize/dates';
import type { ThirdPartySummary } from './aggregations';

export type AlertSeverity = 'critica' | 'alta' | 'media' | 'baja';

export type AlertKind =
  | 'BANCO_SIN_CONTABILIDAD'
  | 'CONTABILIDAD_SIN_BANCO'
  | 'DIFERENCIA_VALOR'
  | 'DIFERENCIA_FECHA'
  | 'DUPLICADO'
  | 'MOVIMIENTO_INUSUAL'
  | 'TERCERO_RECURRENTE'
  | 'ALTO_VALOR_PENDIENTE'
  | 'REVISION_MANUAL';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  value: number;
  date: Date | null;
  bankIds: string[];
  ledgerIds: string[];
  /** Prioridad numérica para ordenar (mayor = más urgente). */
  priority: number;
}

const SEVERITY_WEIGHT: Record<AlertSeverity, number> = {
  critica: 1000,
  alta: 700,
  media: 400,
  baja: 100,
};

export interface AlertOptions {
  /** Valor a partir del cual un pendiente se considera de alto impacto. */
  highValueThreshold?: number;
  /** Nº de veces que un tercero debe presentar diferencias para alertar. */
  recurrentThreshold?: number;
}

/** Umbral automático: percentil 90 de los valores absolutos. */
function autoHighValue(bank: BankTx[]): number {
  if (!bank.length) return 1_000_000;
  const values = bank.map((b) => Math.abs(b.amount)).sort((a, b) => a - b);
  const idx = Math.floor(values.length * 0.9);
  return Math.max(values[Math.min(idx, values.length - 1)], 500_000);
}

/** Movimiento inusual: se aparta más de 3 desviaciones del promedio. */
function unusualThreshold(bank: BankTx[]): { mean: number; limit: number } {
  const values = bank.map((b) => Math.abs(b.amount));
  if (values.length < 5) return { mean: 0, limit: Infinity };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return { mean, limit: mean + 3 * sd };
}

export function buildAlerts(
  bank: BankTx[],
  ledger: LedgerTx[],
  result: ReconciliationResult,
  thirdParties: ThirdPartySummary[],
  options: AlertOptions = {},
): Alert[] {
  const alerts: Alert[] = [];
  const highValue = options.highValueThreshold ?? autoHighValue(bank);
  const recurrent = options.recurrentThreshold ?? 3;
  const { limit } = unusualThreshold(bank);

  const bankById = new Map(bank.map((b) => [b.id, b]));
  const ledgerById = new Map(ledger.map((l) => [l.id, l]));

  let n = 0;
  const push = (a: Omit<Alert, 'id' | 'priority'>) => {
    alerts.push({
      ...a,
      id: 'A' + ++n,
      priority: SEVERITY_WEIGHT[a.severity] + Math.min(299, Math.abs(a.value) / 100000),
    });
  };

  /* 1. Movimientos bancarios sin registro contable --------------------- */
  for (const id of result.unmatchedBank) {
    const b = bankById.get(id);
    if (!b) continue;
    if (result.ignoredBank.has(id)) continue;
    const abs = Math.abs(b.amount);
    const isHigh = abs >= highValue;
    push({
      kind: 'BANCO_SIN_CONTABILIDAD',
      severity: isHigh ? 'critica' : abs >= highValue / 4 ? 'alta' : 'media',
      title: 'Movimiento bancario sin registro contable',
      detail:
        formatDate(b.date) + ' · ' + (b.description || 'Sin descripción') +
        (b.reference ? ' · Ref. ' + b.reference : ''),
      value: b.amount,
      date: b.date,
      bankIds: [id],
      ledgerIds: [],
    });
  }

  /* 2. Movimientos contables sin movimiento bancario ------------------- */
  for (const id of result.unmatchedLedger) {
    const l = ledgerById.get(id);
    if (!l) continue;
    if (result.ignoredLedger.has(id)) continue;
    const abs = Math.abs(l.amount);
    const isHigh = abs >= highValue;
    push({
      kind: 'CONTABILIDAD_SIN_BANCO',
      severity: isHigh ? 'critica' : abs >= highValue / 4 ? 'alta' : 'media',
      title: 'Registro contable sin movimiento bancario',
      detail:
        formatDate(l.date) + ' · ' + (l.thirdPartyName || 'Sin tercero') +
        (l.documentNumber ? ' · Doc. ' + l.documentNumber : '') +
        (l.accountCode ? ' · Cuenta ' + l.accountCode : ''),
      value: l.amount,
      date: l.date,
      bankIds: [],
      ledgerIds: [id],
    });
  }

  /* 3-4. Diferencias en los cruces ------------------------------------- */
  for (const m of result.matches) {
    const b = bankById.get(m.bankId);
    const l = ledgerById.get(m.ledgerId);
    if (!b || !l) continue;

    if (Math.abs(m.amountDiff) > 0.01) {
      const abs = Math.abs(m.amountDiff);
      push({
        kind: 'DIFERENCIA_VALOR',
        severity: abs >= highValue / 10 ? 'alta' : 'media',
        title: 'Diferencia de valor entre banco y contabilidad',
        detail:
          (l.thirdPartyName || b.description || 'Movimiento') +
          ' · Banco ' + b.amount.toLocaleString('es-CO') +
          ' vs Contabilidad ' + l.amount.toLocaleString('es-CO'),
        value: m.amountDiff,
        date: b.date,
        bankIds: [b.id],
        ledgerIds: [l.id],
      });
    }

    if (m.status === 'DIF_FECHA' && m.daysDiff !== null) {
      push({
        kind: 'DIFERENCIA_FECHA',
        severity: Math.abs(m.daysDiff) > 15 ? 'alta' : 'baja',
        title: 'Diferencia de fecha de ' + Math.abs(m.daysDiff) + ' días',
        detail:
          'Banco ' + formatDate(b.date) + ' vs Contabilidad ' + formatDate(l.date) +
          ' · ' + (l.thirdPartyName || b.description),
        value: b.amount,
        date: b.date,
        bankIds: [b.id],
        ledgerIds: [l.id],
      });
    }

    if (m.status === 'PROBABLE' || m.status === 'REVISION') {
      push({
        kind: 'REVISION_MANUAL',
        severity: 'baja',
        title: 'Coincidencia sugerida pendiente de aprobación',
        detail: 'Confianza ' + m.score.toFixed(0) + '%. ' + m.explanation,
        value: b.amount,
        date: b.date,
        bankIds: [b.id],
        ledgerIds: [l.id],
      });
    }
  }

  /* 5. Duplicados ------------------------------------------------------ */
  for (const id of result.duplicateBank) {
    const b = bankById.get(id);
    if (!b) continue;
    push({
      kind: 'DUPLICADO',
      severity: 'alta',
      title: 'Posible movimiento bancario duplicado',
      detail: formatDate(b.date) + ' · ' + (b.description || 'Sin descripción'),
      value: b.amount,
      date: b.date,
      bankIds: [id],
      ledgerIds: [],
    });
  }
  for (const id of result.duplicateLedger) {
    const l = ledgerById.get(id);
    if (!l) continue;
    push({
      kind: 'DUPLICADO',
      severity: 'alta',
      title: 'Posible registro contable duplicado',
      detail:
        formatDate(l.date) + ' · ' + (l.thirdPartyName || 'Sin tercero') +
        (l.documentNumber ? ' · Doc. ' + l.documentNumber : ''),
      value: l.amount,
      date: l.date,
      bankIds: [],
      ledgerIds: [id],
    });
  }

  /* 6. Movimientos inusuales ------------------------------------------- */
  if (Number.isFinite(limit)) {
    for (const b of bank) {
      if (Math.abs(b.amount) <= limit) continue;
      push({
        kind: 'MOVIMIENTO_INUSUAL',
        severity: 'media',
        title: 'Movimiento atípico por su cuantía',
        detail:
          formatDate(b.date) + ' · ' + (b.description || 'Sin descripción') +
          ' · Supera 3 desviaciones estándar del promedio del período.',
        value: b.amount,
        date: b.date,
        bankIds: [b.id],
        ledgerIds: [],
      });
    }
  }

  /* 7. Terceros con diferencias recurrentes ---------------------------- */
  for (const t of thirdParties) {
    const problemas = t.pendientes + t.noConciliados;
    if (problemas < recurrent) continue;
    push({
      kind: 'TERCERO_RECURRENTE',
      severity: problemas >= recurrent * 2 ? 'alta' : 'media',
      title: 'Tercero con diferencias recurrentes',
      detail:
        t.name + (t.nit ? ' (NIT ' + t.nit + ')' : '') +
        ' · ' + problemas + ' movimientos sin conciliar de ' + t.movimientos + '.',
      value: round2(t.valorPendiente + t.diferencia),
      date: null,
      bankIds: t.bankIds,
      ledgerIds: t.ledgerIds,
    });
  }

  /* 8. Alto valor pendiente -------------------------------------------- */
  for (const b of bank) {
    const status = result.bankStatus.get(b.id);
    if (!status || status === 'CONCILIADO' || status === 'IGNORADO') continue;
    if (Math.abs(b.amount) < highValue) continue;
    if (result.unmatchedBank.includes(b.id)) continue; // ya alertado arriba
    push({
      kind: 'ALTO_VALOR_PENDIENTE',
      severity: 'critica',
      title: 'Movimiento de alto valor pendiente de conciliación',
      detail: formatDate(b.date) + ' · ' + (b.description || 'Sin descripción'),
      value: b.amount,
      date: b.date,
      bankIds: [b.id],
      ledgerIds: [],
    });
  }

  return alerts.sort((a, b) => b.priority - a.priority);
}

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  BANCO_SIN_CONTABILIDAD: 'Banco sin contabilidad',
  CONTABILIDAD_SIN_BANCO: 'Contabilidad sin banco',
  DIFERENCIA_VALOR: 'Diferencia de valor',
  DIFERENCIA_FECHA: 'Diferencia de fecha',
  DUPLICADO: 'Duplicados',
  MOVIMIENTO_INUSUAL: 'Movimiento inusual',
  TERCERO_RECURRENTE: 'Tercero recurrente',
  ALTO_VALOR_PENDIENTE: 'Alto valor pendiente',
  REVISION_MANUAL: 'Revisión manual',
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};
