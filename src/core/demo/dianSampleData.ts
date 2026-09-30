/**
 * Datos de prueba FICTICIOS para el módulo DIAN vs. auxiliar contable.
 * Reutiliza el catálogo de terceros de `sampleData.ts`. Ningún NIT, factura
 * o valor corresponde a información real.
 */

import type { RawSheet } from '../types';
import { DEMO_PARTIES } from './sampleData';

const DIAN_HEADERS = [
  'NIT EMISOR', 'RAZON SOCIAL EMISOR', 'TIPO DOCUMENTO', 'PREFIJO', 'NUMERO',
  'CUFE', 'FECHA EMISION', 'FECHA VALIDACION', 'VALOR TOTAL', 'IVA', 'ESTADO',
];

const LEDGER_HEADERS = [
  'FECHA', 'CUENTA', 'NOMBRE CUENTA', 'NIT TERCERO', 'NOMBRE TERCERO',
  'TIPO DOCUMENTO', 'NUMERO DOCUMENTO', 'DESCRIPCION', 'DEBITO', 'CREDITO',
];

function fmt(d: Date): string {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export interface DianDemoSheets {
  dian: RawSheet;
  ledger: RawSheet;
  meta: { documentos: number };
}

export function generateDianDemoSheets(): DianDemoSheets {
  const clients = DEMO_PARTIES.filter((p) => p.role === 'cliente');
  const dianRows: unknown[][] = [];
  const ledgerRows: unknown[][] = [];

  let n = 3200;
  const base = new Date(2024, 2, 1);

  clients.forEach((party, i) => {
    // 1. Coincidencia perfecta.
    {
      const date = addDays(base, i * 3);
      const amount = 1_500_000 + i * 87_300;
      n++;
      dianRows.push([party.nit.split('-')[0], party.name, 'Factura de venta', 'FE', String(n), 'cufe-demo-' + n, fmt(date), fmt(addDays(date, 0)), amount, Math.round(amount * 0.19), 'Validado']);
      ledgerRows.push([fmt(date), '413505', 'COMERCIO AL POR MAYOR', party.nit.split('-')[0], party.name, 'FV', 'FE-' + n, 'Venta de servicios de agenciamiento', 0, amount]);
    }
    // 2. Diferencia de valor (nota crédito parcial no aplicada).
    {
      const date = addDays(base, i * 3 + 1);
      const amount = 980_000 + i * 51_200;
      n++;
      dianRows.push([party.nit.split('-')[0], party.name, 'Factura de venta', 'FE', String(n), 'cufe-demo-' + n, fmt(date), fmt(date), amount, Math.round(amount * 0.19), 'Validado']);
      ledgerRows.push([fmt(date), '413505', 'COMERCIO AL POR MAYOR', party.nit.split('-')[0], party.name, 'FV', 'FE-' + n, 'Venta de servicios', 0, amount - 45_000]);
    }
    // 3. Factura DIAN sin registrar en contabilidad.
    {
      const date = addDays(base, i * 3 + 2);
      const amount = 620_000 + i * 33_000;
      n++;
      dianRows.push([party.nit.split('-')[0], party.name, 'Factura de venta', 'FE', String(n), 'cufe-demo-' + n, fmt(date), fmt(date), amount, Math.round(amount * 0.19), 'Validado']);
    }
    // 4. Registro contable sin soporte DIAN.
    {
      const date = addDays(base, i * 3 + 2);
      const amount = 410_000 + i * 20_500;
      ledgerRows.push([fmt(date), '413505', 'COMERCIO AL POR MAYOR', party.nit.split('-')[0], party.name, 'AJ', 'AJ-' + (9000 + i), 'Ajuste manual sin factura electrónica', 0, amount]);
    }
  });

  // 5. Documentos rechazados/anulados (no requieren soporte).
  const last = clients[clients.length - 1];
  n++;
  dianRows.push([last.nit.split('-')[0], last.name, 'Factura de venta', 'FE', String(n), 'cufe-demo-' + n, fmt(addDays(base, 40)), '', 300_000, 57_000, 'Rechazado']);
  n++;
  dianRows.push([last.nit.split('-')[0], last.name, 'Factura de venta', 'FE', String(n), 'cufe-demo-' + n, fmt(addDays(base, 41)), fmt(addDays(base, 41)), 150_000, 28_500, 'Anulado']);

  const dian: RawSheet = {
    fileName: 'DEMO_DIAN_Documentos_Electronicos.xlsx',
    sheetName: 'DocumentosElectronicos',
    sheetNames: ['DocumentosElectronicos'],
    headerRowIndex: 0,
    headers: DIAN_HEADERS,
    rows: dianRows,
    totalRows: dianRows.length,
  };

  const ledger: RawSheet = {
    fileName: 'DEMO_Auxiliar_Ingresos.xlsx',
    sheetName: 'LibroAuxiliar',
    sheetNames: ['LibroAuxiliar'],
    headerRowIndex: 0,
    headers: LEDGER_HEADERS,
    rows: ledgerRows,
    totalRows: ledgerRows.length,
  };

  return { dian, ledger, meta: { documentos: dianRows.length } };
}
