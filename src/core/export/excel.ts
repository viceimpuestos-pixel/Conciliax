/**
 * Exportación a Excel (un libro con varias hojas) usando SheetJS.
 * Todo ocurre en el navegador: no se envía información a ningún servidor.
 */

import * as XLSX from 'xlsx';
import type { BankTx, LedgerTx, Match, ReconciliationResult } from '../types';
import { STATUS_LABEL } from '../types';
import type { Kpis } from '../analytics/kpis';
import type { Alert } from '../analytics/alerts';
import { ALERT_KIND_LABEL, SEVERITY_LABEL } from '../analytics/alerts';
import type { AccountSummary, ThirdPartySummary } from '../analytics/aggregations';
import { formatDate } from '../normalize/dates';
import { formatNit } from '../normalize/nit';

export interface ExportContext {
  bank: BankTx[];
  ledger: LedgerTx[];
  result: ReconciliationResult;
  kpis: Kpis;
  alerts: Alert[];
  thirdParties: ThirdPartySummary[];
  accounts: AccountSummary[];
  notes: Record<string, string>;
  reviewed: Set<string>;
  meta: { bankFile: string; ledgerFile: string; generatedAt: Date };
}

export type ExportSection =
  | 'resumen'
  | 'completa'
  | 'conciliados'
  | 'pendientes'
  | 'noConciliados'
  | 'diferencias'
  | 'alertas'
  | 'terceros'
  | 'cuentas'
  | 'auditoria';

export const EXPORT_SECTIONS: { id: ExportSection; label: string; description: string }[] = [
  { id: 'resumen', label: 'Resumen ejecutivo', description: 'KPIs, saldos y porcentaje de conciliación.' },
  { id: 'completa', label: 'Conciliación completa', description: 'Todos los movimientos bancarios con su contraparte contable.' },
  { id: 'conciliados', label: 'Movimientos conciliados', description: 'Sólo los cruces confirmados.' },
  { id: 'pendientes', label: 'Movimientos pendientes', description: 'Probables, en revisión y con diferencias.' },
  { id: 'noConciliados', label: 'No conciliados', description: 'Partidas conciliatorias de banco y de contabilidad.' },
  { id: 'diferencias', label: 'Diferencias', description: 'Cruces con diferencia de valor o de fecha.' },
  { id: 'alertas', label: 'Alertas', description: 'Panel de alertas priorizado.' },
  { id: 'terceros', label: 'Análisis por tercero', description: 'Totales, conciliado y pendiente por cada tercero.' },
  { id: 'cuentas', label: 'Análisis por cuenta', description: 'Diferencias por cuenta contable.' },
  { id: 'auditoria', label: 'Observaciones', description: 'Notas y marcas de revisión del usuario.' },
];

/* ------------------------------------------------------------------ */
/* Construcción de filas                                               */
/* ------------------------------------------------------------------ */

function matchRow(
  b: BankTx,
  m: Match | undefined,
  ledgerById: Map<string, LedgerTx>,
  status: string,
  notes: Record<string, string>,
  reviewed: Set<string>,
) {
  const l = m ? ledgerById.get(m.ledgerId) : undefined;
  return {
    'Estado': STATUS_LABEL[(status as keyof typeof STATUS_LABEL) ?? 'NO_CONCILIADO'] ?? status,
    'Confianza %': m ? Number(m.score.toFixed(1)) : 0,
    'Origen': m ? (m.origin === 'manual' ? 'Manual' : 'Automático') : '',
    'Revisado': reviewed.has(b.id) ? 'Sí' : 'No',
    'Banco · Fila': b.rowIndex,
    'Banco · Fecha': formatDate(b.date),
    'Banco · Descripción': b.description,
    'Banco · Referencia': b.reference,
    'Banco · Documento': b.document || b.transactionNumber,
    'Banco · Débito': b.debit || '',
    'Banco · Crédito': b.credit || '',
    'Banco · Valor': b.amount,
    'Banco · Saldo': b.balance ?? '',
    'Contab. · Fila': l?.rowIndex ?? '',
    'Contab. · Fecha': l ? formatDate(l.date) : '',
    'Contab. · Cuenta': l?.accountCode ?? '',
    'Contab. · Nombre cuenta': l?.accountName ?? '',
    'Contab. · NIT': l?.thirdPartyId ? formatNit(l.thirdPartyId) : '',
    'Contab. · Tercero': l?.thirdPartyName ?? '',
    'Contab. · Tipo doc.': l?.documentType ?? '',
    'Contab. · Documento': l?.documentNumber ?? '',
    'Contab. · Descripción': l?.description ?? '',
    'Contab. · Débito': l?.debit || '',
    'Contab. · Crédito': l?.credit || '',
    'Contab. · Valor': l?.amount ?? '',
    'Diferencia valor': m ? m.amountDiff : '',
    'Diferencia días': m?.daysDiff ?? '',
    'Motivo de la coincidencia': m?.explanation ?? '',
    'Observación': notes[b.id] ?? '',
  };
}

function ledgerRow(l: LedgerTx, status: string, notes: Record<string, string>) {
  return {
    'Estado': STATUS_LABEL[(status as keyof typeof STATUS_LABEL) ?? 'NO_CONCILIADO'] ?? status,
    'Fila': l.rowIndex,
    'Fecha': formatDate(l.date),
    'Cuenta': l.accountCode,
    'Nombre cuenta': l.accountName,
    'NIT': l.thirdPartyId ? formatNit(l.thirdPartyId) : '',
    'Tercero': l.thirdPartyName,
    'Tipo doc.': l.documentType,
    'Documento': l.documentNumber,
    'Descripción': l.description,
    'Débito': l.debit || '',
    'Crédito': l.credit || '',
    'Valor': l.amount,
    'Observación': notes[l.id] ?? '',
  };
}

function autoWidths(rows: Record<string, unknown>[]): XLSX.ColInfo[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((k) => {
    let max = k.length;
    for (const r of rows.slice(0, 400)) {
      const v = r[k];
      const len = v === null || v === undefined ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(48, Math.max(10, max + 2)) };
  });
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Sin registros': '' }]);
  ws['!cols'] = autoWidths(rows);
  if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] as string };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

/* ------------------------------------------------------------------ */
/* Libro completo                                                      */
/* ------------------------------------------------------------------ */

export function buildWorkbook(ctx: ExportContext, sections: ExportSection[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ledgerById = new Map(ctx.ledger.map((l) => [l.id, l]));
  const { result, kpis } = ctx;

  const allRows = ctx.bank.map((b) =>
    matchRow(b, result.byBank.get(b.id), ledgerById, result.bankStatus.get(b.id) ?? 'NO_CONCILIADO', ctx.notes, ctx.reviewed),
  );

  if (sections.includes('resumen')) {
    addSheet(wb, 'Resumen', [
      { Indicador: 'Archivo del extracto', Valor: ctx.meta.bankFile },
      { Indicador: 'Archivo del auxiliar', Valor: ctx.meta.ledgerFile },
      { Indicador: 'Fecha del informe', Valor: formatDate(ctx.meta.generatedAt) },
      { Indicador: '', Valor: '' },
      { Indicador: 'Saldo según banco', Valor: kpis.saldoBanco },
      { Indicador: 'Saldo según contabilidad', Valor: kpis.saldoContable },
      { Indicador: 'Diferencia banco - contabilidad', Valor: kpis.diferencia },
      { Indicador: '', Valor: '' },
      { Indicador: 'Total movimientos bancarios', Valor: kpis.totalMovBanco },
      { Indicador: 'Total movimientos contables', Valor: kpis.totalMovContable },
      { Indicador: 'Conciliados', Valor: kpis.conciliados },
      { Indicador: 'Coincidencias probables', Valor: kpis.probables },
      { Indicador: 'Pendientes de revisión', Valor: kpis.pendientes },
      { Indicador: 'Diferencia de valor', Valor: kpis.difValor },
      { Indicador: 'Diferencia de fecha', Valor: kpis.difFecha },
      { Indicador: 'Duplicados', Valor: kpis.duplicados },
      { Indicador: 'No conciliados', Valor: kpis.noConciliados },
      { Indicador: 'Ignorados', Valor: kpis.ignorados },
      { Indicador: '', Valor: '' },
      { Indicador: 'Valor conciliado', Valor: kpis.valorConciliado },
      { Indicador: 'Valor pendiente', Valor: kpis.valorPendiente },
      { Indicador: 'Valor no conciliado', Valor: kpis.valorNoConciliado },
      { Indicador: '% de conciliación (movimientos)', Valor: kpis.porcentajeConciliacion / 100 },
      { Indicador: '% de conciliación (valor)', Valor: kpis.porcentajeValorConciliado / 100 },
      { Indicador: '', Valor: '' },
      { Indicador: 'Ingresos banco', Valor: kpis.ingresosBanco },
      { Indicador: 'Egresos banco', Valor: kpis.egresosBanco },
      { Indicador: 'Ingresos contabilidad', Valor: kpis.ingresosContables },
      { Indicador: 'Egresos contabilidad', Valor: kpis.egresosContables },
    ]);
  }

  if (sections.includes('completa')) addSheet(wb, 'Conciliación completa', allRows);

  if (sections.includes('conciliados')) {
    addSheet(wb, 'Conciliados', allRows.filter((r) => r.Estado === STATUS_LABEL.CONCILIADO));
  }

  if (sections.includes('pendientes')) {
    const pend = new Set([
      STATUS_LABEL.PROBABLE,
      STATUS_LABEL.REVISION,
      STATUS_LABEL.DIF_VALOR,
      STATUS_LABEL.DIF_FECHA,
    ]);
    addSheet(wb, 'Pendientes', allRows.filter((r) => pend.has(r.Estado)));
  }

  if (sections.includes('noConciliados')) {
    addSheet(
      wb,
      'Banco sin contabilidad',
      allRows.filter((r) => r.Estado === STATUS_LABEL.NO_CONCILIADO || r.Estado === STATUS_LABEL.DUPLICADO),
    );
    addSheet(
      wb,
      'Contabilidad sin banco',
      ctx.ledger
        .filter((l) => {
          const s = result.ledgerStatus.get(l.id);
          return s === 'NO_CONCILIADO' || s === 'DUPLICADO';
        })
        .map((l) => ledgerRow(l, result.ledgerStatus.get(l.id) ?? 'NO_CONCILIADO', ctx.notes)),
    );
  }

  if (sections.includes('diferencias')) {
    addSheet(
      wb,
      'Diferencias',
      allRows.filter(
        (r) =>
          (typeof r['Diferencia valor'] === 'number' && Math.abs(r['Diferencia valor'] as number) > 0.01) ||
          (typeof r['Diferencia días'] === 'number' && Math.abs(r['Diferencia días'] as number) > 0),
      ),
    );
  }

  if (sections.includes('alertas')) {
    addSheet(
      wb,
      'Alertas',
      ctx.alerts.map((a) => ({
        Severidad: SEVERITY_LABEL[a.severity],
        Tipo: ALERT_KIND_LABEL[a.kind],
        Alerta: a.title,
        Detalle: a.detail,
        Valor: a.value,
        Fecha: formatDate(a.date),
        'Ids banco': a.bankIds.join(', '),
        'Ids contabilidad': a.ledgerIds.join(', '),
      })),
    );
  }

  if (sections.includes('terceros')) {
    addSheet(
      wb,
      'Por tercero',
      ctx.thirdParties.map((t) => ({
        NIT: t.nit ? formatNit(t.nit) : '',
        Tercero: t.name,
        Movimientos: t.movimientos,
        Débitos: t.debitos,
        Créditos: t.creditos,
        Neto: t.neto,
        Conciliados: t.conciliados,
        Pendientes: t.pendientes,
        'No conciliados': t.noConciliados,
        'Valor conciliado': t.valorConciliado,
        'Valor pendiente': t.valorPendiente,
        Diferencias: t.diferencia,
        'Cuentas relacionadas': t.cuentas.join(' | '),
      })),
    );
  }

  if (sections.includes('cuentas')) {
    addSheet(
      wb,
      'Por cuenta',
      ctx.accounts.map((a) => ({
        Cuenta: a.code,
        Nombre: a.name,
        Grupo: a.group,
        Movimientos: a.movimientos,
        Terceros: a.terceros,
        Débitos: a.debitos,
        Créditos: a.creditos,
        Neto: a.neto,
        Conciliados: a.conciliados,
        Pendientes: a.pendientes,
        'No conciliados': a.noConciliados,
        'Valor pendiente': a.valorPendiente,
        Diferencias: a.diferencia,
      })),
    );
  }

  if (sections.includes('auditoria')) {
    const rows: Record<string, unknown>[] = [];
    for (const [id, note] of Object.entries(ctx.notes)) {
      if (!note) continue;
      rows.push({ Movimiento: id, Observación: note, Revisado: ctx.reviewed.has(id) ? 'Sí' : 'No' });
    }
    for (const id of ctx.reviewed) {
      if (!ctx.notes[id]) rows.push({ Movimiento: id, Observación: '', Revisado: 'Sí' });
    }
    addSheet(wb, 'Observaciones', rows);
  }

  return wb;
}

function stamp(d: Date): string {
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    '_' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0')
  );
}

/** Genera y descarga el archivo .xlsx. */
export function exportExcel(ctx: ExportContext, sections: ExportSection[], fileName?: string): string {
  const wb = buildWorkbook(ctx, sections);
  const name = fileName ?? 'Conciliacion_' + stamp(ctx.meta.generatedAt) + '.xlsx';
  XLSX.writeFile(wb, name, { compression: true });
  return name;
}

/** Exporta un conjunto arbitrario de filas (usado por los botones de cada tabla). */
export function exportRows(rows: Record<string, unknown>[], sheetName: string, fileName: string): void {
  const wb = XLSX.utils.book_new();
  addSheet(wb, sheetName, rows);
  XLSX.writeFile(wb, fileName, { compression: true });
}
