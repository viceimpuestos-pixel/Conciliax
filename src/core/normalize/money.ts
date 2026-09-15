/**
 * Normalización de valores monetarios.
 * Soporta formatos colombianos ($ 1.234.567,89), anglosajones (1,234,567.89),
 * negativos entre paréntesis, sufijos CR/DB y texto suelto.
 */

export type DecimalHint = 'auto' | 'coma' | 'punto';

const CURRENCY_NOISE = /[$€£¥]|\bCOP\b|\bUSD\b|\bPESOS?\b|\bM\/?CTE\b/gi;

/**
 * Convierte cualquier representación de un valor a número.
 * Devuelve 0 para vacíos.
 */
export function parseMoney(input: unknown, hint: DecimalHint = 'auto'): number {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  if (input instanceof Date) return 0;

  let s = String(input).trim();
  if (!s) return 0;

  let negative = false;

  // (1.234) => negativo en notación contable
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s.replace(CURRENCY_NOISE, ' ');
  s = s.replace(/\b(CR|DB|CREDITO|CRÉDITO|DEBITO|DÉBITO)\b/gi, ' ');

  if (s.includes('-')) negative = true;

  // Deja sólo dígitos y separadores
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return 0;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;

  let decimalSep: '.' | ',' | null = null;

  if (hint === 'coma') {
    decimalSep = commas > 0 ? ',' : null;
  } else if (hint === 'punto') {
    decimalSep = dots > 0 ? '.' : null;
  } else if (dots > 0 && commas > 0) {
    // El separador que aparece de último es el decimal.
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (dots > 0 || commas > 0) {
    const sep: '.' | ',' = dots > 0 ? '.' : ',';
    const occurrences = dots > 0 ? dots : commas;
    const tail = s.slice(s.lastIndexOf(sep) + 1);
    // Varios separadores iguales => miles.
    // Uno solo seguido de 3 dígitos => miles (uso colombiano). 1 ó 2 dígitos => decimales.
    if (occurrences > 1) decimalSep = null;
    else if (tail.length === 3) decimalSep = null;
    else if (tail.length > 0 && tail.length <= 2) decimalSep = sep;
    else decimalSep = null;
  }

  let normalized: string;
  if (decimalSep === '.') {
    normalized = s.replace(/,/g, '').replace(/\.(?=.*\.)/g, '');
  } else if (decimalSep === ',') {
    normalized = s.replace(/\./g, '').replace(/,(?=.*,)/g, '').replace(',', '.');
  } else {
    normalized = s.replace(/[.,]/g, '');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return 0;
  return negative ? -Math.abs(value) : value;
}

/** Redondea a 2 decimales evitando errores de coma flotante. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const COP_DEC = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(n: number | null | undefined, decimals = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return (decimals ? COP_DEC : COP).format(n);
}

const NUM = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return NUM.format(n);
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return sign + '$' + (abs / 1_000_000_000).toFixed(1) + 'MM';
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return sign + '$' + (abs / 1_000).toFixed(0) + 'K';
  return sign + '$' + abs.toFixed(0);
}

export function formatPercent(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(decimals) + '%';
}
