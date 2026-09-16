/**
 * Lectura de extractos bancarios en PDF.
 *
 * Los extractos de Bancolombia (y de la mayoría de bancos) son PDF de texto:
 * cada palabra viene con su coordenada X/Y. Reconstruimos la tabla en tres pasos:
 *
 *   1. Agrupar los fragmentos de texto en LÍNEAS por su coordenada Y.
 *   2. Descubrir las COLUMNAS agrupando las coordenadas X donde empiezan las
 *      palabras (las tablas están alineadas, así que los inicios se repiten).
 *   3. Volcar cada línea en una matriz -> se reutiliza el mismo pipeline de
 *      detección de columnas que se usa para Excel/CSV.
 *
 * Si el PDF es escaneado (imagen sin texto) se informa al usuario, porque
 * requeriría OCR.
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { RawSheet } from '../types';
import { detectHeaderRow } from './fileReader';
import { normalizeText } from '../normalize/text';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface Frag {
  page: number;
  x: number;
  y: number;
  w: number;
  text: string;
}

export interface PdfReadResult extends RawSheet {
  pages: number;
  /** Texto plano completo (para diagnóstico y detección del período). */
  fullText: string;
  /** Año inferido del encabezado del extracto, si las fechas vienen sin año. */
  inferredYear: number | null;
  scanned: boolean;
}

/** Tolerancia vertical para considerar que dos fragmentos van en la misma línea. */
const Y_TOLERANCE = 3.2;
/** Separación mínima en X para considerar que empieza otra columna. */
const COLUMN_GAP = 9;

/**
 * Fragmento con forma de cifra monetaria ("-20,239,000.00", "1,349,955,553.28").
 * Las columnas de dinero de un extracto vienen alineadas a la derecha, así que su
 * ancho variable rompe el clustering por inicio-de-columna (dos cifras del mismo
 * campo pueden empezar en X muy distintos). Se detectan por su forma de texto en
 * vez de por posición.
 */
const MONEY_TOKEN = /^-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?$|^-?\d+[.,]\d{2}$/;
const MONEY_HEADER_WORDS = new Set([
  'VALOR', 'SALDO', 'DEBITO', 'DEBITOS', 'CREDITO', 'CREDITOS', 'IMPORTE', 'MONTO',
  'DEBE', 'HABER', 'CARGO', 'CARGOS', 'ABONO', 'ABONOS',
]);

/* ------------------------------------------------------------------ */
/* Extracción de fragmentos                                            */
/* ------------------------------------------------------------------ */

async function extractFragments(data: ArrayBuffer): Promise<{ frags: Frag[]; pages: number }> {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const doc = await task.promise;
  const frags: Frag[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      const text = String(item.str ?? '');
      if (!text.trim()) continue;
      const tr = item.transform as number[];
      frags.push({
        page: p,
        x: Math.round(tr[4] * 10) / 10,
        y: Math.round(tr[5] * 10) / 10,
        w: item.width ?? 0,
        text: text.replace(/\s+/g, ' ').trim(),
      });
    }
    page.cleanup();
  }

  await doc.destroy();
  return { frags, pages: doc.numPages };
}

/* ------------------------------------------------------------------ */
/* Agrupación en líneas                                                */
/* ------------------------------------------------------------------ */

function groupLines(frags: Frag[]): Frag[][] {
  const byPage = new Map<number, Frag[]>();
  for (const f of frags) {
    const list = byPage.get(f.page) ?? [];
    list.push(f);
    byPage.set(f.page, list);
  }

  const lines: Frag[][] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const items = byPage.get(page)!.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    let current: Frag[] = [];
    let currentY = Number.NaN;

    for (const f of items) {
      if (Number.isNaN(currentY) || Math.abs(f.y - currentY) <= Y_TOLERANCE) {
        current.push(f);
        currentY = Number.isNaN(currentY) ? f.y : currentY;
      } else {
        if (current.length) lines.push(current.sort((a, b) => a.x - b.x));
        current = [f];
        currentY = f.y;
      }
    }
    if (current.length) lines.push(current.sort((a, b) => a.x - b.x));
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Descubrimiento de columnas                                          */
/* ------------------------------------------------------------------ */

/** Agrupa las coordenadas X de inicio en columnas. */
function discoverColumns(lines: Frag[][]): number[] {
  const starts: number[] = [];
  for (const line of lines) {
    // Sólo líneas con pinta de fila de tabla (3+ fragmentos)
    if (line.length < 3) continue;
    for (const f of line) starts.push(f.x);
  }
  if (!starts.length) return [];

  starts.sort((a, b) => a - b);
  const clusters: { x: number; count: number }[] = [];
  for (const x of starts) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.x <= COLUMN_GAP) {
      // media ponderada para estabilizar el borde de la columna
      last.x = (last.x * last.count + x) / (last.count + 1);
      last.count++;
    } else {
      clusters.push({ x, count: 1 });
    }
  }

  // Se descartan columnas anecdóticas (membretes, pies de página)
  const minCount = Math.max(2, Math.floor(lines.length * 0.05));
  return clusters.filter((c) => c.count >= minCount).map((c) => Math.round(c.x * 10) / 10);
}

/**
 * Corrige en el sitio las columnas de dinero (VALOR/SALDO/DÉBITO/CRÉDITO/...) de la
 * matriz ya armada, usando la forma del texto en vez del clustering por X.
 *
 * Para cada línea de datos se buscan los fragmentos con forma de cifra monetaria y,
 * si su cantidad coincide exactamente con la cantidad de columnas de dinero del
 * encabezado, se asignan en orden (izquierda a derecha). Si no coincide (línea de
 * membrete, resumen, etc.) se deja la celda tal como la dejó el clustering, sin
 * arriesgar un mal reemplazo.
 */
function reassignMoneyColumns(
  matrix: string[][],
  lines: Frag[][],
  headerRowIndex: number,
  headerCells: string[],
): void {
  if (matrix.length !== lines.length) return; // los índices deben corresponder 1:1

  const moneyColIdx = headerCells
    .map((h, idx) => ({ norm: normalizeText(h || ''), idx }))
    .filter(({ norm }) => MONEY_HEADER_WORDS.has(norm))
    .map(({ idx }) => idx);
  if (!moneyColIdx.length) return;

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const tokens = lines[i]
      .filter((f) => MONEY_TOKEN.test(f.text))
      .sort((a, b) => a.x - b.x);
    if (tokens.length !== moneyColIdx.length) continue;
    moneyColIdx.forEach((colIdx, k) => {
      matrix[i][colIdx] = tokens[k].text;
    });
  }
}

function assignToColumns(line: Frag[], columns: number[]): string[] {
  const cells = new Array<string>(columns.length).fill('');
  for (const f of line) {
    let idx = 0;
    for (let i = 0; i < columns.length; i++) {
      if (f.x >= columns[i] - COLUMN_GAP / 2) idx = i;
      else break;
    }
    cells[idx] = cells[idx] ? cells[idx] + ' ' + f.text : f.text;
  }
  return cells;
}

/* ------------------------------------------------------------------ */
/* Período / año                                                       */
/* ------------------------------------------------------------------ */

const MONTH_NAMES: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
};

/** Busca el año del extracto en el membrete ("DEL 01/03/2024 AL 31/03/2024"). */
export function inferPeriod(text: string): { year: number | null; month: number | null } {
  const t = normalizeText(text);

  const full = t.match(/\b(\d{1,2})[/\-](\d{1,2})[/\-](20\d{2})\b/);
  if (full) return { year: Number(full[3]), month: Number(full[2]) };

  const iso = t.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };

  const named = t.match(
    /\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\b[^0-9]{0,12}(20\d{2})\b/,
  );
  if (named) return { year: Number(named[2]), month: MONTH_NAMES[named[1]] ?? null };

  const yearOnly = t.match(/\b(20\d{2})\b/);
  return { year: yearOnly ? Number(yearOnly[1]) : null, month: null };
}

/** Completa fechas cortas "03/01" con el año del extracto. */
function expandShortDate(cell: string, year: number | null): string {
  if (!year) return cell;
  const m = cell.trim().match(/^(\d{1,2})[/\-](\d{1,2})$/);
  if (!m) return cell;
  return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + year;
}

/* ------------------------------------------------------------------ */
/* Lectura principal                                                   */
/* ------------------------------------------------------------------ */

export interface PdfReadOptions {
  headerRowIndex?: number;
  /** Año a usar cuando las fechas del PDF vienen sin año. */
  year?: number;
}

export async function readPdfBuffer(
  data: ArrayBuffer,
  fileName: string,
  opts: PdfReadOptions = {},
): Promise<PdfReadResult> {
  const { frags, pages } = await extractFragments(data);

  if (!frags.length) {
    return {
      fileName,
      sheetName: 'PDF',
      sheetNames: ['PDF'],
      headerRowIndex: 0,
      headers: [],
      rows: [],
      totalRows: 0,
      pages,
      fullText: '',
      inferredYear: null,
      scanned: true,
    };
  }

  const lines = groupLines(frags);
  const fullText = lines.map((l) => l.map((f) => f.text).join(' ')).join('\n');
  const period = inferPeriod(fullText.slice(0, 4000));
  const year = opts.year ?? period.year;

  const columns = discoverColumns(lines);

  let matrix: string[][];
  if (columns.length >= 3) {
    matrix = lines.map((line) => assignToColumns(line, columns).map((c) => expandShortDate(c, year)));
  } else {
    // Sin estructura de columnas: se entrega cada línea partida por espacios dobles.
    matrix = lines.map((line) => line.map((f) => expandShortDate(f.text, year)));
  }

  // Quita filas totalmente vacías y normaliza el ancho
  const width = matrix.reduce((m, r) => Math.max(m, r.length), 0);
  matrix = matrix
    .filter((r) => r.some((c) => c && c.trim() !== ''))
    .map((r) => {
      const copy = r.slice();
      while (copy.length < width) copy.push('');
      return copy;
    });

  const headerRowIndex = opts.headerRowIndex ?? detectHeaderRow(matrix, 40);
  const headerCells = matrix[headerRowIndex] ?? [];
  const headers = headerCells.map((h, i) => (h && h.trim() ? h.trim() : 'Columna ' + (i + 1)));

  reassignMoneyColumns(matrix, lines, headerRowIndex, headerCells);

  const headerSignature = normalizeText(headerCells.join(' '));
  const rows = matrix
    .slice(headerRowIndex + 1)
    // Los encabezados se repiten en cada página del PDF: se eliminan.
    .filter((r) => normalizeText(r.join(' ')) !== headerSignature)
    .filter((r) => r.some((c) => c && c.trim() !== ''));

  return {
    fileName,
    sheetName: 'PDF (' + pages + (pages === 1 ? ' página)' : ' páginas)'),
    sheetNames: ['PDF'],
    headerRowIndex,
    headers,
    rows,
    totalRows: rows.length,
    pages,
    fullText,
    inferredYear: year,
    scanned: false,
  };
}

export async function readPdfFile(file: File, opts: PdfReadOptions = {}): Promise<PdfReadResult> {
  const buf = await file.arrayBuffer();
  return readPdfBuffer(buf, file.name, opts);
}

export function isPdf(file: { name: string; type?: string }): boolean {
  return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
}
