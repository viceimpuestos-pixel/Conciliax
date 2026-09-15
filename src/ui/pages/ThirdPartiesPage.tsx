/**
 * Análisis por tercero: totales, conciliación y detalle de movimientos.
 */

import React, { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useBankRows, useLedgerRows, useResult, useThirdParties } from '../../state/selectors';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { Card, Cell, EmptyState, IconUsers, Modal, ProgressBar, ScoreMeter, StatusBadge } from '../components/primitives';
import { formatDate, monthKey, monthLabel } from '../../core/normalize/dates';
import { formatMoney, formatNumber, formatPercent } from '../../core/normalize/money';
import { formatNit } from '../../core/normalize/nit';
import { ThirdPartyMiniChart, DonutChart, C } from '../charts';
import type { ThirdPartySummary } from '../../core/analytics/aggregations';

export function ThirdPartiesPage() {
  const all = useThirdParties();
  const selected = useStore((s) => s.selectedThirdParty);
  const select = useStore((s) => s.selectThirdParty);
  const filters = useStore((s) => s.filters);

  const rows = useMemo(() => {
    const term = filters.tercero.toLowerCase().trim();
    const nit = filters.nit.replace(/\D/g, '');
    const search = filters.search.toLowerCase().trim();
    return all.filter((t) => {
      if (term && !t.name.toLowerCase().includes(term)) return false;
      if (nit && !t.nit.includes(nit)) return false;
      if (search && !(t.name.toLowerCase().includes(search) || t.nit.includes(search))) return false;
      return true;
    });
  }, [all, filters]);

  const columns: Column<ThirdPartySummary>[] = [
    {
      key: 'tercero',
      header: 'Tercero',
      render: (t) => <Cell main={t.name} sub={t.nit ? formatNit(t.nit) : 'Sin NIT'} />,
      sortValue: (t) => t.name,
    },
    { key: 'mov', header: 'Movim.', render: (t) => formatNumber(t.movimientos), sortValue: (t) => t.movimientos, align: 'right' },
    { key: 'deb', header: 'Débitos', render: (t) => formatMoney(t.debitos), sortValue: (t) => t.debitos, align: 'right' },
    { key: 'cre', header: 'Créditos', render: (t) => formatMoney(t.creditos), sortValue: (t) => t.creditos, align: 'right' },
    {
      key: 'neto',
      header: 'Neto',
      render: (t) => <span className={t.neto >= 0 ? 'value-pos' : 'value-neg'} style={{ fontWeight: 600 }}>{formatMoney(t.neto)}</span>,
      sortValue: (t) => t.neto,
      align: 'right',
    },
    {
      key: 'avance',
      header: 'Conciliación',
      render: (t) => {
        const pct = t.movimientos ? (t.conciliados / t.movimientos) * 100 : 0;
        return (
          <div style={{ minWidth: 120 }}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
              <span className="muted">{t.conciliados}/{t.movimientos}</span>
              <strong className="tnum">{formatPercent(pct, 0)}</strong>
            </div>
            <div className="mt-8">
              <ProgressBar value={pct} tone={pct >= 90 ? 'green' : pct >= 60 ? 'amber' : 'red'} />
            </div>
          </div>
        );
      },
      sortValue: (t) => (t.movimientos ? t.conciliados / t.movimientos : 0),
    },
    {
      key: 'pend',
      header: 'Valor pendiente',
      render: (t) => (t.valorPendiente ? <span className="value-neg">{formatMoney(t.valorPendiente)}</span> : <span className="muted">—</span>),
      sortValue: (t) => t.valorPendiente,
      align: 'right',
    },
    {
      key: 'dif',
      header: 'Diferencias',
      render: (t) => (t.diferencia ? <span className="value-neg">{formatMoney(t.diferencia)}</span> : <span className="muted">—</span>),
      sortValue: (t) => t.diferencia,
      align: 'right',
    },
    { key: 'cuentas', header: 'Cuentas', render: (t) => <span className="small muted">{t.cuentas.length}</span>, sortValue: (t) => t.cuentas.length, align: 'right' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Análisis por tercero</h2>
          <div className="sub">{formatNumber(rows.length)} terceros en el auxiliar contable. Haga clic en uno para ver su detalle.</div>
        </div>
      </div>

      <FilterBar compact />

      <Card flush>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(t) => t.key}
          onRowClick={(t) => select(t.key)}
          selectedKey={selected}
          exportName="Analisis_por_tercero"
          emptyTitle="Sin terceros"
          initialSort={{ key: 'neto', dir: 'desc' }}
        />
      </Card>

      {selected && <ThirdPartyModal id={selected} onClose={() => select(null)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function ThirdPartyModal({ id, onClose }: { id: string; onClose: () => void }) {
  const summaries = useThirdParties();
  const ledger = useLedgerRows();
  const bank = useBankRows();
  const result = useResult();

  const t = summaries.find((x) => x.key === id);
  const movimientos = useMemo(() => ledger.filter((l) => (l.thirdPartyId || l.thirdPartyName || 'SIN_TERCERO') === id), [ledger, id]);

  const monthlyData = useMemo(() => {
    const map = new Map<string, { label: string; debitos: number; creditos: number }>();
    for (const m of movimientos) {
      const k = monthKey(m.date);
      if (!k) continue;
      const item = map.get(k) ?? { label: monthLabel(k), debitos: 0, creditos: 0 };
      item.debitos += m.debit;
      item.creditos += m.credit;
      map.set(k, item);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  }, [movimientos]);

  const bankMovs = useMemo(() => {
    const ids = new Set(t?.bankIds ?? []);
    return bank.filter((b) => ids.has(b.id));
  }, [bank, t]);

  if (!t) return null;

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={t.name}
      subtitle={(t.nit ? 'NIT ' + formatNit(t.nit) + ' · ' : '') + formatNumber(t.movimientos) + ' movimientos contables'}
      footer={<button className="btn" onClick={onClose}>Cerrar</button>}
    >
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        <MiniKpi label="Total débitos" value={formatMoney(t.debitos)} tone="blue" />
        <MiniKpi label="Total créditos" value={formatMoney(t.creditos)} tone="navy" />
        <MiniKpi label="Neto" value={formatMoney(t.neto)} tone={t.neto >= 0 ? 'green' : 'red'} />
        <MiniKpi label="Conciliado" value={formatMoney(t.valorConciliado)} tone="green" />
        <MiniKpi label="Pendiente" value={formatMoney(t.valorPendiente)} tone="amber" />
        <MiniKpi label="Diferencias" value={formatMoney(t.diferencia)} tone={t.diferencia ? 'red' : 'grey'} />
      </div>

      <div className="chart-grid mt-16 mb-16">
        <div className="span-8">
          <Card title="Débitos y créditos por mes">
            <ThirdPartyMiniChart data={monthlyData} />
          </Card>
        </div>
        <div className="span-4">
          <Card title="Estado de sus movimientos">
            <DonutChart
              money={false}
              height={170}
              centerValue={String(t.movimientos)}
              centerLabel="movimientos"
              data={[
                { name: 'Conciliados', value: t.conciliados, color: C.green },
                { name: 'Pendientes', value: t.pendientes, color: C.amber },
                { name: 'No conciliados', value: t.noConciliados, color: C.grey },
              ].filter((d) => d.value > 0)}
            />
          </Card>
        </div>
      </div>

      {t.cuentas.length > 0 && (
        <div className="mb-16">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>Cuentas contables relacionadas</h4>
          <div className="row wrap">
            {t.cuentas.map((c) => (
              <span className="chip" key={c}>{c}</span>
            ))}
          </div>
        </div>
      )}

      <h4 style={{ fontSize: 13, marginBottom: 8 }}>Últimos movimientos contables</h4>
      <div className="table-wrap" style={{ maxHeight: 260, border: '1px solid var(--grey-200)', borderRadius: 8 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Fecha</th>
              <th>Cuenta</th>
              <th>Documento</th>
              <th>Descripción</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {movimientos
              .slice()
              .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
              .slice(0, 60)
              .map((m) => (
                <tr key={m.id}>
                  <td><StatusBadge status={result.ledgerStatus.get(m.id) ?? 'NO_CONCILIADO'} /></td>
                  <td className="nowrap">{formatDate(m.date)}</td>
                  <td className="mono">{m.accountCode}</td>
                  <td className="nowrap">{(m.documentType + ' ' + m.documentNumber).trim()}</td>
                  <td className="wrap">{m.description}</td>
                  <td className={'num ' + (m.amount >= 0 ? 'value-pos' : 'value-neg')}>{formatMoney(m.amount)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ fontSize: 13, margin: '16px 0 8px' }}>Movimientos bancarios relacionados</h4>
      {bankMovs.length ? (
        <div className="table-wrap" style={{ maxHeight: 220, border: '1px solid var(--grey-200)', borderRadius: 8 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Referencia</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {bankMovs.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap">{formatDate(b.date)}</td>
                  <td className="wrap">{b.description}</td>
                  <td className="mono">{b.reference || b.transactionNumber}</td>
                  <td className={'num ' + (b.amount >= 0 ? 'value-pos' : 'value-neg')}>{formatMoney(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={<IconUsers size={22} />} title="Sin movimientos bancarios cruzados" description="Ningún movimiento del extracto se ha vinculado todavía con este tercero." />
      )}
    </Modal>
  );
}

function MiniKpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={'kpi ' + tone} style={{ padding: '10px 12px' }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value sm">{value}</div>
    </div>
  );
}
