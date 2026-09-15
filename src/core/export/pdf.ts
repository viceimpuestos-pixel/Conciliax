/**
 * Informe ejecutivo en PDF (jsPDF + autotable).
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ExportContext } from './excel';
import { STATUS_LABEL } from '../types';
import { formatDate } from '../normalize/dates';
import { formatMoney, formatPercent } from '../normalize/money';
import { formatNit } from '../normalize/nit';
import { ALERT_KIND_LABEL, SEVERITY_LABEL } from '../analytics/alerts';

const NAVY: [number, number, number] = [15, 42, 74];
const BLUE: [number, number, number] = [29, 91, 173];
const GREY: [number, number, number] = [107, 122, 143];
const GREEN: [number, number, number] = [22, 128, 84];
const RED: [number, number, number] = [186, 43, 43];

export interface PdfOptions {
  companyName?: string;
  period?: string;
  preparedBy?: string;
}

export function exportPdf(ctx: ExportContext, opts: PdfOptions = {}): string {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const k = ctx.kpis;

  /* --- Portada / encabezado ---------------------------------------- */
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 92, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text('Informe de conciliación bancaria', M, 40);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(opts.companyName ?? 'Conciliación banco vs. auxiliar contable por tercero', M, 58);
  doc.setFontSize(9);
  doc.setTextColor(190, 205, 225);
  doc.text(
    'Generado el ' + formatDate(ctx.meta.generatedAt) +
      (opts.period ? '  ·  Período: ' + opts.period : '') +
      (opts.preparedBy ? '  ·  Elaborado por: ' + opts.preparedBy : ''),
    M,
    74,
  );

  let y = 118;

  /* --- Tarjetas de saldo -------------------------------------------- */
  const cards: { label: string; value: string; color: [number, number, number] }[] = [
    { label: 'Saldo según banco', value: formatMoney(k.saldoBanco), color: NAVY },
    { label: 'Saldo según contabilidad', value: formatMoney(k.saldoContable), color: BLUE },
    {
      label: 'Diferencia',
      value: formatMoney(k.diferencia),
      color: Math.abs(k.diferencia) < 1 ? GREEN : RED,
    },
  ];

  const cardW = (W - M * 2 - 16) / 3;
  cards.forEach((c, i) => {
    const x = M + i * (cardW + 8);
    doc.setDrawColor(222, 229, 238);
    doc.setFillColor(248, 250, 253);
    doc.roundedRect(x, y, cardW, 56, 4, 4, 'FD');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(c.label.toUpperCase(), x + 10, y + 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...c.color);
    doc.text(c.value, x + 10, y + 40);
    doc.setFont('helvetica', 'normal');
  });

  y += 78;

  /* --- Estado de la conciliación ------------------------------------ */
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.text('Estado de la conciliación', M, y);
  doc.setFont('helvetica', 'normal');
  y += 10;

  autoTable(doc, {
    startY: y,
    head: [['Estado', 'Movimientos', 'Participación']],
    body: [
      [STATUS_LABEL.CONCILIADO, String(k.conciliados), formatPercent(pct(k.conciliados, k.totalMovBanco))],
      [STATUS_LABEL.PROBABLE, String(k.probables), formatPercent(pct(k.probables, k.totalMovBanco))],
      [STATUS_LABEL.REVISION, String(k.pendientes), formatPercent(pct(k.pendientes, k.totalMovBanco))],
      [STATUS_LABEL.DIF_VALOR, String(k.difValor), formatPercent(pct(k.difValor, k.totalMovBanco))],
      [STATUS_LABEL.DIF_FECHA, String(k.difFecha), formatPercent(pct(k.difFecha, k.totalMovBanco))],
      [STATUS_LABEL.DUPLICADO, String(k.duplicados), formatPercent(pct(k.duplicados, k.totalMovBanco))],
      [STATUS_LABEL.NO_CONCILIADO, String(k.noConciliados), formatPercent(pct(k.noConciliados, k.totalMovBanco))],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 253] },
    margin: { left: M, right: M },
  });

  y = (doc as any).lastAutoTable.finalY + 24;

  /* --- Indicadores --------------------------------------------------- */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text('Indicadores del período', M, y);
  doc.setFont('helvetica', 'normal');

  autoTable(doc, {
    startY: y + 10,
    head: [['Indicador', 'Valor']],
    body: [
      ['Movimientos bancarios', String(k.totalMovBanco)],
      ['Movimientos contables', String(k.totalMovContable)],
      ['% de conciliación (movimientos)', formatPercent(k.porcentajeConciliacion)],
      ['% de conciliación (valor)', formatPercent(k.porcentajeValorConciliado)],
      ['Valor conciliado', formatMoney(k.valorConciliado)],
      ['Valor pendiente', formatMoney(k.valorPendiente)],
      ['Valor no conciliado', formatMoney(k.valorNoConciliado)],
      ['Ingresos banco', formatMoney(k.ingresosBanco)],
      ['Egresos banco', formatMoney(k.egresosBanco)],
      ['Diferencias acumuladas en los cruces', formatMoney(k.diferenciaEnCruces)],
    ],
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: BLUE, textColor: 255 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: M, right: M },
  });

  /* --- Alertas principales ------------------------------------------- */
  const topAlerts = ctx.alerts.slice(0, 15);
  if (topAlerts.length) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text('Alertas prioritarias', M, 50);
    doc.setFont('helvetica', 'normal');

    autoTable(doc, {
      startY: 62,
      head: [['Sev.', 'Tipo', 'Detalle', 'Valor']],
      body: topAlerts.map((a) => [
        SEVERITY_LABEL[a.severity],
        ALERT_KIND_LABEL[a.kind],
        a.title + '\n' + a.detail,
        formatMoney(a.value),
      ]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4, valign: 'top' },
      headStyles: { fillColor: NAVY, textColor: 255 },
      columnStyles: {
        0: { cellWidth: 44 },
        1: { cellWidth: 92 },
        3: { cellWidth: 78, halign: 'right' },
      },
      margin: { left: M, right: M },
    });
  }

  /* --- Partidas conciliatorias --------------------------------------- */
  const ledgerById = new Map(ctx.ledger.map((l) => [l.id, l]));
  const bankPending = ctx.bank
    .filter((b) => {
      const s = ctx.result.bankStatus.get(b.id);
      return s === 'NO_CONCILIADO' || s === 'DUPLICADO';
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 25);

  if (bankPending.length) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text('Partidas conciliatorias — banco sin contabilidad', M, 50);
    doc.setFont('helvetica', 'normal');

    autoTable(doc, {
      startY: 62,
      head: [['Fecha', 'Descripción', 'Referencia', 'Valor']],
      body: bankPending.map((b) => [
        formatDate(b.date),
        b.description.slice(0, 70),
        b.reference || b.transactionNumber,
        formatMoney(b.amount),
      ]),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: BLUE, textColor: 255 },
      columnStyles: { 3: { halign: 'right', cellWidth: 82 } },
      margin: { left: M, right: M },
    });
  }

  const ledgerPending = ctx.ledger
    .filter((l) => {
      const s = ctx.result.ledgerStatus.get(l.id);
      return s === 'NO_CONCILIADO' || s === 'DUPLICADO';
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 25);

  if (ledgerPending.length) {
    const startY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 28 : 62;
    if (startY > 640) doc.addPage();
    const y2 = startY > 640 ? 50 : startY;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text('Partidas conciliatorias — contabilidad sin banco', M, y2);
    doc.setFont('helvetica', 'normal');

    autoTable(doc, {
      startY: y2 + 12,
      head: [['Fecha', 'Tercero', 'Documento', 'Valor']],
      body: ledgerPending.map((l) => [
        formatDate(l.date),
        (l.thirdPartyName || '—').slice(0, 46) + (l.thirdPartyId ? '\n' + formatNit(l.thirdPartyId) : ''),
        l.documentType + ' ' + l.documentNumber,
        formatMoney(l.amount),
      ]),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: BLUE, textColor: 255 },
      columnStyles: { 3: { halign: 'right', cellWidth: 82 } },
      margin: { left: M, right: M },
    });
  }

  /* --- Top terceros con diferencias ---------------------------------- */
  const tops = ctx.thirdParties
    .filter((t) => t.valorPendiente + t.diferencia > 0)
    .sort((a, b) => b.valorPendiente + b.diferencia - (a.valorPendiente + a.diferencia))
    .slice(0, 15);

  if (tops.length) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text('Terceros con mayores diferencias', M, 50);
    doc.setFont('helvetica', 'normal');

    autoTable(doc, {
      startY: 62,
      head: [['NIT', 'Tercero', 'Mov.', 'Conc.', 'Pend.', 'Valor pendiente']],
      body: tops.map((t) => [
        t.nit ? formatNit(t.nit) : '—',
        t.name.slice(0, 40),
        String(t.movimientos),
        String(t.conciliados),
        String(t.pendientes + t.noConciliados),
        formatMoney(t.valorPendiente + t.diferencia),
      ]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: NAVY, textColor: 255 },
      columnStyles: { 5: { halign: 'right', cellWidth: 88 } },
      margin: { left: M, right: M },
    });
  }

  /* --- Pie de página en todas las hojas ------------------------------ */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(
      'Conciliax · Extracto: ' + ctx.meta.bankFile + ' · Auxiliar: ' + ctx.meta.ledgerFile,
      M,
      doc.internal.pageSize.getHeight() - 22,
    );
    doc.text(
      'Página ' + p + ' de ' + pages,
      W - M,
      doc.internal.pageSize.getHeight() - 22,
      { align: 'right' },
    );
  }

  const name =
    'Informe_Conciliacion_' +
    ctx.meta.generatedAt.getFullYear() +
    String(ctx.meta.generatedAt.getMonth() + 1).padStart(2, '0') +
    String(ctx.meta.generatedAt.getDate()).padStart(2, '0') +
    '.pdf';
  doc.save(name);
  return name;
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}
