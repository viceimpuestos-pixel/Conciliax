/**
 * Panel de alertas priorizado.
 */

import React, { useMemo, useState } from 'react';
import { useAlerts, useBankRows, useLedgerRows } from '../../state/selectors';
import { useStore } from '../../state/store';
import { Card, Field, IconAlert, IconCheck, IconDownload, IconEyeOff, EmptyState } from '../components/primitives';
import { ALERT_KIND_LABEL, SEVERITY_LABEL, type AlertKind, type AlertSeverity } from '../../core/analytics/alerts';
import { formatDate } from '../../core/normalize/dates';
import { formatMoney, formatNumber } from '../../core/normalize/money';
import { exportRows } from '../../core/export/excel';

const SEVERITIES: AlertSeverity[] = ['critica', 'alta', 'media', 'baja'];

export function AlertsPage() {
  const alerts = useAlerts();
  const toggleIgnore = useStore((s) => s.toggleIgnore);
  const toggleReviewed = useStore((s) => s.toggleReviewed);
  const setSection = useStore((s) => s.setSection);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);

  const [severity, setSeverity] = useState<AlertSeverity | 'todas'>('todas');
  const [kind, setKind] = useState<AlertKind | 'todas'>('todas');
  const [order, setOrder] = useState<'prioridad' | 'valor' | 'fecha'>('prioridad');

  const counts = useMemo(() => {
    const bySeverity = new Map<AlertSeverity, number>();
    const byKind = new Map<AlertKind, number>();
    for (const a of alerts) {
      bySeverity.set(a.severity, (bySeverity.get(a.severity) ?? 0) + 1);
      byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
    }
    return { bySeverity, byKind };
  }, [alerts]);

  const filtered = useMemo(() => {
    let list = alerts.filter(
      (a) => (severity === 'todas' || a.severity === severity) && (kind === 'todas' || a.kind === kind),
    );
    if (order === 'valor') list = list.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    else if (order === 'fecha') list = list.slice().sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
    return list;
  }, [alerts, severity, kind, order]);

  const totalValor = filtered.reduce((acc, a) => acc + Math.abs(a.value), 0);

  const doExport = () => {
    exportRows(
      filtered.map((a) => ({
        Severidad: SEVERITY_LABEL[a.severity],
        Tipo: ALERT_KIND_LABEL[a.kind],
        Alerta: a.title,
        Detalle: a.detail,
        Valor: a.value,
        Fecha: formatDate(a.date),
        'Ids banco': a.bankIds.join(', '),
        'Ids contabilidad': a.ledgerIds.join(', '),
      })),
      'Alertas',
      'Conciliax_Alertas.xlsx',
    );
  };

  const goToMovement = (bankIds: string[], ledgerIds: string[]) => {
    resetFilters();
    const id = bankIds[0] ?? ledgerIds[0];
    if (id) setFilter('search', id);
    setSection('conciliacion');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Panel de alertas</h2>
          <div className="sub">
            {formatNumber(alerts.length)} alertas detectadas · {formatMoney(totalValor)} en valor involucrado (según el
            filtro actual).
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={doExport} disabled={!filtered.length}>
            <IconDownload size={15} /> Exportar alertas
          </button>
        </div>
      </div>

      {/* Resumen por severidad */}
      <div className="kpi-grid">
        {SEVERITIES.map((s) => {
          const n = counts.bySeverity.get(s) ?? 0;
          const tone = s === 'critica' ? 'red' : s === 'alta' ? 'amber' : s === 'media' ? 'blue' : 'grey';
          return (
            <div
              key={s}
              className={'kpi ' + tone}
              style={{ cursor: 'pointer', opacity: severity === 'todas' || severity === s ? 1 : 0.55 }}
              onClick={() => setSeverity(severity === s ? 'todas' : s)}
            >
              <div className="kpi-label">
                <IconAlert size={13} /> Severidad {SEVERITY_LABEL[s]}
              </div>
              <div className="kpi-value">{formatNumber(n)}</div>
              <div className="kpi-foot">{severity === s ? 'Filtro activo — clic para quitar' : 'Clic para filtrar'}</div>
            </div>
          );
        })}
      </div>

      <Card className="mb-16">
        <div className="filter-bar">
          <Field label="Tipo de alerta" width="lg">
            <select value={kind} onChange={(e) => setKind(e.target.value as never)}>
              <option value="todas">Todos los tipos ({alerts.length})</option>
              {(Object.keys(ALERT_KIND_LABEL) as AlertKind[]).map((k) => (
                <option key={k} value={k} disabled={!counts.byKind.get(k)}>
                  {ALERT_KIND_LABEL[k]} ({counts.byKind.get(k) ?? 0})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Severidad" width="md">
            <select value={severity} onChange={(e) => setSeverity(e.target.value as never)}>
              <option value="todas">Todas</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s]} ({counts.bySeverity.get(s) ?? 0})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Ordenar por" width="md">
            <select value={order} onChange={(e) => setOrder(e.target.value as never)}>
              <option value="prioridad">Prioridad (recomendado)</option>
              <option value="valor">Valor involucrado</option>
              <option value="fecha">Fecha más reciente</option>
            </select>
          </Field>

          <button
            className="btn"
            onClick={() => {
              setSeverity('todas');
              setKind('todas');
              setOrder('prioridad');
            }}
          >
            Limpiar filtros
          </button>
        </div>
      </Card>

      <Card flush>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<IconCheck size={24} />}
            title="Sin alertas con estos criterios"
            description="No hay situaciones que requieran atención bajo el filtro seleccionado."
          />
        ) : (
          <div style={{ maxHeight: '64vh', overflowY: 'auto' }}>
            {filtered.map((a) => (
              <div className="alert-row" key={a.id}>
                <div className={'bar ' + a.severity} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className={'badge ' + a.severity}>{SEVERITY_LABEL[a.severity]}</span>
                    <span className="badge neutral">{ALERT_KIND_LABEL[a.kind]}</span>
                    <span className="a-title">{a.title}</span>
                  </div>
                  <div className="a-detail">{a.detail}</div>
                  <div className="row mt-8" style={{ gap: 6 }}>
                    <button className="btn xs" onClick={() => goToMovement(a.bankIds, a.ledgerIds)}>
                      Ver movimiento
                    </button>
                    {a.bankIds.length === 1 && (
                      <button className="btn xs ghost" onClick={() => toggleReviewed(a.bankIds[0])}>
                        <IconCheck size={12} /> Marcar revisado
                      </button>
                    )}
                    {a.bankIds.length === 1 && (
                      <button className="btn xs ghost" onClick={() => toggleIgnore('bank', a.bankIds[0])}>
                        <IconEyeOff size={12} /> Ignorar
                      </button>
                    )}
                    {a.ledgerIds.length === 1 && a.bankIds.length === 0 && (
                      <button className="btn xs ghost" onClick={() => toggleIgnore('ledger', a.ledgerIds[0])}>
                        <IconEyeOff size={12} /> Ignorar
                      </button>
                    )}
                  </div>
                </div>
                <div className={'a-value ' + (a.value < 0 ? 'value-neg' : 'value-pos')}>
                  {formatMoney(a.value)}
                  {a.date && <div className="small muted" style={{ fontWeight: 400 }}>{formatDate(a.date)}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
