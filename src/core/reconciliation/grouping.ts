/**
 * Cruces agrupados (N:1, 1:N y por bloque).
 *
 * Después del cruce 1:1 suelen quedar partidas que sí están en ambos lados,
 * pero con distinta granularidad:
 *  - Gastos bancarios: el banco carga cientos de 4x1000, IVA y comisiones;
 *    la contabilidad los registra en uno o pocos asientos al cierre del mes.
 *  - Pagos consolidados: un solo registro contable (p. ej. pago a la DIAN)
 *    que el banco ejecutó como varios PSE, o al revés.
 *
 * Este módulo encuentra esos grupos por suma exacta (± redondeo), siempre
 * restringido a movimientos de la misma naturaleza, en una ventana de fechas
 * y con afinidad entre el texto bancario y el tercero contable.
 */

import type { BankTx, LedgerTx } from '../types';
import { daysBetween } from '../normalize/dates';
import { normalizeText } from '../normalize/text';

export interface GroupFound {
  bankIds: string[];
  ledgerIds: string[];
  kind: 'GASTOS_BANCARIOS' | 'VARIOS_BANCO' | 'VARIOS_CONTABLE' | 'BLOQUE_TERCERO';
}

export interface GroupingInput {
  bank: BankTx[];
  ledger: LedgerTx[];
  /** Ids ya conciliados o ignorados: no participan. */
  takenBank: Set<string>;
  takenLedger: Set<string>;
  /** Pares rechazados por el usuario (`bankId|ledgerId`). */
  rejected: Set<string>;
  roundingAbsolute: number;
  windowDays: number;
}

/* ------------------------------------------------------------------ */
/* Afinidad texto bancario ↔ tercero contable                          */
/* ------------------------------------------------------------------ */

const NOISE = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'EN', 'POR', 'PARA', 'CON',
  'SA', 'SAS', 'S', 'A', 'U', 'LTDA', 'CIA', 'CO', 'INC', 'ESP', 'BIC', 'UAE',
  'PAGO', 'PAGOS', 'PSE', 'PROV', 'PROVE', 'PROVEEDOR', 'PROVEEDORES', 'ABONO',
  'TRANSFERENCIA', 'TRASLADO', 'COLOMBIA', 'COLOMBIANO', 'COLOMBIANA', 'NACIONAL',
  'SOCIEDAD', 'COMPANIA', 'INTERNACIONAL', 'INTERNATIONAL', 'COMPANY', 'GRUPO',
]);

function significantTokens(s: string): string[] {
  return normalizeText(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !NOISE.has(t) && !/^\d+$/.test(t));
}

/** Sigla formada por las iniciales del nombre: "DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES" → "DIAN". */
function acronym(name: string): string {
  const words = normalizeText(name)
    .split(' ')
    .filter((w) => w.length >= 3 && !['DEL', 'LOS', 'LAS', 'UAE', 'SAS', 'CIA', 'LTDA'].includes(w));
  return words.length >= 3 ? words.map((w) => w[0]).join('') : '';
}

const nameCache = new Map<string, { tokens: string[]; acr: string }>();
function nameInfo(name: string) {
  let info = nameCache.get(name);
  if (!info) {
    info = { tokens: significantTokens(name).filter((t) => t.length >= 4), acr: acronym(name) };
    nameCache.set(name, info);
  }
  return info;
}

/** ¿El texto bancario parece referirse a este tercero contable? */
export function affinity(b: BankTx, l: LedgerTx): boolean {
  const text = [b.description, b.thirdPartyName, b.reference].filter(Boolean).join(' ');
  const bankTokens = new Set(normalizeText(text).split(' '));
  if (b.thirdPartyId && l.thirdPartyId && b.thirdPartyId === l.thirdPartyId) return true;
  const { tokens, acr } = nameInfo(l.thirdPartyName || l.description);
  if (acr.length >= 3 && bankTokens.has(acr)) return true;
  // Los extractos truncan el nombre: basta con un prefijo de 5+ letras de una palabra significativa.
  for (const t of tokens) {
    for (const bt of bankTokens) {
      if (bt.length >= 5 && (t.startsWith(bt) || bt.startsWith(t))) return true;
      if (bt === t) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Gastos bancarios                                                    */
/* ------------------------------------------------------------------ */

const LEDGER_FEE = /\b(GASTOS? BANCARIOS?|COMISION(ES)? BANCARIA|GMF|GRAVAMEN|4 ?X ?1000|CUATRO POR MIL)\b/;
const BANK_FEE =
  /\b(4X1000|4 X 1000|GMF|GRAVAMEN|IMPTO GOBIERNO|IVA|COMIS|COMISION|CUOTA (DE )?MANEJO|SERVICIO PAGO|CARGO|COBRO)\b/;

function isLedgerFee(l: LedgerTx): boolean {
  return LEDGER_FEE.test(normalizeText(l.description + ' ' + l.thirdPartyName + ' ' + l.accountName));
}
function isBankFee(b: BankTx): boolean {
  return BANK_FEE.test(normalizeText(b.description));
}

function monthOf(d: Date | null): string {
  return d ? d.getFullYear() + '-' + d.getMonth() : 'nd';
}

/* ------------------------------------------------------------------ */
/* Suma de subconjuntos (centavos enteros)                             */
/* ------------------------------------------------------------------ */

const MAX_STATES = 60_000;

/**
 * Busca un subconjunto de `values` (en centavos, positivos) de al menos dos
 * elementos cuya suma esté a ≤ tol del objetivo. Devuelve los índices o null.
 * Programación dinámica sobre sumas alcanzables con poda (una suma que ya no
 * puede llegar al objetivo con lo que falta se descarta) y tope de estados
 * para que nunca bloquee el navegador.
 */
export function subsetSum(values: number[], target: number, tol: number): number[] | null {
  const n = values.length;
  const suffix = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + values[i];
  if (suffix[0] < target - tol) return null;

  // suma -> [suma anterior, índice agregado, cantidad de elementos]
  const parent = new Map<number, [number, number, number]>([[0, [-1, -1, 0]]]);
  let frontier: number[] = [0];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const rest = suffix[i + 1];
    const next: number[] = [];
    for (const s of frontier) {
      // ¿El estado sigue siendo útil sin tomar v?
      if (s + v + rest >= target - tol || s + rest >= target - tol) next.push(s);
      const ns = s + v;
      if (ns > target + tol || parent.has(ns)) continue;
      const count = parent.get(s)![2] + 1;
      parent.set(ns, [s, i, count]);
      if (Math.abs(ns - target) <= tol && count >= 2) {
        const out: number[] = [];
        let cur = ns;
        while (cur !== 0) {
          const [prev, idx] = parent.get(cur)!;
          out.push(idx);
          cur = prev;
        }
        return out.reverse();
      }
      if (ns + rest >= target - tol && parent.size < MAX_STATES) next.push(ns);
    }
    frontier = next;
    if (!frontier.length) return null;
  }
  return null;
}

const cents = (n: number) => Math.round(Math.abs(n) * 100);

/* ------------------------------------------------------------------ */
/* Motor de grupos                                                     */
/* ------------------------------------------------------------------ */

export function findGroups(input: GroupingInput): GroupFound[] {
  const { bank, ledger, rejected } = input;
  const takenBank = new Set(input.takenBank);
  const takenLedger = new Set(input.takenLedger);
  const tolC = Math.round(input.roundingAbsolute * 100);
  const out: GroupFound[] = [];

  const freeBank = () => bank.filter((b) => !takenBank.has(b.id));
  const freeLedger = () => ledger.filter((l) => !takenLedger.has(l.id));
  const take = (g: GroupFound) => {
    g.bankIds.forEach((id) => takenBank.add(id));
    g.ledgerIds.forEach((id) => takenLedger.add(id));
    out.push(g);
  };
  const sumC = (xs: { amount: number }[]) => xs.reduce((a, x) => a + Math.round(x.amount * 100), 0);
  const allowed = (b: BankTx, l: LedgerTx) => !rejected.has(b.id + '|' + l.id);

  /* --- 1. Gastos bancarios del mes ---------------------------------- */
  const feeLedgerByMonth = new Map<string, LedgerTx[]>();
  for (const l of freeLedger()) {
    if (!isLedgerFee(l)) continue;
    const k = monthOf(l.date) + (l.amount < 0 ? '-' : '+');
    feeLedgerByMonth.set(k, [...(feeLedgerByMonth.get(k) ?? []), l]);
  }
  for (const [k, ls] of feeLedgerByMonth) {
    const fees = freeBank().filter(
      (b) => isBankFee(b) && monthOf(b.date) + (b.amount < 0 ? '-' : '+') === k && ls.every((l) => allowed(b, l)),
    );
    if (!fees.length) continue;
    if (Math.abs(sumC(fees) - sumC(ls)) <= tolC) {
      take({ bankIds: fees.map((b) => b.id), ledgerIds: ls.map((l) => l.id), kind: 'GASTOS_BANCARIOS' });
    }
  }

  /* --- 2. Varios bancarios = 1 contable / varios contables = 1 bancario */
  for (const win of [3, input.windowDays]) {
    for (const l of freeLedger().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))) {
      if (takenLedger.has(l.id)) continue;
      const cands = freeBank()
        .filter(
          (b) =>
            Math.sign(b.amount) === Math.sign(l.amount) &&
            Math.abs(b.amount) <= Math.abs(l.amount) + input.roundingAbsolute &&
            Math.abs(daysBetween(b.date, l.date) ?? 0) <= win &&
            allowed(b, l) &&
            affinity(b, l),
        )
        .sort((a, b) => Math.abs(daysBetween(a.date, l.date) ?? 0) - Math.abs(daysBetween(b.date, l.date) ?? 0))
        .slice(0, 80);
      if (cands.length < 2) continue;
      const hit = subsetSum(cands.map((b) => cents(b.amount)), cents(l.amount), tolC);
      if (hit) take({ bankIds: hit.map((i) => cands[i].id), ledgerIds: [l.id], kind: 'VARIOS_BANCO' });
    }
    for (const b of freeBank().sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))) {
      if (takenBank.has(b.id)) continue;
      const cands = freeLedger()
        .filter(
          (l) =>
            Math.sign(b.amount) === Math.sign(l.amount) &&
            Math.abs(l.amount) <= Math.abs(b.amount) + input.roundingAbsolute &&
            Math.abs(daysBetween(b.date, l.date) ?? 0) <= win &&
            allowed(b, l) &&
            affinity(b, l),
        )
        .sort((x, y) => Math.abs(daysBetween(b.date, x.date) ?? 0) - Math.abs(daysBetween(b.date, y.date) ?? 0))
        .slice(0, 80);
      if (cands.length < 2) continue;
      const hit = subsetSum(cands.map((l) => cents(l.amount)), cents(b.amount), tolC);
      if (hit) take({ bankIds: [b.id], ledgerIds: hit.map((i) => cands[i].id), kind: 'VARIOS_CONTABLE' });
    }
  }

  /* --- 3. Bloque por tercero ---------------------------------------- */
  // Lo que queda de un mismo tercero suma lo mismo en ambos lados, aunque los
  // pagos no se puedan emparejar uno a uno (p. ej. varios pagos DIAN cruzados).
  const byParty = new Map<string, LedgerTx[]>();
  for (const l of freeLedger()) {
    const key = (l.thirdPartyId || normalizeText(l.thirdPartyName)) + (l.amount < 0 ? '-' : '+');
    if (!key.slice(0, -1)) continue;
    byParty.set(key, [...(byParty.get(key) ?? []), l]);
  }
  for (const ls of byParty.values()) {
    if (ls.some((l) => takenLedger.has(l.id))) continue;
    const dates = ls.map((l) => l.date?.getTime() ?? 0);
    const from = Math.min(...dates) - input.windowDays * 86_400_000;
    const to = Math.max(...dates) + input.windowDays * 86_400_000;
    const bs = freeBank().filter(
      (b) =>
        Math.sign(b.amount) === Math.sign(ls[0].amount) &&
        (b.date?.getTime() ?? 0) >= from &&
        (b.date?.getTime() ?? 0) <= to &&
        affinity(b, ls[0]) &&
        ls.every((l) => allowed(b, l)),
    );
    if (!bs.length || bs.length + ls.length < 3) continue;
    if (Math.abs(sumC(bs) - sumC(ls)) <= tolC) {
      take({ bankIds: bs.map((b) => b.id), ledgerIds: ls.map((l) => l.id), kind: 'BLOQUE_TERCERO' });
    }
  }

  return out;
}
