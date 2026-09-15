/**
 * Marco de la aplicación: barra lateral, barra superior y buscador global.
 */

import React, { useState, type ReactNode } from 'react';
import { useStore, type Section } from '../../state/store';
import { useAlerts, useHasData, useKpis } from '../../state/selectors';
import {
  IconAlert,
  IconBell,
  IconBook,
  IconDashboard,
  IconFile,
  IconLink,
  IconMenu,
  IconSearch,
  IconSettings,
  IconShield,
  IconUpload,
  IconUsers,
  IconX,
  Tooltip,
} from './primitives';

interface NavEntry {
  id: Section;
  label: string;
  icon: ReactNode;
  group: string;
  needsData?: boolean;
}

const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <IconDashboard />, group: 'Análisis', needsData: true },
  { id: 'conciliacion', label: 'Conciliación', icon: <IconLink />, group: 'Análisis', needsData: true },
  { id: 'alertas', label: 'Alertas', icon: <IconBell />, group: 'Análisis', needsData: true },
  { id: 'terceros', label: 'Terceros', icon: <IconUsers />, group: 'Detalle', needsData: true },
  { id: 'contable', label: 'Análisis contable', icon: <IconBook />, group: 'Detalle', needsData: true },
  { id: 'importar', label: 'Importar archivos', icon: <IconUpload />, group: 'Datos' },
  { id: 'reportes', label: 'Reportes', icon: <IconFile />, group: 'Datos', needsData: true },
  { id: 'configuracion', label: 'Configuración', icon: <IconSettings />, group: 'Datos' },
];

const TITLES: Record<Section, { title: string; crumb: string }> = {
  dashboard: { title: 'Dashboard ejecutivo', crumb: 'Análisis / Resumen general' },
  conciliacion: { title: 'Conciliación de movimientos', crumb: 'Análisis / Cruce banco ↔ contabilidad' },
  alertas: { title: 'Panel de alertas', crumb: 'Análisis / Puntos de atención' },
  terceros: { title: 'Análisis por tercero', crumb: 'Detalle / Terceros' },
  contable: { title: 'Análisis contable', crumb: 'Detalle / Cuentas y grupos' },
  importar: { title: 'Importación de archivos', crumb: 'Datos / Extracto y auxiliar' },
  reportes: { title: 'Reportes y exportación', crumb: 'Datos / Informes' },
  configuracion: { title: 'Configuración del algoritmo', crumb: 'Datos / Motor de conciliación' },
};

export function Shell({ children }: { children: ReactNode }) {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const progress = useStore((s) => s.progress);
  const hasData = useHasData();
  const alerts = useAlerts();
  const kpis = useKpis();
  const [collapsed, setCollapsed] = useState(false);

  const criticas = alerts.filter((a) => a.severity === 'critica').length;
  const groups = [...new Set(NAV.map((n) => n.group))];

  const badgeFor = (id: Section): { text: string; alert?: boolean } | null => {
    if (!hasData) return null;
    if (id === 'alertas' && alerts.length) return { text: String(alerts.length), alert: criticas > 0 };
    if (id === 'conciliacion') {
      const pend = kpis.probables + kpis.pendientes + kpis.difValor + kpis.difFecha;
      return pend ? { text: String(pend) } : null;
    }
    return null;
  };

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">CX</div>
          <div className="brand-text">
            <strong>Conciliax</strong>
            <span>Conciliación bancaria</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((g) => (
            <div key={g}>
              <div className="nav-group-label">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => {
                const disabled = Boolean(n.needsData) && !hasData;
                const badge = badgeFor(n.id);
                return (
                  <button
                    key={n.id}
                    className={'nav-item' + (section === n.id ? ' active' : '')}
                    onClick={() => !disabled && setSection(n.id)}
                    disabled={disabled}
                    style={disabled ? { opacity: 0.42, cursor: 'not-allowed' } : undefined}
                    title={disabled ? 'Primero importe los archivos' : n.label}
                  >
                    <span className="nav-icon">{n.icon}</span>
                    <span className="nav-label">{n.label}</span>
                    {badge && <span className={'nav-badge' + (badge.alert ? ' alert' : '')}>{badge.text}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-text">
            <div className="row" style={{ gap: 6, marginBottom: 4 }}>
              <IconShield size={13} />
              <strong style={{ color: '#a9bdd8' }}>Procesamiento local</strong>
            </div>
            Sus archivos se analizan en este navegador. No se envía información a ningún servidor.
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setCollapsed((v) => !v)} aria-label="Menú">
            <IconMenu />
          </button>

          <div>
            <h1>{TITLES[section].title}</h1>
            <div className="crumb">{TITLES[section].crumb}</div>
          </div>

          {hasData && (
            <div className="global-search">
              <span className="search-icon">
                <IconSearch size={15} />
              </span>
              <input
                placeholder="Buscar en todos los movimientos…"
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && section !== 'conciliacion') setSection('conciliacion');
                }}
              />
              {filters.search && (
                <button className="icon-btn clear" onClick={() => setFilter('search', '')} aria-label="Limpiar">
                  <IconX size={14} />
                </button>
              )}
            </div>
          )}

          {hasData && criticas > 0 && (
            <Tooltip content={criticas + ' alerta(s) crítica(s) requieren su atención'} align="right">
              <button className="icon-btn" onClick={() => setSection('alertas')} style={{ color: 'var(--red-600)' }}>
                <IconAlert size={17} />
              </button>
            </Tooltip>
          )}
        </header>

        <main className="content">{children}</main>
      </div>

      {progress?.running && (
        <div className="overlay">
          <div className="box">
            <div className="spinner" />
            <h3>{progress.label}</h3>
            <p>
              Paso {progress.step} de {progress.total}
            </p>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: (progress.step / progress.total) * 100 + '%' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
