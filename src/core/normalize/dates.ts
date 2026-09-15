/**
 * Normalización de fechas: objetos Date, seriales de Excel y cadenas en
 * múltiples formatos (día primero por defecto, uso colombiano).
 */

const MONTHS: Record<string, number> = {
  ene: 0, enero: 0, jan: 0, january: 0,
  feb: 1, febrero: 1, february: 1,
  mar: 2, marzo: 2, march: 2,
  abr: 3, abril: 3, apr: 3, april: 3,
  may: 4, mayo: 4,
  jun: 5, junio: 5, june: 5,
  jul: 6, julio: 6, july: 6,
  ago: 7, agosto: 7, aug: 7, august: 7,
  sep: 8, sept: 8, septiembre: 8, september: 8,
  oct: 9, octubre: 9, october: 9,
  nov: 10, noviembre: 10, november: 10,
  dic: 11, diciembre: 11, dec: 11, december: 11,
};

function deaccent(s: string): string {
  return s.normalize('NFD').split('').filter((c) => { const k = c.charCodeAt(0); return k < 0x300 || k > 0x36f; }).join('');
}

/** Construye una fecha validada, fijada a mediodía local (inmune a husos horarios). */
function mk(y: number, m: number, d: number): Date | null {
  let year = y;
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const dt = new Date(year, m, d, 12, 0, 0, 0);
  if (dt.getFullYear() !== year || dt.getMonth() !== m || dt.getDate() !== d) return null;
  if (year < 1900 || year > 2200) return null;
  return dt;
}

/** Serial de Excel (epoch 1900) -> Date. */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 60000) return null;
  const utc = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  return mk(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export type DateOrder = 'auto' | 'dmy' | 'mdy' | 'ymd';

/** Convierte cualquier representación a Date. */
export function parseDate(input: unknown, order: DateOrder = 'auto'): Date | null {
  if (input === null || input === undefined || input === '') return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return mk(input.getFullYear(), input.getMonth(), input.getDate());
  }

  if (typeof input === 'number') return excelSerialToDate(input);

  let s = String(input).trim();
  if (!s) return null;

  // Serial numérico escrito como texto
  if (/^\d{5}$/.test(s)) {
    const asSerial = excelSerialToDate(Number(s));
    if (asSerial) return asSerial;
  }

  // Compactos: yyyymmdd o ddmmyyyy
  if (/^\d{8}$/.test(s)) {
    const head = Number(s.slice(0, 4));
    if (head >= 1900 && head <= 2200) {
      return mk(head, Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
    }
    return mk(Number(s.slice(4, 8)), Number(s.slice(2, 4)) - 1, Number(s.slice(0, 2)));
  }

  // yymmdd (frecuente en algunos extractos)
  if (/^\d{6}$/.test(s)) {
    return mk(Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)));
  }

  s = s.replace(/\bde\b/gi, ' ').replace(/\s+/g, ' ').trim();

  // "15 mar 2024" / "15-MAR-2024"
  const named = s.match(/^(\d{1,2})[\s\-/.]+([a-zA-ZáéíóúÁÉÍÓÚ]{3,10})[\s\-/.]+(\d{2,4})/);
  if (named) {
    const m = MONTHS[deaccent(named[2].toLowerCase())];
    if (m !== undefined) return mk(Number(named[3]), m, Number(named[1]));
  }

  // "MAR 15 2024"
  const named2 = s.match(/^([a-zA-ZáéíóúÁÉÍÓÚ]{3,10})[\s\-/.]+(\d{1,2})[\s\-/.,]+(\d{2,4})/);
  if (named2) {
    const m = MONTHS[deaccent(named2[1].toLowerCase())];
    if (m !== undefined) return mk(Number(named2[3]), m, Number(named2[2]));
  }

  // Numérico separado por / - . o espacio
  const parts = s.split(/[\s\-/.]+/).filter(Boolean);
  if (parts.length >= 3 && parts.slice(0, 3).every((p) => /^\d+$/.test(p))) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    const c = Number(parts[2]);
    if (parts[0].length === 4 || a > 31) return mk(a, b - 1, c); // ymd
    if (order === 'mdy') return mk(c, a - 1, b);
    if (order === 'ymd') return mk(a, b - 1, c);
    if (order === 'dmy') return mk(c, b - 1, a);
    // auto: día primero salvo que sea imposible
    if (a > 12 && b <= 12) return mk(c, b - 1, a);
    if (b > 12 && a <= 12) return mk(c, a - 1, b);
    return mk(c, b - 1, a);
  }

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) {
    const d = new Date(iso);
    return mk(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

export function daysBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + '/' + d.getFullYear();
}

/** Clave de mes ordenable: "2024-03". */
export function monthKey(d: Date | null): string | null {
  if (!d) return null;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return (MONTH_SHORT[Number(m) - 1] ?? m) + ' ' + String(y).slice(2);
}

export function toISODate(d: Date | null): string {
  if (!d) return '';
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** Fecha desde un input type=date ("2024-03-15"). */
export function fromISODate(s: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return mk(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
