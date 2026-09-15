/**
 * Lectura de archivos XLSX / XLS / CSV / TXT hacia una matriz cruda,
 * con detección automática de la fila de encabezados.
 *
 * Los extractos de Bancolombia y los auxiliares contables suelen traer
 * varias filas de membrete antes de la tabla real; por eso no se asume
 * que la fila 1 sea el encabezado.
 */

import * as XLSX from 'xlsx';
import type { RawSheet } from '../types';
import { normalizeText } from '../normalize/text';
import { ALL_SYNONYMS } from './columnMap';

export interface ReadOptions {
  /** Nombre de hoja a leer; por defecto la primera con datos. */
  sheetName?: string;
  /** Forzar la fila de encabezados (índice base 0 dentro del archivo). */
  headerRowIndex?: number;
  /** Máximo de filas a inspeccionar buscando el encabezado. */
  scanRows?: number;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** Puntúa una fila como candidata a encabezado. */
function headerScore(row: unknown[]): number {
  const cells = row.filter((c) => !isBlank(c));
  if (cells.length < 2) return -1;

  let score = 0;
  let textCells = 0;
  let numericCells = 0;
  let known = 0;

  for (const cell of cells) {
    if (cell instanceof Date) {
      numericCells++;
      continue;
    }
    if (typeof cell === 'number') {
      numericCells++;
      continue;
    }
    const t = normalizeText(cell);
    if (!t) continue;
    if (/^\d+([.,]\d+)?$/.test(String(cell).trim())) {
      numericCells++;
      continue;
    }
    textCells++;
    if (t.length <= 40) score += 1;
    if (ALL_SYNONYMS.has(t)) known += 1;
  }

  // Un encabezado es mayoritariamente texto corto y contiene términos conocidos.
  score += known * 12;
  score += textCells * 2;
  score -= numericCells * 4;
  if (cells.length >= 4) score += 3;
  return score;
}

/** Detecta la fila de encabezados dentro de las primeras `scanRows` filas. */
export function detectHeaderRow(rows: unknown[][], scanRows = 30): number {
  const limit = Math.min(rows.length, scanRows);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < limit; i++) {
    const s = headerScore(rows[i]);
    // Exige que haya al menos una fila de datos debajo
    if (s > bestScore && i < rows.length - 1) {
      bestScore = s;
      best = i;
    }
  }
  return bestScore <= 0 ? 0 : best;
}

function buildHeaders(row: unknown[], width: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const v = row?.[i];
    const label = isBlank(v) ? '' : String(v).replace(/\s+/g, ' ').trim();
    out.push(label || 'Columna ' + (i + 1));
  }
  return out;
}

/** Convierte un ArrayBuffer de archivo en una hoja cruda lista para mapear. */
export function readWorkbook(data: ArrayBuffer, fileName: string, opts: ReadOptions = {}): RawSheet {
  const wb = XLSX.read(data, {
    type: 'array',
    cellDates: true,
    cellNF: false,
    cellText: false,
    raw: false,
    codepage: 65001,
  });

  const sheetNames = wb.SheetNames.slice();
  if (!sheetNames.length) throw new Error('El archivo no contiene hojas.');

  let sheetName = opts.sheetName && sheetNames.includes(opts.sheetName) ? opts.sheetName : '';
  if (!sheetName) {
    // Primera hoja con al menos 2 filas
    sheetName =
      sheetNames.find((n) => {
        const ref = wb.Sheets[n]['!ref'];
        if (!ref) return false;
        const range = XLSX.utils.decode_range(ref);
        return range.e.r - range.s.r >= 1;
      }) ?? sheetNames[0];
  }

  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });

  if (!matrix.length) {
    return {
      fileName,
      sheetName,
      sheetNames,
      headerRowIndex: 0,
      headers: [],
      rows: [],
      totalRows: 0,
    };
  }

  const width = matrix.reduce((max, r) => Math.max(max, r?.length ?? 0), 0);
  const headerRowIndex = opts.headerRowIndex ?? detectHeaderRow(matrix);
  const headers = buildHeaders(matrix[headerRowIndex] ?? [], width);

  const rows = matrix
    .slice(headerRowIndex + 1)
    .filter((r) => Array.isArray(r) && r.some((c) => !isBlank(c)));

  return {
    fileName,
    sheetName,
    sheetNames,
    headerRowIndex,
    headers,
    rows,
    totalRows: rows.length,
  };
}

/** Lee un File del navegador. */
export async function readFile(file: File, opts: ReadOptions = {}): Promise<RawSheet> {
  const buf = await file.arrayBuffer();
  return readWorkbook(buf, file.name, opts);
}

/** Reinterpreta una hoja ya cargada con otra hoja u otra fila de encabezado. */
export function rereadWorkbook(data: ArrayBuffer, fileName: string, opts: ReadOptions): RawSheet {
  return readWorkbook(data, fileName, opts);
}
