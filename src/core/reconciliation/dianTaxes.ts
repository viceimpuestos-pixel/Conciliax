/**
 * Impuestos en el cruce DIAN ↔ auxiliar.
 *
 * El reporte de la DIAN trae el TOTAL de la factura (base + IVA). La cuenta
 * por pagar (22xx) — o por cobrar (13xx) en ventas — queda contabilizada por
 * el total MENOS las retenciones practicadas:
 *
 *   FESI 880 · ABINTEC:  base 1.436.256 + IVA 272.889 = total 1.709.145
 *                        − retención en la fuente 4 % 57.450
 *                        = cuenta por pagar 1.651.695
 *
 * Comparar el total DIAN contra la cuenta por pagar marca una "diferencia de
 * valor" que no es tal. Aquí se explica esa diferencia:
 *
 *  1. Con el comprobante: si el auxiliar trae las demás líneas del mismo
 *     documento contable, se suman sus retenciones (2365 renta, 2367 IVA,
 *     2368 ICA; en ventas 1355) y se compara.
 *  2. Por tarifa: si el auxiliar sólo trae la cuenta por pagar, se busca una
 *     combinación de tarifas usuales (retención en la fuente, reteIVA 15 % del
 *     IVA, reteICA por mil) que dé exactamente la diferencia. Se marca como
 *     deducida para que se verifique contra el comprobante.
 *
 * Además, si el comprobante trae el IVA (2408), se compara con el IVA de la
 * factura electrónica.
 */

import type { DianTx, DianWithholding, LedgerTx } from '../types';

const acc = (l: LedgerTx) => String(l.accountCode ?? '').replace(/\D/g, '');

type TaxKind = DianWithholding['kind'] | 'IVA';

/** Clasifica una cuenta PUC como retención o IVA. */
export function taxKindOf(account: string): TaxKind | null {
  if (/^2365/.test(account) || /^135515/.test(account)) return 'RETEFUENTE';
  if (/^2367/.test(account) || /^135517/.test(account)) return 'RETEIVA';
  if (/^2368/.test(account) || /^135518/.test(account)) return 'RETEICA';
  if (/^2408/.test(account)) return 'IVA';
  return null;
}

/** ¿Es la línea de cuenta por pagar / por cobrar de la factura? */
export function isSettlementLine(l: LedgerTx): boolean {
  const a = acc(l);
  if (!a) return true; // auxiliar sin cuenta: no se puede descartar
  if (taxKindOf(a)) return false;
  return /^(22|23|13|28)/.test(a);
}

const LABEL: Record<DianWithholding['kind'], string> = {
  RETEFUENTE: 'Retención en la fuente',
  RETEIVA: 'Retención de IVA',
  RETEICA: 'Retención de ICA',
};

export interface VoucherTaxes {
  withholdings: DianWithholding[];
  /** IVA contabilizado en el comprobante, null si el auxiliar no trae cuentas 2408. */
  iva: number | null;
}

/** Retenciones e IVA de las líneas de un mismo comprobante contable. */
export function voucherTaxes(lines: LedgerTx[]): VoucherTaxes {
  const withholdings: DianWithholding[] = [];
  let iva: number | null = null;
  for (const l of lines) {
    const a = acc(l);
    const kind = taxKindOf(a);
    if (!kind) continue;
    // Las retenciones van por el lado contrario a la cuenta por pagar; un
    // reverso (mismo lado) resta.
    const value = Math.round(Math.abs(l.debit - l.credit) * 100) / 100;
    if (!value) continue;
    if (kind === 'IVA') {
      iva = Math.round(((iva ?? 0) + (l.debit >= l.credit ? value : -value)) * 100) / 100;
      continue;
    }
    const sign = /^135/.test(a) ? (l.debit >= l.credit ? 1 : -1) : l.credit >= l.debit ? 1 : -1;
    withholdings.push({ kind, label: LABEL[kind], amount: sign * value, account: a, inferred: false });
  }
  return { withholdings, iva };
}

/* ------------------------------------------------------------------ */
/* Deducción por tarifa                                                */
/* ------------------------------------------------------------------ */

/** Tarifas usuales de retención en la fuente (% de la base). */
const RETEFUENTE_RATES = [0.1, 0.5, 1, 1.5, 2, 2.5, 3.5, 4, 6, 7, 10, 11, 20];
/** Tarifas usuales de reteICA (por mil de la base). */
const RETEICA_PER_MIL = [2, 3, 4, 4.14, 5, 6, 6.9, 7, 8, 8.56, 9.66, 10, 11.04, 13.8];

/**
 * Busca la combinación más simple de retenciones que dé exactamente la
 * diferencia (± 1 peso por redondeo). Devuelve null si no hay una única
 * explicación sencilla.
 */
export function inferWithholdings(diff: number, base: number, iva: number): DianWithholding[] | null {
  if (diff <= 0 || base <= 0) return null;
  const tol = 1;
  const r = (x: number) => Math.round(x);
  const fte = RETEFUENTE_RATES.map((p) => ({ p, v: r((base * p) / 100) }));
  const rIva = iva > 0 ? [0, r(iva * 0.15)] : [0];
  const ica = [{ m: 0, v: 0 }, ...RETEICA_PER_MIL.map((m) => ({ m, v: r((base * m) / 1000) }))];

  type Combo = { parts: DianWithholding[]; size: number };
  const hits: Combo[] = [];
  for (const f of [{ p: 0, v: 0 }, ...fte]) {
    for (const ri of rIva) {
      for (const ic of ica) {
        const total = f.v + ri + ic.v;
        if (!total || Math.abs(total - diff) > tol) continue;
        const parts: DianWithholding[] = [];
        if (f.v) parts.push({ kind: 'RETEFUENTE', label: LABEL.RETEFUENTE + ' ' + f.p.toString().replace('.', ',') + ' %', amount: f.v, inferred: true });
        if (ri) parts.push({ kind: 'RETEIVA', label: LABEL.RETEIVA + ' 15 %', amount: ri, inferred: true });
        if (ic.v) parts.push({ kind: 'RETEICA', label: LABEL.RETEICA + ' ' + ic.m.toString().replace('.', ',') + ' ‰', amount: ic.v, inferred: true });
        hits.push({ parts, size: parts.length });
      }
    }
  }
  if (!hits.length) return null;
  const minSize = Math.min(...hits.map((h) => h.size));
  const simplest = hits.filter((h) => h.size === minSize);
  // Dos explicaciones igual de simples y distintas: no se adivina.
  const keys = new Set(simplest.map((h) => h.parts.map((p) => p.label).join('+')));
  return keys.size === 1 ? simplest[0].parts : null;
}

export interface TaxExplanation {
  withholdings: DianWithholding[];
  /** Diferencia que queda después de las retenciones. */
  netDiff: number;
  ledgerIva: number | null;
}

/**
 * Explica la diferencia entre el total DIAN y la línea contable con las
 * retenciones del comprobante o, si no están, por tarifa.
 */
export function explainTaxes(doc: DianTx, line: LedgerTx, voucher: LedgerTx[] | undefined, grossDiff: number): TaxExplanation {
  const vt = voucher ? voucherTaxes(voucher) : { withholdings: [], iva: null };
  const none: TaxExplanation = { withholdings: [], netDiff: grossDiff, ledgerIva: vt.iva };
  if (Math.abs(grossDiff) <= 0.01 || !isSettlementLine(line)) return none;

  if (vt.withholdings.length) {
    const sum = vt.withholdings.reduce((a, w) => a + w.amount, 0);
    const net = Math.round((grossDiff - sum) * 100) / 100;
    // Se usan las del comprobante aunque no expliquen todo: lo que queda es la diferencia real.
    if (Math.abs(net) < Math.abs(grossDiff)) return { withholdings: vt.withholdings, netDiff: Math.abs(net) <= 1 ? 0 : net, ledgerIva: vt.iva };
    return none;
  }

  const inferred = inferWithholdings(grossDiff, Math.round((doc.amount - (doc.tax || 0)) * 100) / 100, doc.tax || 0);
  if (inferred) {
    const sum = inferred.reduce((a, w) => a + w.amount, 0);
    const net = Math.round((grossDiff - sum) * 100) / 100;
    return { withholdings: inferred, netDiff: Math.abs(net) <= 1 ? 0 : net, ledgerIva: vt.iva };
  }
  return none;
}
