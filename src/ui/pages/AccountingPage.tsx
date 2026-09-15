/**
 * Análisis contable: por cuenta, por grupo PUC y por período.
 */

import React, { useMemo, useState } from 'react';
import { useAccountGroups, useAccounts, useLedgerRows, useResult } from '../../state/selectors';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { Card, Cell, ProgressBar } from '../components/primitives';
import { formatMoney, formatNumber, formatPercent } from '../../core/normalize/money';
import { monthKey, monthLabel } from '../../core/normalize/dates';
import { AccountDifferencesChart } from '../charts';
import type { AccountSummary } from '../../core/analytics/aggregations';

type View = 'cuenta' | 'grupo' | 'periodo';

export function AccountingPage() {
  const [view, setView] = useState<View>('cuenta');
  const accounts = useAccounts();
  const groups = useAccountGroups();
  const ledger = useLedgerRows();
  const result = useResult();

  const periods = useMemo(() => {
    const map = new Map<string, { key: string; label: string; movimientos: number; debitos: number; creditos: number; neto: number; conciliados: number; pendientes: number; noConciliados: number; valorPendiente: number }>();
    for (const l of ledger) {
      const k = monthKey(l.date);
      if (!k) continue;
      const item =
        map.get(k) ??
        { key: k, label: monthLabel(k), movimientos: 0, debitos: 0, creditos: 0, neto: 0, conciliados: 0, pendientes: 0, noConciliados: 0, valorPendiente: 0 };
      item.movimientos++;
      item.debitos += l.debit;
      item.creditos += l.credit;
      item.neto += l.amount;
      const s = result.ledgerStatus.get(l.id) ?? 'NO_CONCILIADO';
      if (s === 'CONCILIADO') item.conciliados++;
      else if (s === 'NO_CONCILIADO' || s === 'DUPLICADO') {
        item.noConciliados++;
        item.valorPendiente += Math.abs(l.amount);
      } else if (s !== 'IGNORADO') {
        item.pendientes++;
        item.valorPendiente += Math.abs(l.amount);
      }
      map.set(k, item);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [ledger, result]);

  const accountColumns: Column<AccountSummary>[] = [
    {
      key: 'cuenta',
      header: 'Cuenta',
      render: (a) => <Cell main={a.code} sub={a.name} />,
      sortValue: (a) => a.code,
    },
    { key: 'grupo', header: 'Grupo', render: (a) => <span className="mono">{a.group}</span>, sortValue: (a) => a.group, nowrap: true },
    { key: 'mov', header: 'Movim.', render: (a) => formatNumber(a.movimientos), sortValue: (a) => a.movimientos, align: 'right' },
    { key: 'ter', header: 'Terceros', render: (a) => formatNumber(a.terceros), sortValue: (a) => a.terceros, align: 'right' },
    { key: 'deb', header: 'Débitos', render: (a) => formatMoney(a.debitos), sortValue: (a) => a.debitos, align: 'right' },
    { key: 'cre', header: 'Créditos', render: (a) => formatMoney(a.creditos), sortValue: (a) => a.creditos, align: 'right' },
    {
      key: 'neto',
      header: 'Neto',
      render: (a) => <span className={a.neto >= 0 ? 'value-pos' : 'value-neg'} style={{ fontWeight: 600 }}>{formatMoney(a.neto)}</span>,
      sortValue: (a) => a.neto,
      align: 'right',
    },
    {
      key: 'avance',
      header: 'Conciliación',
      render: (a) => {
        const pct = a.movimientos ? (a.conciliados / a.movimientos) * 100 : 0;
        return (
          <div style={{ minWidth: 110 }}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
              <span className="muted">{a.conciliados}/{a.movimientos}</span>
              <strong className="tnum">{formatPercent(pct, 0)}</strong>
            </div>
            <div className="mt-8">
              <ProgressBar value={pct} tone={pct >= 90 ? 'green' : pct >= 60 ? 'amber' : 'red'} />
            </div>
          </div>
        );
      },
      sortValue: (a) => (a.movimientos ? a.conciliados / a.movimientos : 0),
    },
    {
      key: 'dif',
      header: 'Diferencia frente al banco',
      render: (a) => {
        const total = a.valorPendiente + a.diferencia;
        return total ? <span className="value-neg" style={{ fontWeight: 600 }}>{formatMoney(total)}</span> : <span className="muted">Sin diferencias</span>;
      },
      sortValue: (a) => a.valorPendiente + a.diferencia,
      align: 'right',
    },
  ];

  const data = view === 'grupo' ? groups : accounts;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Análisis contable</h2>
          <div className="sub">Identifique qué cuentas y qué períodos concentran las diferencias frente al banco.</div>
        </div>
      </div>

      <FilterBar compact />

      <Card title="Cuentas con mayores diferencias" subtitle="Valor pendiente de conciliar más diferencias de valor" className="mb-16">
        <AccountDifferencesChart data={accounts.slice(0, 12)} height={Math.max(220, Math.min(12, accounts.length) * 30)} />
      </Card>

      <div className="tabs">
        <button className={'tab' + (view === 'cuenta' ? ' on' : '')} onClick={() => setView('cuenta')}>
          Por cuenta <span className="count">{accounts.length}</span>
        </button>
        <button className={'tab' + (view === 'grupo' ? ' on' : '')} onClick={() => setView('grupo')}>
          Por grupo PUC <span className="count">{groups.length}</span>
        </button>
        <button className={'tab' + (view === 'periodo' ? ' on' : '')} onClick={() => setView('periodo')}>
          Por período <span className="count">{periods.length}</span>
        </button>
      </div>

      <Card flush>
        {view === 'periodo' ? (
          <DataTable
            rows={periods}
            columns={[
              { key: 'mes', header: 'Período', render: (p) => p.label, sortValue: (p) => p.key, nowrap: true },
              { key: 'mov', header: 'Movim.', render: (p) => formatNumber(p.movimientos), sortValue: (p) => p.movimientos, align: 'right' },
              { key: 'deb', header: 'Débitos', render: (p) => formatMoney(p.debitos), sortValue: (p) => p.debitos, align: 'right' },
              { key: 'cre', header: 'Créditos', render: (p) => formatMoney(p.creditos), sortValue: (p) => p.creditos, align: 'right' },
              {
                key: 'neto',
                header: 'Neto',
                render: (p) => <span className={p.neto >= 0 ? 'value-pos' : 'value-neg'}>{formatMoney(p.neto)}</span>,
                sortValue: (p) => p.neto,
                align: 'right',
              },
              { key: 'conc', header: 'Conciliados', render: (p) => formatNumber(p.conciliados), sortValue: (p) => p.conciliados, align: 'right' },
              { key: 'pend', header: 'Pendientes', render: (p) => formatNumber(p.pendientes + p.noConciliados), sortValue: (p) => p.pendientes + p.noConciliados, align: 'right' },
              {
                key: 'valor',
                header: 'Valor pendiente',
                render: (p) => (p.valorPendiente ? <span className="value-neg">{formatMoney(p.valorPendiente)}</span> : <span className="muted">—</span>),
                sortValue: (p) => p.valorPendiente,
                align: 'right',
              },
            ]}
            rowKey={(p) => p.key}
            exportName="Analisis_por_periodo"
            emptyTitle="Sin períodos"
          />
        ) : (
          <DataTable
            rows={data}
            columns={accountColumns}
            rowKey={(a) => a.code}
            exportName={view === 'grupo' ? 'Analisis_por_grupo' : 'Analisis_por_cuenta'}
            emptyTitle="Sin cuentas"
            initialSort={{ key: 'dif', dir: 'desc' }}
          />
        )}
      </Card>
    </>
  );
}
