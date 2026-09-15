/**
 * Gráficos del dashboard (Recharts) con tema corporativo y tooltips propios.
 */

import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompact, formatMoney, formatPercent } from '../../core/normalize/money';
import type { MonthlyPoint, BalancePoint, StatusSlice, ThirdPartySummary, AccountSummary } from '../../core/analytics/aggregations';
import type { MatchStatus } from '../../core/types';

export const C = {
  navy: '#0f2a4a',
  blue: '#2a72d4',
  blueDark: '#17509b',
  blueLight: '#9cc2f0',
  green: '#1a9465',
  greenLight: '#7ec9a9',
  amber: '#c78a0a',
  red: '#d13d3d',
  violet: '#5b46a8',
  orange: '#e07a2c',
  grey: '#a3b0c2',
  greyDark: '#566578',
};

export const STATUS_COLOR: Record<MatchStatus, string> = {
  CONCILIADO: C.green,
  PROBABLE: C.blue,
  REVISION: C.amber,
  DIF_VALOR: C.red,
  DIF_FECHA: C.violet,
  DUPLICADO: C.orange,
  NO_CONCILIADO: C.grey,
  IGNORADO: '#ced7e3',
};

const AXIS = { fontSize: 11, fill: '#78879b' };
const GRID = '#eef1f6';

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

function TT({
  active,
  payload,
  label,
  money = true,
  suffix = '',
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  money?: boolean;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && <div className="tt-title">{label}</div>}
      {payload.map((p, i) => (
        <div className="tt-row" key={i}>
          <span className="k">
            <i className="sw" style={{ background: p.color ?? p.fill }} />
            {p.name}
          </span>
          <span className="v">
            {money ? formatMoney(Number(p.value)) : Number(p.value).toLocaleString('es-CO') + suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legends({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Ingresos vs egresos por mes                                      */
/* ------------------------------------------------------------------ */

export function IncomeExpenseChart({ data, height = 250 }: { data: MonthlyPoint[]; height?: number }) {
  return (
    <>
      <Legends
        items={[
          { label: 'Ingresos', color: C.green },
          { label: 'Egresos', color: C.red },
          { label: 'Neto', color: C.navy },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={formatCompact} width={54} />
          <Tooltip content={<TT />} cursor={{ fill: 'rgba(42,114,212,.06)' }} />
          <Bar dataKey="ingresos" name="Ingresos" fill={C.green} radius={[3, 3, 0, 0]} maxBarSize={34} />
          <Bar dataKey="egresos" name="Egresos" fill={C.red} radius={[3, 3, 0, 0]} maxBarSize={34} />
          <Line type="monotone" dataKey="neto" name="Neto" stroke={C.navy} strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Evolución de la conciliación                                     */
/* ------------------------------------------------------------------ */

export function ReconciliationTrendChart({ data, height = 230 }: { data: MonthlyPoint[]; height?: number }) {
  const series = data.map((d) => {
    const total = d.conciliados + d.pendientes + d.noConciliados;
    return { ...d, porcentaje: total ? Math.round((d.conciliados / total) * 1000) / 10 : 0 };
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="gradConc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C.green} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
        <YAxis
          tick={AXIS}
          axisLine={false}
          tickLine={false}
          domain={[0, 100]}
          tickFormatter={(v) => v + '%'}
          width={44}
        />
        <Tooltip content={<TT money={false} suffix="%" />} />
        <Area
          type="monotone"
          dataKey="porcentaje"
          name="% conciliado"
          stroke={C.green}
          strokeWidth={2.2}
          fill="url(#gradConc)"
          dot={{ r: 3, fill: C.green }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Conciliados vs pendientes por mes                                */
/* ------------------------------------------------------------------ */

export function ReconciledVsPendingChart({ data, height = 230 }: { data: MonthlyPoint[]; height?: number }) {
  return (
    <>
      <Legends
        items={[
          { label: 'Conciliados', color: C.green },
          { label: 'Pendientes', color: C.amber },
          { label: 'No conciliados', color: C.grey },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={38} allowDecimals={false} />
          <Tooltip content={<TT money={false} />} cursor={{ fill: 'rgba(42,114,212,.06)' }} />
          <Bar dataKey="conciliados" name="Conciliados" stackId="a" fill={C.green} maxBarSize={38} />
          <Bar dataKey="pendientes" name="Pendientes" stackId="a" fill={C.amber} maxBarSize={38} />
          <Bar dataKey="noConciliados" name="No conciliados" stackId="a" fill={C.grey} radius={[3, 3, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 4 y 8. Donas                                                        */
/* ------------------------------------------------------------------ */

export function DonutChart({
  data,
  height = 224,
  money = true,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
  money?: boolean;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div style={{ position: 'relative' }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="86%"
            paddingAngle={1.5}
            stroke="#fff"
            strokeWidth={2}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip content={<TT money={money} />} />
        </PieChart>
      </ResponsiveContainer>

      {(centerValue || centerLabel) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.4px' }}>{centerValue}</div>
          <div style={{ fontSize: 10.5, color: 'var(--grey-500)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
            {centerLabel}
          </div>
        </div>
      )}

      <div className="legend" style={{ justifyContent: 'center', marginTop: 6 }}>
        {data.map((d) => (
          <span key={d.name}>
            <i style={{ background: d.color }} />
            {d.name}
            <strong className="tnum" style={{ marginLeft: 3 }}>
              {total ? formatPercent((d.value / total) * 100, 0) : '0%'}
            </strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function StatusDonut({ data, height = 224 }: { data: StatusSlice[]; height?: number }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  return (
    <DonutChart
      height={height}
      money={false}
      centerValue={total.toLocaleString('es-CO')}
      centerLabel="movimientos"
      data={data.map((d) => ({ name: d.label, value: d.count, color: STATUS_COLOR[d.status] }))}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 5-7. Barras horizontales                                            */
/* ------------------------------------------------------------------ */

function HBar({
  data,
  height,
  color,
  money = true,
}: {
  data: { name: string; value: number; sub?: string }[];
  height: number;
  color: string;
  money?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 2, right: 16, left: 4, bottom: 2 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={money ? formatCompact : undefined} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ ...AXIS, fontSize: 10.5 }}
          axisLine={false}
          tickLine={false}
          width={150}
        />
        <Tooltip content={<TT money={money} />} cursor={{ fill: 'rgba(42,114,212,.06)' }} />
        <Bar dataKey="value" name="Valor" fill={color} radius={[0, 3, 3, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const short = (s: string, n = 26) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function TopThirdPartiesChart({ data, height = 300 }: { data: ThirdPartySummary[]; height?: number }) {
  return (
    <HBar
      height={height}
      color={C.blue}
      data={data.map((t) => ({ name: short(t.name), value: Math.abs(t.neto) }))}
    />
  );
}

export function TopDifferencesChart({ data, height = 300 }: { data: ThirdPartySummary[]; height?: number }) {
  return (
    <HBar
      height={height}
      color={C.red}
      data={data.map((t) => ({ name: short(t.name), value: t.valorPendiente + t.diferencia }))}
    />
  );
}

export function AccountDifferencesChart({ data, height = 300 }: { data: AccountSummary[]; height?: number }) {
  return (
    <HBar
      height={height}
      color={C.amber}
      data={data.map((a) => ({ name: short(a.code + ' ' + a.name, 28), value: a.valorPendiente + a.diferencia }))}
    />
  );
}

/* ------------------------------------------------------------------ */
/* 9-10. Evolución de saldos                                           */
/* ------------------------------------------------------------------ */

export function BalanceChart({ data, height = 250 }: { data: BalancePoint[]; height?: number }) {
  return (
    <>
      <Legends
        items={[
          { label: 'Saldo banco (acumulado)', color: C.navy },
          { label: 'Saldo contabilidad (acumulado)', color: C.blue },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={formatCompact} width={54} />
          <Tooltip content={<TT />} />
          <Line type="monotone" dataKey="saldoBanco" name="Banco" stroke={C.navy} strokeWidth={2.2} dot={{ r: 2.5 }} />
          <Line
            type="monotone"
            dataKey="saldoContable"
            name="Contabilidad"
            stroke={C.blue}
            strokeWidth={2.2}
            strokeDasharray="5 3"
            dot={{ r: 2.5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

export function DifferenceChart({ data, height = 200 }: { data: BalancePoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="gradDiff" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.red} stopOpacity={0.3} />
            <stop offset="100%" stopColor={C.red} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={formatCompact} width={54} />
        <Tooltip content={<TT />} />
        <Area
          type="monotone"
          dataKey="diferencia"
          name="Diferencia acumulada"
          stroke={C.red}
          strokeWidth={2}
          fill="url(#gradDiff)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Mini gráfico para el detalle de un tercero                          */
/* ------------------------------------------------------------------ */

export function ThirdPartyMiniChart({
  data,
  height = 190,
}: {
  data: { label: string; debitos: number; creditos: number }[];
  height?: number;
}) {
  return (
    <>
      <Legends
        items={[
          { label: 'Débitos', color: C.blue },
          { label: 'Créditos', color: C.violet },
        ]}
      />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={formatCompact} width={54} />
          <Tooltip content={<TT />} cursor={{ fill: 'rgba(42,114,212,.06)' }} />
          <Bar dataKey="debitos" name="Débitos" fill={C.blue} radius={[3, 3, 0, 0]} maxBarSize={30} />
          <Bar dataKey="creditos" name="Créditos" fill={C.violet} radius={[3, 3, 0, 0]} maxBarSize={30} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
