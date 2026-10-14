/**
 * Lector de extractos PDF basado en filas de movimiento.
 *
 * Los extractos de los bancos colombianos (Bancolombia, Occidente, Agrario,
 * Serfinanzas, Davivienda…) cambian de diseño, de encabezados y de formato
 * numérico, pero todos comparten la misma forma de fila:
 *
 *     <fecha>  <descripción> [referencia]  <cifra> [cifra] <saldo>
 *
 * - La fecha puede venir como día ("01"), día/mes ("07/09") o completa.
 * - Las cifras pueden venir con formato colombiano (4.663.000,00) o
 *   anglosajón (13,071,625.00), con signo o en columnas débito/crédito.
 *
 * En vez de adivinar columnas por posición, se toma la ÚLTIMA cifra de la fila
 * como saldo y se calcula el valor del movimiento como la diferencia con el
 * saldo anterior. Así el signo nunca depende del diseño del banco, y cada fila
 * queda validada contra el valor impreso: si no cuadran, la fila se descarta y
 * el lector se declara no confiable (se usa el lector genérico por columnas).
 */

import { normalizeText } from '../normalize/text';
import { parseMoney } from '../normalize/money';

export interface StatementRow {
  date: string; // yyyy-mm-dd
  description: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface ParsedStatement {
  bank: string;
  accountNumber: string;
  openingBalance: number | null;
  closingBalance: number | null;
  /** Saldo de la última fila leída: debe coincidir con closingBalance. */
  lastBalance: number | null;
  rows: StatementRow[];
  /** Filas cuya cifra impresa coincide con la variación del saldo. */
  validated: number;
  /** Filas candidatas donde no coincidió (se descartaron). */
  rejected: number;
}

const MONEY = /^-?\$?\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})$|^-?\d+[.,]\d{2}$/;
const DATE_FULL = /^(\d{1,2})[/\-](\d{1,2})[/\-](20\d{2})$/;
const DATE_ISO = /^(20\d{2})[/\-](\d{1,2})[/\-](\d{1,2})$/;
const DATE_DM = /^(\d{1,2})[/\-](\d{1,2})$/;
const DATE_D = /^(\d{1,2})$/;
const REF = /^[A-Z]{0,3}\d{4,}$/;

const BANKS: [RegExp, string][] = [
  [/BANCOLOMBIA/, 'Bancolombia'],
  [/OCCIDENTE/, 'Banco de Occidente'],
  [/BANCOAGRARIO|BANCO AGRARIO/, 'Banco Agrario'],
  [/SERFINANZA|GIRAMAS/, 'Banco Serfinanzas'],
  [/DAVIVIENDA/, 'Davivienda'],
  [/BBVA/, 'BBVA'],
  [/BANCO DE BOGOTA/, 'Banco de Bogotá'],
  [/POPULAR/, 'Banco Popular'],
  [/AV VILLAS/, 'Banco AV Villas'],
  [/ITAU/, 'Itaú'],
  [/SCOTIABANK|COLPATRIA/, 'Scotiabank Colpatria'],
  [/CAJA SOCIAL/, 'Banco Caja Social'],
];

/** Divide una línea en tokens: cada fragmento del PDF, partido además por 2+ espacios. */
function tokenize(fragments: string[]): string[] {
  const out: string[] = [];
  for (const f of fragments) {
    for (const p of f.split(/\s{2,}/)) {
      const t = p.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** Período del extracto: fecha de corte / hasta, o mes y año en letras. */
function statementPeriod(text: string): { year: number | null; month: number | null } {
  const t = normalizeText(text);
  const corte = text.match(/(?:CORTE|HASTA)\s*:?\s*(\d{1,2})[/\-](\d{1,2})[/\-](20\d{2})/i);
  if (corte) return { year: Number(corte[3]), month: Number(corte[2]) };
  const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const named = t.match(new RegExp('\\b(' + months.join('|') + ')\\b[^0-9]{0,40}(20\\d{2})\\b'));
  if (named) return { year: Number(named[2]), month: months.indexOf(named[1]) + 1 };
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };
  const full = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (full) return { year: Number(full[3]), month: Number(full[2]) };
  return { year: null, month: null };
}

function parseDateToken(tok: string, year: number | null, month: number | null): string | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  let m = tok.match(DATE_FULL);
  if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  m = tok.match(DATE_ISO);
  if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
  m = tok.match(DATE_DM);
  if (m && year && +m[2] >= 1 && +m[2] <= 12) return year + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  m = tok.match(DATE_D);
  if (m && year && month && +m[1] >= 1 && +m[1] <= 31) return year + '-' + pad(month) + '-' + pad(+m[1]);
  return null;
}

/** Número de cuenta impreso en el membrete (sólo dígitos). */
export function findAccountNumber(text: string): string {
  const patterns = [
    /CUENTA\s*(?:No\.?|N[º°o]\.?|NUMERO|NÚMERO)?\s*:?\s*([\d][\d\- ]{6,20}\d)/i,
    /N[úu]mero de cuenta\s*:?\s*([\d\- ]{7,22})/i,
    /\b(\d{3}-\d{5,6}-\d{2})\b/,
    /\b(\d{10,16})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const digits = m[1].replace(/\D/g, '');
      if (digits.length >= 7) return digits;
    }
  }
  return '';
}

function findLabeledAmount(lines: string[][], label: RegExp): number | null {
  for (const toks of lines) {
    for (let i = 0; i < toks.length; i++) {
      if (!label.test(normalizeText(toks[i]))) continue;
      // La cifra puede venir en el mismo token ("Saldo Anterior: 19,911,347.55") o en el siguiente.
      const inline = toks[i].match(/(-?[\d.,]+\d{2})\s*$/);
      if (inline && MONEY.test(inline[1])) return parseMoney(inline[1]);
      for (let j = i + 1; j < Math.min(toks.length, i + 3); j++) {
        if (MONEY.test(toks[j])) return parseMoney(toks[j]);
      }
    }
  }
  return null;
}

/**
 * Intenta leer el extracto por filas. Devuelve null si el resultado no es
 * confiable (pocas filas o saldos que no cuadran).
 */
export function parseStatementLines(lineFragments: string[][]): ParsedStatement | null {
  const lines = lineFragments.map(tokenize).filter((l) => l.length);
  const text = lines.map((l) => l.join('  ')).join('\n');
  const head = normalizeText(text.slice(0, 6000));
  const bank = BANKS.find(([re]) => re.test(head))?.[1] ?? '';
  const { year, month } = statementPeriod(text.slice(0, 6000));
  const opening = findLabeledAmount(lines, /^(SALDO ANTERIOR|SALDO INICIAL)\b/);
  const closing = findLabeledAmount(lines, /^(SALDO ACTUAL|SALDO FINAL|NUEVO SALDO)\b/);

  // 1. Filas candidatas: empiezan con fecha y terminan con 2+ cifras.
  //    Dos movimientos muy juntos en el PDF pueden quedar en la misma línea
  //    visual: se separan donde aparece una fecha justo después de una cifra.
  const split: string[][] = [];
  for (const toks of lines) {
    let cur: string[] = [];
    toks.forEach((t, i) => {
      if (i > 0 && cur.length && MONEY.test(toks[i - 1]) && parseDateToken(t, year, month)) {
        split.push(cur);
        cur = [];
      }
      cur.push(t);
    });
    if (cur.length) split.push(cur);
  }
  interface Cand { date: string; desc: string; ref: string; amounts: number[]; balance: number }
  const cands: Cand[] = [];
  for (let toks of split) {
    // Texto de margen en la misma altura (membrete del banco a la izquierda,
    // código de pie de página a la derecha) no es parte del movimiento.
    if (!parseDateToken(toks[0], year, month) && toks.length > 2 && parseDateToken(toks[1], year, month)) {
      toks = toks.slice(1);
    }
    const date = parseDateToken(toks[0], year, month);
    if (!date) continue;
    let tail = 0;
    while (tail < 2 && toks.length - tail > 3 && !MONEY.test(toks[toks.length - 1 - tail])) tail++;
    if (tail && MONEY.test(toks[toks.length - 1 - tail]) && MONEY.test(toks[toks.length - 2 - tail])) {
      toks = toks.slice(0, toks.length - tail);
    }
    let k = toks.length;
    const nums: number[] = [];
    while (k > 1 && MONEY.test(toks[k - 1])) {
      nums.unshift(parseMoney(toks[k - 1]));
      k--;
    }
    if (nums.length < 2) continue;
    const middle = toks.slice(1, k);
    let ref = '';
    if (middle.length > 1 && REF.test(middle[middle.length - 1])) ref = middle.pop()!;
    const desc = middle.join(' ').replace(/\s+/g, ' ').trim();
    if (!desc) continue;
    cands.push({ date, desc, ref, amounts: nums.slice(0, -1), balance: nums[nums.length - 1] });
  }
  if (cands.length < 2) return null;

  // 2. Valor = variación del saldo; se valida contra las cifras impresas.
  const rows: StatementRow[] = [];
  let prev = opening;
  if (prev === null) {
    // Sin saldo anterior: se deduce de la primera fila (saldo − cifra impresa con su signo).
    const c = cands[0];
    const printed = c.amounts.find((a) => a !== 0) ?? 0;
    prev = Math.round((c.balance - printed) * 100) / 100;
    if (c.amounts.length >= 2 && c.amounts[0] !== 0 && c.amounts[1] === 0) prev = Math.round((c.balance + c.amounts[0]) * 100) / 100;
  }
  let validated = 0;
  let rejected = 0;
  for (const c of cands) {
    const delta = Math.round((c.balance - prev) * 100) / 100;
    const ok = c.amounts.some((a) => Math.abs(Math.abs(a) - Math.abs(delta)) < 0.005);
    if (!ok || delta === 0) {
      rejected++;
      // Una fila no validada no mueve el saldo de referencia salvo que sea coherente con la siguiente.
      prev = c.balance;
      continue;
    }
    validated++;
    rows.push({
      date: c.date,
      description: c.desc,
      reference: c.ref,
      debit: delta < 0 ? -delta : 0,
      credit: delta > 0 ? delta : 0,
      balance: c.balance,
    });
    prev = c.balance;
  }

  if (validated < 2 || rejected > validated * 0.1) return null;
  return {
    bank,
    accountNumber: findAccountNumber(text.slice(0, 6000)),
    openingBalance: opening,
    closingBalance: closing,
    lastBalance: rows.length ? rows[rows.length - 1].balance : null,
    rows,
    validated,
    rejected,
  };
}
