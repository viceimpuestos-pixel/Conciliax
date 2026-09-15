/**
 * Normalización y comparación de texto (descripciones, conceptos, nombres de terceros).
 */

/** Quita tildes/diacríticos sin usar clases unicode literales. */
export function deaccent(s: string): string {
  return s
    .normalize('NFD')
    .split('')
    .filter((c) => {
      const k = c.charCodeAt(0);
      return k < 0x300 || k > 0x36f;
    })
    .join('');
}

/**
 * MAYÚSCULAS, sin tildes, sin puntuación, espacios colapsados.
 * "  Pago  Prov.  Álvarez & Cía  " -> "PAGO PROV ALVAREZ CIA"
 */
export function normalizeText(input: unknown): string {
  if (input === null || input === undefined) return '';
  let s = String(input);
  if (!s.trim()) return '';
  s = deaccent(s).toUpperCase();
  s = s.replace(/[^A-Z0-9ÑÜ\s]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Palabras vacías y ruido típico de extractos y auxiliares contables. */
const STOPWORDS = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'A', 'EN', 'POR', 'PARA', 'CON', 'SU',
  'SA', 'SAS', 'LTDA', 'CIA', 'CO', 'INC', 'ESP', 'EU', 'SCA', 'BIC',
  'PAGO', 'ABONO', 'NOTA', 'DOCUMENTO', 'DOC', 'REF', 'REFERENCIA', 'TRANSACCION',
  'NRO', 'NO', 'NUM', 'NUMERO', 'CTA', 'CUENTA',
]);

const SUFFIX_SOCIETY = /\b(S\.?A\.?S?|LTDA|LIMITADA|E\.?U|S\.?C\.?A|C\.?I|E\.?S\.?P|INC|CORP|SOCIEDAD|ANONIMA|Y CIA|CIA)\b/g;

/** Normaliza el nombre de un tercero eliminando el tipo societario. */
export function normalizeThirdPartyName(input: unknown): string {
  let s = normalizeText(input);
  if (!s) return '';
  s = s.replace(SUFFIX_SOCIETY, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function tokens(s: string, dropStopwords = true): string[] {
  const list = normalizeText(s).split(' ').filter((t) => t.length > 1);
  return dropStopwords ? list.filter((t) => !STOPWORDS.has(t)) : list;
}

/** Distancia de Levenshtein (iterativa, O(n·m) con una sola fila). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/** Similitud 0..1 basada en Levenshtein normalizado. */
export function levenshteinRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

/** Coeficiente de Dice sobre bigramas de caracteres. */
export function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

/** Similitud por conjunto de tokens (Jaccard ponderado por cobertura del menor). */
export function tokenSetSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const smaller = Math.min(ta.size, tb.size);
  const union = ta.size + tb.size - inter;
  // Mezcla: cobertura del conjunto menor (útil cuando una descripción es más larga)
  // con Jaccard puro (penaliza textos totalmente distintos).
  return 0.6 * (inter / smaller) + 0.4 * (inter / union);
}

/**
 * Similitud combinada 0..1 entre dos textos libres.
 * Mezcla tokens (orden-independiente) y bigramas (tolerante a errores de digitación).
 */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ts = tokenSetSimilarity(na, nb);
  const dc = diceCoefficient(na, nb);
  return Math.max(ts, 0.5 * ts + 0.5 * dc);
}

/** Similitud entre nombres de terceros (ignora tipo societario). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeThirdPartyName(a);
  const nb = normalizeThirdPartyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Un nombre contenido en el otro (razón social abreviada) cuenta alto.
  if (na.length > 4 && nb.length > 4 && (na.includes(nb) || nb.includes(na))) return 0.92;
  return Math.max(tokenSetSimilarity(na, nb), diceCoefficient(na, nb));
}

/** Extrae secuencias numéricas de 3+ dígitos (referencias, documentos, comprobantes). */
export function extractNumbers(s: string, minLen = 3): string[] {
  if (!s) return [];
  const out = new Set<string>();
  const re = new RegExp('\\d{' + minLen + ',}', 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(s))) !== null) out.add(m[0]);
  return [...out];
}

/** Compara identificadores (documento, referencia) ignorando ceros a la izquierda. */
export function normalizeRef(input: unknown): string {
  const s = normalizeText(input).replace(/\s/g, '');
  if (!s) return '';
  if (/^0+\d+$/.test(s)) return s.replace(/^0+/, '');
  return s;
}

/** ¿Uno de los identificadores aparece dentro del texto del otro? */
export function refMatches(ref: string, haystack: string): boolean {
  const r = normalizeRef(ref);
  if (!r || r.length < 3) return false;
  const nums = extractNumbers(haystack, 3).map((n) => n.replace(/^0+/, ''));
  if (nums.includes(r)) return true;
  return normalizeText(haystack).replace(/\s/g, '').includes(r);
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
