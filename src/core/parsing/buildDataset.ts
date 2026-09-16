/**
 * Convierte una hoja cruda + un mapeo de columnas en un dataset normalizado
 * listo para conciliar, junto con validaciones y estadísticas.
 */

import type {
  BankTx,
  ColumnMapping,
  Dataset,
  DatasetStats,
  LedgerTx,
  RawSheet,
  ValidationIssue,
} from '../types';
import { parseMoney, round2, type DecimalHint } from '../normalize/money';
import { parseDate, type DateOrder } from '../normalize/dates';
import { normalizeText } from '../normalize/text';
import { normalizeNit } from '../normalize/nit';

export interface BuildOptions {
  dateOrder?: DateOrder;
  decimalHint?: DecimalHint;
  /**
   * Convención de signo del auxiliar:
   * - 'debito-ingreso' (por defecto): el auxiliar es la cuenta de bancos,
   *   por lo tanto un débito contable equivale a una entrada de dinero.
   * - 'credito-ingreso': el auxiliar es una cuenta espejo (proveedores/clientes).
   */
  ledgerSign?: 'debito-ingreso' | 'credito-ingreso';
  /** Descartar filas que parezcan totales/subtotales. */
  dropTotals?: boolean;
}

const DEFAULTS: Required<BuildOptions> = {
  dateOrder: 'auto',
  decimalHint: 'auto',
  ledgerSign: 'debito-ingreso',
  dropTotals: true,
};

function cell(row: unknown[], mapping: ColumnMapping, key: string): unknown {
  const idx = mapping[key];
  if (idx === undefined || idx < 0) return null;
  return row[idx] ?? null;
}

function str(row: unknown[], mapping: ColumnMapping, key: string): string {
  const v = cell(row, mapping, key);
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

const TOTAL_ROW = /^(TOTAL|TOTALES|SUBTOTAL|SUMA|SUMAS|SALDO FINAL|SALDO INICIAL|GRAN TOTAL)\b/;

function looksLikeTotal(row: unknown[]): boolean {
  const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
  if (!nonEmpty.length) return true;
  for (const c of nonEmpty) {
    if (typeof c === 'string' && TOTAL_ROW.test(normalizeText(c))) return true;
  }
  return false;
}

/**
 * Resuelve débito/crédito a partir de las columnas mapeadas.
 * Soporta: dos columnas (débito/crédito), una sola columna con signo, o ambas.
 */
function resolveAmounts(
  row: unknown[],
  mapping: ColumnMapping,
  hint: DecimalHint,
  /** true si un valor positivo en la columna única significa entrada de dinero */
  positiveIsInflow: boolean,
): { debit: number; credit: number } {
  const hasDebit = mapping.debit >= 0;
  const hasCredit = mapping.credit >= 0;
  const hasAmount = mapping.amount >= 0;

  let debit = hasDebit ? Math.abs(parseMoney(cell(row, mapping, 'debit'), hint)) : 0;
  let credit = hasCredit ? Math.abs(parseMoney(cell(row, mapping, 'credit'), hint)) : 0;

  if (hasAmount && debit === 0 && credit === 0) {
    const v = parseMoney(cell(row, mapping, 'amount'), hint);
    if (v !== 0) {
      const inflow = positiveIsInflow ? v > 0 : v < 0;
      if (inflow) credit = Math.abs(v);
      else debit = Math.abs(v);
    }
  }

  return { debit: round2(debit), credit: round2(credit) };
}

function computeStats(
  rows: { date: Date | null; debit: number; credit: number; thirdPartyId?: string; thirdPartyName?: string }[],
  total: number,
  duplicates: number,
): DatasetStats {
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  let totalDebit = 0;
  let totalCredit = 0;
  const parties = new Set<string>();

  for (const r of rows) {
    if (r.date) {
      if (!minDate || r.date < minDate) minDate = r.date;
      if (!maxDate || r.date > maxDate) maxDate = r.date;
    }
    totalDebit += r.debit;
    totalCredit += r.credit;
    const key = r.thirdPartyId || r.thirdPartyName;
    if (key) parties.add(key);
  }

  return {
    total,
    valid: rows.length,
    discarded: total - rows.length,
    minDate,
    maxDate,
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    net: round2(totalCredit - totalDebit),
    duplicates,
    distinctThirdParties: parties.size,
  };
}

/**
 * Marca duplicados: misma fecha + mismo valor + misma descripción/documento.
 *
 * Sólo se marca el caso clásico de duplicado accidental (EXACTAMENTE 2
 * coincidencias). Tres o más movimientos idénticos el mismo día casi siempre
 * son pagos recurrentes de valor fijo sin referencia propia (tasas, aranceles,
 * PSE a entidades de gobierno) — no un error de doble registro del banco.
 * Marcarlos a todos como "duplicado" es un falso positivo casi seguro.
 */
function markDuplicates(keys: string[]): Set<number> {
  const groups = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (!k) return;
    const list = groups.get(k);
    if (list) list.push(i);
    else groups.set(k, [i]);
  });
  const dupes = new Set<number>();
  for (const list of groups.values()) {
    if (list.length === 2) list.forEach((i) => dupes.add(i));
  }
  return dupes;
}

/* ------------------------------------------------------------------ */
/* Extracto bancario                                                   */
/* ------------------------------------------------------------------ */

export function buildBankDataset(
  sheet: RawSheet,
  mapping: ColumnMapping,
  options: BuildOptions = {},
): Dataset<BankTx> {
  const opts = { ...DEFAULTS, ...options };
  const issues: ValidationIssue[] = [];
  const rows: BankTx[] = [];
  const noDate: number[] = [];
  const noAmount: number[] = [];
  let discardedTotals = 0;

  sheet.rows.forEach((row, i) => {
    if (opts.dropTotals && looksLikeTotal(row)) {
      discardedTotals++;
      return;
    }

    const date = parseDate(cell(row, mapping, 'date'), opts.dateOrder);
    const { debit, credit } = resolveAmounts(row, mapping, opts.decimalHint, true);

    if (!date) noDate.push(i + sheet.headerRowIndex + 2);
    if (debit === 0 && credit === 0) {
      noAmount.push(i + sheet.headerRowIndex + 2);
      return; // sin valor no hay nada que conciliar
    }

    const balanceRaw = cell(row, mapping, 'balance');
    rows.push({
      id: 'B' + String(rows.length + 1).padStart(5, '0'),
      rowIndex: i + sheet.headerRowIndex + 2,
      date,
      valueDate: parseDate(cell(row, mapping, 'valueDate'), opts.dateOrder),
      description: str(row, mapping, 'description'),
      reference: str(row, mapping, 'reference'),
      document: str(row, mapping, 'document'),
      transactionNumber: str(row, mapping, 'transactionNumber'),
      debit,
      credit,
      amount: round2(credit - debit),
      balance: balanceRaw === null ? null : parseMoney(balanceRaw, opts.decimalHint),
      thirdPartyId: normalizeNit(cell(row, mapping, 'thirdPartyId')),
      thirdPartyName: str(row, mapping, 'thirdPartyName'),
      raw: rawRecord(sheet, row),
    });
  });

  const dupIdx = markDuplicates(
    rows.map((r) =>
      [r.date?.getTime() ?? 'nd', r.amount, normalizeText(r.description).slice(0, 40), r.document].join('|'),
    ),
  );

  if (noDate.length) {
    issues.push({
      level: 'warning',
      code: 'BANK_SIN_FECHA',
      message: 'Movimientos bancarios sin fecha reconocible. Se conciliarán sólo por valor y texto.',
      count: noDate.length,
      rows: noDate.slice(0, 20),
    });
  }
  if (noAmount.length) {
    issues.push({
      level: 'warning',
      code: 'BANK_SIN_VALOR',
      message: 'Filas descartadas por no tener débito ni crédito.',
      count: noAmount.length,
      rows: noAmount.slice(0, 20),
    });
  }
  if (discardedTotals) {
    issues.push({
      level: 'info',
      code: 'BANK_TOTALES',
      message: 'Filas de totales/subtotales omitidas automáticamente.',
      count: discardedTotals,
    });
  }
  if (dupIdx.size) {
    issues.push({
      level: 'warning',
      code: 'BANK_DUPLICADOS',
      message: 'Posibles movimientos bancarios duplicados (misma fecha, valor y descripción).',
      count: dupIdx.size,
      rows: [...dupIdx].slice(0, 20).map((i) => rows[i].rowIndex),
    });
  }
  if (!rows.length) {
    issues.push({
      level: 'error',
      code: 'BANK_VACIO',
      message: 'No se obtuvo ningún movimiento bancario válido. Revise el mapeo de columnas.',
    });
  }

  return {
    kind: 'bank',
    fileName: sheet.fileName,
    sheetName: sheet.sheetName,
    rows,
    mapping,
    headers: sheet.headers,
    issues,
    stats: computeStats(rows, sheet.rows.length, dupIdx.size),
  };
}

/* ------------------------------------------------------------------ */
/* Auxiliar contable                                                   */
/* ------------------------------------------------------------------ */

export function buildLedgerDataset(
  sheet: RawSheet,
  mapping: ColumnMapping,
  options: BuildOptions = {},
): Dataset<LedgerTx> {
  const opts = { ...DEFAULTS, ...options };
  const issues: ValidationIssue[] = [];
  const rows: LedgerTx[] = [];
  const noDate: number[] = [];
  const noAmount: number[] = [];
  const noThird: number[] = [];
  let discardedTotals = 0;

  const debitIsInflow = opts.ledgerSign === 'debito-ingreso';

  sheet.rows.forEach((row, i) => {
    if (opts.dropTotals && looksLikeTotal(row)) {
      discardedTotals++;
      return;
    }

    const date = parseDate(cell(row, mapping, 'date'), opts.dateOrder);
    // En el auxiliar, la columna única con signo positivo se interpreta como débito.
    const { debit, credit } = resolveAmounts(row, mapping, opts.decimalHint, debitIsInflow);

    if (!date) noDate.push(i + sheet.headerRowIndex + 2);
    if (debit === 0 && credit === 0) {
      noAmount.push(i + sheet.headerRowIndex + 2);
      return;
    }

    const nitRaw = str(row, mapping, 'thirdPartyId');
    const nit = normalizeNit(nitRaw);
    if (!nit) noThird.push(i + sheet.headerRowIndex + 2);

    const balanceRaw = cell(row, mapping, 'balance');
    rows.push({
      id: 'C' + String(rows.length + 1).padStart(5, '0'),
      rowIndex: i + sheet.headerRowIndex + 2,
      date,
      accountCode: str(row, mapping, 'accountCode'),
      accountName: str(row, mapping, 'accountName'),
      thirdPartyId: nit,
      thirdPartyIdRaw: nitRaw,
      thirdPartyName: str(row, mapping, 'thirdPartyName'),
      documentType: str(row, mapping, 'documentType'),
      documentNumber: str(row, mapping, 'documentNumber'),
      description: str(row, mapping, 'description'),
      debit,
      credit,
      amount: round2(debitIsInflow ? debit - credit : credit - debit),
      balance: balanceRaw === null ? null : parseMoney(balanceRaw, opts.decimalHint),
      raw: rawRecord(sheet, row),
    });
  });

  const dupIdx = markDuplicates(
    rows.map((r) =>
      [
        r.date?.getTime() ?? 'nd',
        r.amount,
        r.thirdPartyId,
        r.documentNumber || normalizeText(r.description).slice(0, 40),
      ].join('|'),
    ),
  );

  if (noDate.length) {
    issues.push({
      level: 'warning',
      code: 'AUX_SIN_FECHA',
      message: 'Movimientos contables sin fecha reconocible.',
      count: noDate.length,
      rows: noDate.slice(0, 20),
    });
  }
  if (noAmount.length) {
    issues.push({
      level: 'warning',
      code: 'AUX_SIN_VALOR',
      message: 'Filas descartadas por no tener débito ni crédito.',
      count: noAmount.length,
      rows: noAmount.slice(0, 20),
    });
  }
  if (noThird.length) {
    issues.push({
      level: 'info',
      code: 'AUX_SIN_NIT',
      message: 'Movimientos contables sin NIT. Se conciliarán por valor, fecha y descripción.',
      count: noThird.length,
      rows: noThird.slice(0, 20),
    });
  }
  if (discardedTotals) {
    issues.push({
      level: 'info',
      code: 'AUX_TOTALES',
      message: 'Filas de totales/subtotales omitidas automáticamente.',
      count: discardedTotals,
    });
  }
  if (dupIdx.size) {
    issues.push({
      level: 'warning',
      code: 'AUX_DUPLICADOS',
      message: 'Posibles movimientos contables duplicados (misma fecha, valor, tercero y documento).',
      count: dupIdx.size,
      rows: [...dupIdx].slice(0, 20).map((i) => rows[i].rowIndex),
    });
  }
  if (!rows.length) {
    issues.push({
      level: 'error',
      code: 'AUX_VACIO',
      message: 'No se obtuvo ningún movimiento contable válido. Revise el mapeo de columnas.',
    });
  }

  return {
    kind: 'ledger',
    fileName: sheet.fileName,
    sheetName: sheet.sheetName,
    rows,
    mapping,
    headers: sheet.headers,
    issues,
    stats: computeStats(rows, sheet.rows.length, dupIdx.size),
  };
}

/** Guarda la fila original indexada por encabezado (para el detalle en pantalla). */
function rawRecord(sheet: RawSheet, row: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  sheet.headers.forEach((h, i) => {
    const v = row[i];
    if (v !== null && v !== undefined && String(v).trim() !== '') out[h] = v;
  });
  return out;
}

/** Índices de filas duplicadas de un dataset ya construido. */
export function findDuplicateIds<T extends { id: string; date: Date | null; amount: number; description: string }>(
  rows: T[],
): Set<string> {
  const keys = rows.map((r) => [r.date?.getTime() ?? 'nd', r.amount, normalizeText(r.description).slice(0, 40)].join('|'));
  const idx = markDuplicates(keys);
  return new Set([...idx].map((i) => rows[i].id));
}
