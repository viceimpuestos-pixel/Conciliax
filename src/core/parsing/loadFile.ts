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
  pdf?: {
    pages: number;
    inferredYear: number | null;
    scanned: boolean;
    fullText: string;
    statement?: PdfReadResult['statement'];
  };
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
    if (res.statement) {
      const st = res.statement;
      warnings.push(
        'Extracto ' + (st.bank || 'bancario') + (st.accountNumber ? ' · cuenta ' + st.accountNumber : '') + ': ' +
          st.validated + ' movimientos leídos y validados contra el saldo del extracto.',
      );
      if (st.closingBalance !== null && st.lastBalance !== null && Math.abs(st.closingBalance - st.lastBalance) > 0.009) {
        warnings.push(
          'Atención: el saldo de la última fila leída (' + st.lastBalance.toLocaleString('es-CO') +
            ') no coincide con el saldo actual del extracto (' + st.closingBalance.toLocaleString('es-CO') +
            '). Puede faltar alguna página o movimiento.',
        );
      }
    } else if (res.inferredYear) {
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
        statement: res.statement,
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

/**
 * Pistas para saber a qué cuenta del auxiliar corresponde un extracto:
 * número de cuenta (membrete del PDF, columna "Cuenta" del Excel o nombre del
 * archivo) y nombre del banco.
 */
export function bankAccountHint(f: LoadedFile): { accountNumber: string; bankName: string; text: string } {
  if (f.pdf?.statement) {
    return { accountNumber: f.pdf.statement.accountNumber, bankName: f.pdf.statement.bank, text: f.pdf.fullText.slice(0, 3000) };
  }
  const cells: string[] = [];
  f.sheet.rows.slice(0, 40).forEach((r) => r.forEach((c) => c !== null && c !== undefined && cells.push(String(c))));
  const sample = [f.sheet.fileName, ...f.sheet.headers, ...cells].join(' ');
  const formatted = sample.match(/\b(\d{3}-\d{5,6}-\d{2})\b/);
  const fromName = f.sheet.fileName.match(/(\d{9,16})/);
  return {
    accountNumber: formatted ? formatted[1] : fromName ? fromName[1] : '',
    bankName: '',
    text: (f.pdf?.fullText ?? '').slice(0, 3000) + ' ' + f.sheet.fileName,
  };
}

export async function loadFile(file: File, opts: LoadOptions = {}): Promise<LoadedFile> {
  const buffer = await file.arrayBuffer();
  return loadBuffer(buffer, file.name, file.type, opts);
}

export const ACCEPTED_EXTENSIONS = '.xlsx,.xlsm,.xls,.csv,.txt,.tsv,.pdf';
