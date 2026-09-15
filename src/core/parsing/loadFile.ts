/**
 * Punto único de entrada para cargar cualquier archivo soportado:
 * Excel (.xlsx/.xlsm/.xls), CSV/TXT y PDF de texto.
 */

import type { RawSheet } from '../types';
import { readWorkbook } from './fileReader';
import { isPdf, readPdfBuffer, type PdfReadResult } from './pdfReader';

export type SourceFormat = 'excel' | 'csv' | 'pdf';

export interface LoadedFile {
  format: SourceFormat;
  sheet: RawSheet;
  /** Se conserva para poder releer con otra hoja / otra fila de encabezado. */
  buffer: ArrayBuffer;
  /** Sólo para PDF. */
  pdf?: { pages: number; inferredYear: number | null; scanned: boolean; fullText: string };
  warnings: string[];
}

export function detectFormat(fileName: string, mime?: string): SourceFormat {
  if (isPdf({ name: fileName, type: mime })) return 'pdf';
  if (/\.(csv|txt|tsv)$/i.test(fileName)) return 'csv';
  return 'excel';
}

export interface LoadOptions {
  sheetName?: string;
  headerRowIndex?: number;
  /** Año para completar fechas cortas de un PDF. */
  year?: number;
}

export async function loadBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  mime?: string,
  opts: LoadOptions = {},
): Promise<LoadedFile> {
  const format = detectFormat(fileName, mime);
  const warnings: string[] = [];

  if (format === 'pdf') {
    const res: PdfReadResult = await readPdfBuffer(buffer, fileName, {
      headerRowIndex: opts.headerRowIndex,
      year: opts.year,
    });

    if (res.scanned) {
      warnings.push(
        'El PDF no contiene texto seleccionable (parece escaneado). Se requiere una versión digital del extracto o pasarlo por OCR antes de importarlo.',
      );
    }
    if (!res.scanned && res.rows.length === 0) {
      warnings.push('Se leyó el PDF pero no se reconocieron filas de movimientos. Ajuste la fila de encabezado.');
    }
    if (res.inferredYear) {
      warnings.push('Año del extracto detectado: ' + res.inferredYear + '. Se usa para completar fechas sin año.');
    }

    return {
      format,
      sheet: res,
      buffer,
      pdf: {
        pages: res.pages,
        inferredYear: res.inferredYear,
        scanned: res.scanned,
        fullText: res.fullText,
      },
      warnings,
    };
  }

  const sheet = readWorkbook(buffer, fileName, {
    sheetName: opts.sheetName,
    headerRowIndex: opts.headerRowIndex,
  });

  if (!sheet.rows.length) warnings.push('El archivo no contiene filas de datos por debajo del encabezado detectado.');

  return { format, sheet, buffer, warnings };
}

export async function loadFile(file: File, opts: LoadOptions = {}): Promise<LoadedFile> {
  const buffer = await file.arrayBuffer();
  return loadBuffer(buffer, file.name, file.type, opts);
}

export const ACCEPTED_EXTENSIONS = '.xlsx,.xlsm,.xls,.csv,.txt,.tsv,.pdf';
