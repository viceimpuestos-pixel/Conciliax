/**
 * Reportes: exportación a Excel (multi-hoja), informe ejecutivo en PDF y bitácora.
 */

import React, { useState } from 'react';
import { useStore } from '../../state/store';
import { useAccounts, useAlerts, useBankRows, useKpis, useLedgerRows, useResult, useThirdParties } from '../../state/selectors';
import { Card, Field, IconCheck, IconDownload, IconFile, Notice, Switch } from '../components/primitives';
import { EXPORT_SECTIONS, exportExcel, type ExportContext, type ExportSection } from '../../core/export/excel';
import { exportPdf } from '../../core/export/pdf';
import { formatDate } from '../../core/normalize/dates';
import { formatMoney, formatNumber } from '../../core/normalize/money';

export function ReportsPage() {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  const kpis = useKpis();
  const alerts = useAlerts();
  const thirdParties = useThirdParties();
  const accounts = useAccounts();
  const overrides = useStore((s) => s.overrides);
  const audit = useStore((s) => s.audit);
  const bankFile = useStore((s) => s.bank.fileName);
  const ledgerFile = useStore((s) => s.ledger.fileName);
  const log = useStore((s) => s.log);

  const [sections, setSections] = useState<ExportSection[]>(EXPORT_SECTIONS.map((s) => s.id));
  const [company, setCompany] = useState('');
  const [period, setPeriod] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const ctx = (): ExportContext => ({
    bank,
    ledger,
    result,
    kpis,
    alerts,
    thirdParties,
    accounts,
    notes: overrides.notes,
    reviewed: new Set(overrides.reviewed),
    meta: { bankFile, ledgerFile, generatedAt: new Date() },
  });

  const toggle = (id: ExportSection) =>
    setSections((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const doExcel = () => {
    const name = exportExcel(ctx(), sections);
    log('Exportación a Excel', name + ' (' + sections.length + ' hojas)');
    setDone('Se descargó ' + name);
  };

  const doPdf = () => {
    const name = exportPdf(ctx(), {
      companyName: company || undefined,
      period: period || undefined,
      preparedBy: preparedBy || undefined,
    });
    log('Informe PDF generado', name);
    setDone('Se descargó ' + name);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Reportes y exportación</h2>
          <div className="sub">Los archivos se generan en su equipo; no se envía información a ningún servidor.</div>
        </div>
      </div>

      {done && (
        <div className="mb-16">
          <Notice type="success">
            <strong>{done}.</strong> Revise la carpeta de descargas de su navegador.
          </Notice>
        </div>
      )}

      <div className="chart-grid">
        <div className="span-8">
          <Card
            title="Exportar a Excel"
            subtitle="Un libro con una hoja por cada sección seleccionada."
            right={
              <button className="btn primary" onClick={doExcel} disabled={!sections.length}>
                <IconDownload size={15} /> Descargar Excel
              </button>
            }
          >
            <div className="map-grid">
              {EXPORT_SECTIONS.map((s) => (
                <label
                  key={s.id}
                  className={'map-row' + (sections.includes(s.id) ? ' auto' : '')}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={sections.includes(s.id)}
                      onChange={() => toggle(s.id)}
                      style={{ marginTop: 2 }}
                    />
                    <div>
                      <div className="map-label">{s.label}</div>
                      <div className="map-meta" style={{ display: 'block' }}>{s.description}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="row mt-12" style={{ gap: 8 }}>
              <button className="btn sm" onClick={() => setSections(EXPORT_SECTIONS.map((s) => s.id))}>
                Seleccionar todo
              </button>
              <button className="btn sm ghost" onClick={() => setSections([])}>
                Quitar todo
              </button>
            </div>
          </Card>
        </div>

        <div className="span-4">
          <Card
            title="Informe ejecutivo en PDF"
            subtitle="Portada, indicadores, alertas y partidas conciliatorias."
            right={
              <button className="btn dark" onClick={doPdf}>
                <IconFile size={15} /> Generar PDF
              </button>
            }
          >
            <div className="col">
              <Field label="Empresa (opcional)" width="auto">
                <input placeholder="Razón social" value={company} onChange={(e) => setCompany(e.target.value)} />
              </Field>
              <Field label="Período (opcional)" width="auto">
                <input placeholder="Marzo de 2026" value={period} onChange={(e) => setPeriod(e.target.value)} />
              </Field>
              <Field label="Elaborado por (opcional)" width="auto">
                <input placeholder="Nombre del responsable" value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} />
              </Field>
            </div>

            <div className="mt-16">
              <Notice type="info">
                El informe incluye los saldos, el estado de la conciliación, las quince alertas más relevantes y las
                partidas conciliatorias de mayor cuantía.
              </Notice>
            </div>
          </Card>
        </div>

        <div className="span-12">
          <Card title="Contenido del informe" subtitle="Cifras que quedarán registradas">
            <div className="kpi-grid" style={{ marginBottom: 0 }}>
              <Sum label="Saldo banco" value={formatMoney(kpis.saldoBanco)} />
              <Sum label="Saldo contabilidad" value={formatMoney(kpis.saldoContable)} />
              <Sum label="Diferencia" value={formatMoney(kpis.diferencia)} tone={Math.abs(kpis.diferencia) < 1 ? 'green' : 'red'} />
              <Sum label="Movimientos conciliados" value={formatNumber(kpis.conciliados) + ' / ' + formatNumber(kpis.totalMovBanco)} tone="green" />
              <Sum label="Alertas" value={formatNumber(alerts.length)} tone="amber" />
              <Sum label="Terceros analizados" value={formatNumber(thirdParties.length)} />
            </div>
          </Card>
        </div>

        <div className="span-12">
          <Card
            title="Bitácora de acciones"
            subtitle="Registro de las decisiones manuales realizadas en esta sesión"
            flush
          >
            {audit.length === 0 ? (
              <div className="empty" style={{ padding: 32 }}>
                <p>Todavía no se han registrado acciones manuales.</p>
              </div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 320 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Fecha y hora</th>
                      <th>Acción</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((e) => (
                      <tr key={e.id}>
                        <td className="nowrap mono">
                          {formatDate(e.at)} {e.at.toLocaleTimeString('es-CO')}
                        </td>
                        <td className="nowrap strong">{e.action}</td>
                        <td className="wrap">{e.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Sum({ label, value, tone = 'grey' }: { label: string; value: string; tone?: string }) {
  return (
    <div className={'kpi ' + tone}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value sm">{value}</div>
    </div>
  );
}
