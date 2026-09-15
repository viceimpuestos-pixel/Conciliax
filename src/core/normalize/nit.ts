/**
 * Normalización de NIT / documentos de identificación colombianos.
 * "900.123.456-7" -> base "900123456", dv "7".
 */

export interface NitParts {
  /** Sólo dígitos, sin dígito de verificación ni ceros a la izquierda. */
  base: string;
  /** Dígito de verificación si venía separado por guion. */
  dv: string | null;
  raw: string;
}

const DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Calcula el dígito de verificación DIAN de un NIT. */
export function calcDV(base: string): number | null {
  const digits = base.replace(/\D/g, '');
  if (!digits || digits.length > 15) return null;
  const rev = digits.split('').reverse();
  let sum = 0;
  for (let i = 0; i < rev.length; i++) sum += Number(rev[i]) * DV_WEIGHTS[i];
  const mod = sum % 11;
  if (mod === 0 || mod === 1) return mod;
  return 11 - mod;
}

export function parseNit(input: unknown): NitParts {
  const raw = input === null || input === undefined ? '' : String(input).trim();
  if (!raw) return { base: '', dv: null, raw: '' };

  // Formato con guion: 900123456-7
  const dashed = raw.match(/^\s*([\d.,\s]+)\s*-\s*(\d)\s*$/);
  if (dashed) {
    const base = dashed[1].replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    return { base, dv: dashed[2], raw };
  }

  const digits = raw.replace(/\D/g, '');
  if (!digits) return { base: '', dv: null, raw };

  const base = digits.replace(/^0+(?=\d)/, '');
  return { base, dv: null, raw };
}

/** Devuelve el NIT canónico (sólo base) para comparar. */
export function normalizeNit(input: unknown): string {
  return parseNit(input).base;
}

/**
 * Compara dos identificaciones. Tolera que una traiga el DV pegado
 * (9001234567 vs 900123456) verificando el dígito calculado.
 */
export function nitEquals(a: unknown, b: unknown): boolean {
  const na = normalizeNit(a);
  const nb = normalizeNit(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Uno incluye el DV pegado al final
  if (na.length === nb.length + 1 && na.startsWith(nb)) {
    return String(calcDV(nb)) === na.slice(-1);
  }
  if (nb.length === na.length + 1 && nb.startsWith(na)) {
    return String(calcDV(na)) === nb.slice(-1);
  }
  return false;
}

/** Formato de presentación: 900.123.456-7 */
export function formatNit(input: unknown): string {
  const { base, dv } = parseNit(input);
  if (!base) return '—';
  const grouped = base.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const check = dv ?? (base.length >= 8 ? String(calcDV(base) ?? '') : '');
  return check ? grouped + '-' + check : grouped;
}
