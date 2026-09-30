/**
 * Enrutado simple por sección (sin router externo: la aplicación es de una sola vista).
 */

import React from 'react';
import { useStore } from './state/store';
import { useHasData } from './state/selectors';
import { Shell } from './ui/components/Shell';
import { DashboardPage } from './ui/pages/DashboardPage';
import { ImportPage } from './ui/pages/ImportPage';
import { ReconciliationPage } from './ui/pages/ReconciliationPage';
import { ThirdPartiesPage } from './ui/pages/ThirdPartiesPage';
import { AccountingPage } from './ui/pages/AccountingPage';
import { AlertsPage } from './ui/pages/AlertsPage';
import { ReportsPage } from './ui/pages/ReportsPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { DianPage } from './ui/pages/DianPage';

export function App() {
  const section = useStore((s) => s.section);
  const hasData = useHasData();

  // Las secciones analíticas del módulo banco requieren su propia conciliación ejecutada.
  const needsData = section !== 'importar' && section !== 'configuracion' && section !== 'dian';
  const view = needsData && !hasData ? 'importar' : section;

  switch (view) {
    case 'dashboard':
      return <Shell><DashboardPage /></Shell>;
    case 'conciliacion':
      return <Shell><ReconciliationPage /></Shell>;
    case 'terceros':
      return <Shell><ThirdPartiesPage /></Shell>;
    case 'contable':
      return <Shell><AccountingPage /></Shell>;
    case 'alertas':
      return <Shell><AlertsPage /></Shell>;
    case 'reportes':
      return <Shell><ReportsPage /></Shell>;
    case 'dian':
      return <Shell><DianPage /></Shell>;
    case 'configuracion':
      return <Shell><SettingsPage /></Shell>;
    default:
      return <Shell><ImportPage /></Shell>;
  }
}
