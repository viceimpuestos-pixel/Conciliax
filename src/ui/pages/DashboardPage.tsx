/**
 * Dashboard ejecutivo: KPIs y los diez gráficos de análisis.
 */

import React from 'react';
import { useStore } from '../../state/store';
import {
  useAccounts,
  useAlerts,
  useBalances,
  useKpis,
  useMonthly,
  useStatusDistribution,
  useThirdParties,
} from '../../state/selectors';
import { topThirdPartiesByDifference, topThirdPartiesByValue } from '../../core/analytics/aggregations';
import { formatDate } from '../../core/normalize/dates';
import { formatMoney, formatNumber, formatPercent } from '../../core/normalize/money';
import {
  Card,
  Help,
  IconAlert,
  IconArrowDown,
  IconArrowUp,
  IconBank,
  IconCheck,
  IconFile,
  ProgressBar,
  Tooltip,
} from '../components/primitives';
import {
  AccountDifferencesChart,
  BalanceChart,
  C,
  DifferenceChart,
  DonutChart,
  IncomeExpenseChart,
  ReconciledVsPendingChart,
  ReconciliationTrendChart,
  StatusDonut,
  TopDifferencesChart,
  TopThirdPartiesChart,
} from '../charts';

export function DashboardPage() {
  const kpis = useKpis();
  const monthly = useMonthly();
  const balances = useBalances();
  const statuses = useStatusDistribution();
  const thirdParties = useThirdParties();
  const accounts = useAccounts();
  const alerts = useAlerts();
  const setSection = useStore((s) => s.setSection);
  const lastRunAt = useStore((s) => s.lastRunAt);
  const bankFile = useStore((s) => s.bank.fileName);
  const ledgerFile = useStore((s) => s.ledger.fileName);

  const cuadra = Math.abs(kpis.diferencia) < 1;
  const pendientes = kpis.probables + kpis.pendientes + kpis.difValor + kpis.difFecha;
  const criticas = alerts.filter((a) => a.severity === 'critica').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Resumen ejecutivo</h2>
          <div className="sub">
            {bankFile} · {ledgerFile}
            {lastRunAt && ' · Última conciliación: ' + formatDate(lastRunAt) + ' ' + lastRunAt.toLocaleTimeString('es-CO')}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setSection('conciliacion')}>
            Ver movimientos
          </button>
          <button className="btn primary" onClick={() => setSection('reportes')}>
            <IconFile size={15} /> Generar informe
          </button>
        </div>
      </div>

      {/* ---------- Bloque 1: saldos ---------- */}
      <div className="kpi-grid">
        <Kpi
          tone="navy"
          label="Saldo según banco"
          value={formatMoney(kpis.saldoBanco)}
          foot={
            kpis.saldoBancoEsNeto
              ? 'Neto de movimientos (el extracto no trae columna de saldo)'
              : 'Saldo final del extracto'
          }
          icon={<IconBank size={13} />}
        />
        <Kpi
          tone="blue"
          label="Saldo según contabilidad"
          value={formatMoney(kpis.saldoContable)}
          foot="Neto del auxiliar contable"
          icon={<IconFile size={13} />}
        />
        <Kpi
          tone={cuadra ? 'green' : 'red'}
          label="Diferencia banco − contabilidad"
          value={formatMoney(kpis.diferencia)}
          valueClass={cuadra ? 'value-pos' : 'value-neg'}
          foot={cuadra ? 'Los saldos cuadran' : 'Requiere partidas conciliatorias'}
          icon={cuadra ? <IconCheck size={13} /> : <IconAlert size={13} />}
          help="Diferencia entre el saldo del extracto y el saldo del auxiliar. Se explica con las partidas conciliatorias: movimientos del banco no registrados y registros contables no reflejados en el banco."
        />
        <Kpi
          tone={kpis.porcentajeConciliacion >= 90 ? 'green' : kpis.porcentajeConciliacion >= 70 ? 'amber' : 'red'}
          label="Porcentaje de conciliación"
          value={formatPercent(kpis.porcentajeConciliacion)}
          foot={
            <>
              <ProgressBar
                value={kpis.porcentajeConciliacion}
                tone={kpis.porcentajeConciliacion >= 90 ? 'green' : kpis.porcentajeConciliacion >= 70 ? 'amber' : 'red'}
              />
            </>
          }
        />
      </div>

      {/* ---------- Bloque 2: volúmenes ---------- */}
      <div className="kpi-grid">
        <Kpi tone="grey" label="Movimientos bancarios" value={formatNumber(kpis.totalMovBanco)} foot={<>Ingresos <strong>{formatMoney(kpis.ingresosBanco)}</strong></>} />
        <Kpi tone="grey" label="Movimientos contables" value={formatNumber(kpis.totalMovContable)} foot={<>Egresos <strong>{formatMoney(kpis.egresosBanco)}</strong></>} />
        <Kpi
          tone="green"
          label="Conciliados"
          value={formatNumber(kpis.conciliados)}
          foot={<>Valor <strong>{formatMoney(kpis.valorConciliado)}</strong></>}
          onClick={() => setSection('conciliacion')}
        />
        <Kpi
          tone="amber"
          label="Pendientes"
          value={formatNumber(pendientes)}
          foot={<>Valor <strong>{formatMoney(kpis.valorPendiente)}</strong></>}
          onClick={() => setSection('conciliacion')}
        />
        <Kpi
          tone="red"
          label="No conciliados"
          value={formatNumber(kpis.noConciliados + kpis.duplicados)}
          foot={<>Valor <strong>{formatMoney(kpis.valorNoConciliado)}</strong></>}
          onClick={() => setSection('conciliacion')}
        />
        <Kpi
          tone={criticas ? 'red' : 'grey'}
          label="Alertas"
          value={formatNumber(alerts.length)}
          foot={criticas ? <span style={{ color: 'var(--red-600)', fontWeight: 600 }}>{criticas} crítica(s)</span> : 'Sin alertas críticas'}
          onClick={() => setSection('alertas')}
        />
      </div>

      {/* ---------- Gráficos ---------- */}
      <div className="chart-grid mt-16">
        <div className="span-8">
          <Card title="1. Ingresos vs. egresos por mes" subtitle="Movimiento bancario del período">
            <IncomeExpenseChart data={monthly} />
          </Card>
        </div>

        <div className="span-4">
          <Card title="8. Movimientos por estado" subtitle="Distribución del extracto">
            <StatusDonut data={statuses} />
          </Card>
        </div>

        <div className="span-4">
          <Card title="2. Evolución de la conciliación" subtitle="% conciliado por mes">
            <ReconciliationTrendChart data={monthly} />
          </Card>
        </div>

        <div className="span-4">
          <Card title="3. Conciliados vs. pendientes" subtitle="Movimientos por mes">
            <ReconciledVsPendingChart data={monthly} />
          </Card>
        </div>

        <div className="span-4">
          <Card title="4. Valor conciliado vs. no conciliado" subtitle="Participación sobre el valor total">
            <DonutChart
              centerValue={formatPercent(kpis.porcentajeValorConciliado, 0)}
              centerLabel="del valor"
              data={[
                { name: 'Conciliado', value: kpis.valorConciliado, color: C.green },
                { name: 'Pendiente', value: kpis.valorPendiente, color: C.amber },
                { name: 'No conciliado', value: kpis.valorNoConciliado, color: C.grey },
              ]}
            />
          </Card>
        </div>

        <div className="span-6">
          <Card title="9-10. Evolución del saldo bancario y contable" subtitle="Acumulado mes a mes">
            <BalanceChart data={balances} />
          </Card>
        </div>

        <div className="span-6">
          <Card title="Diferencia acumulada" subtitle="Banco menos contabilidad, mes a mes">
            <DifferenceChart data={balances} />
          </Card>
        </div>

        <div className="span-6">
          <Card
            title="5. Top 10 terceros por valor"
            subtitle="Valor neto movido en el auxiliar"
            right={
              <button className="btn xs" onClick={() => setSection('terceros')}>
                Ver detalle
              </button>
            }
          >
            <TopThirdPartiesChart data={topThirdPartiesByValue(thirdParties, 10)} />
          </Card>
        </div>

        <div className="span-6">
          <Card
            title="6. Top 10 terceros con mayores diferencias"
            subtitle="Valor pendiente + diferencias en los cruces"
            right={
              <button className="btn xs" onClick={() => setSection('terceros')}>
                Ver detalle
              </button>
            }
          >
            <TopDifferencesChart data={topThirdPartiesByDifference(thirdParties, 10)} />
          </Card>
        </div>

        <div className="span-12">
          <Card
            title="7. Diferencias por cuenta contable"
            subtitle="Cuentas con mayor valor sin conciliar"
            right={
              <button className="btn xs" onClick={() => setSection('contable')}>
                Ver análisis contable
              </button>
            }
          >
            <AccountDifferencesChart data={accounts.slice(0, 10)} height={Math.max(200, accounts.slice(0, 10).length * 30)} />
          </Card>
        </div>
      </div>

      {/* ---------- Alertas destacadas ---------- */}
      {alerts.length > 0 && (
        <div className="mt-16">
          <Card
            title="Requieren su atención"
            subtitle="Las seis alertas de mayor prioridad"
            right={
              <button className="btn sm" onClick={() => setSection('alertas')}>
                Ver las {alerts.length} alertas
              </button>
            }
            flush
          >
            {alerts.slice(0, 6).map((a) => (
              <div className="alert-row" key={a.id}>
                <div className={'bar ' + a.severity} />
                <div className="grow">
                  <div className="a-title">{a.title}</div>
                  <div className="a-detail">{a.detail}</div>
                </div>
                <div className={'a-value ' + (a.value < 0 ? 'value-neg' : 'value-pos')}>{formatMoney(a.value)}</div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function Kpi({
  label,
  value,
  foot,
  tone = 'blue',
  icon,
  help,
  valueClass,
  onClick,
}: {
  label: string;
  value: string;
  foot?: React.ReactNode;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'navy' | 'grey';
  icon?: React.ReactNode;
  help?: string;
  valueClass?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={'kpi ' + tone}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="kpi-label">
        {icon}
        {label}
        {help && <Help text={help} />}
      </div>
      <div className={'kpi-value ' + (valueClass ?? '')}>{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}
