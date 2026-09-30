import { describe, it, expect } from 'vitest';
import { detectMapping } from '../src/core/parsing/columnMap';
import { buildDianDataset, buildLedgerDataset } from '../src/core/parsing/buildDataset';
import { reconcileDian } from '../src/core/reconciliation/dianEngine';
import { DEFAULT_DIAN_CONFIG } from '../src/core/reconciliation/dianEngine';
import { EMPTY_DIAN_OVERRIDES, type RawSheet } from '../src/core/types';
import { calcDV } from '../src/core/normalize/nit';

function sheet(headers: string[], rows: unknown[][], fileName = 'test.xlsx'): RawSheet {
  return {
    fileName,
    sheetName: 'Hoja1',
    sheetNames: ['Hoja1'],
    headerRowIndex: 0,
    headers,
    rows,
    totalRows: rows.length,
  };
}

const DIAN_HEADERS = ['NIT EMISOR', 'RAZON SOCIAL EMISOR', 'PREFIJO', 'NUMERO FACTURA', 'FECHA EMISION', 'VALOR TOTAL', 'ESTADO'];
const LEDGER_HEADERS = ['FECHA', 'CUENTA', 'NIT TERCERO', 'NOMBRE TERCERO', 'NUMERO DOCUMENTO', 'DESCRIPCION', 'DEBITO', 'CREDITO'];
// Software de compras típico: "Documento" es el comprobante interno,
// "Numero Factura" es el folio real del proveedor/DIAN (distinto entre sí).
const LEDGER_HEADERS_COMPRAS = [
  'FECHA', 'CUENTA', 'NIT TERCERO', 'NOMBRE TERCERO', 'DOCUMENTO', 'NUMERO FACTURA', 'DESCRIPCION', 'DEBITO', 'CREDITO',
];

function buildDian(rows: unknown[][]) {
  const raw = sheet(DIAN_HEADERS, rows, 'dian.xlsx');
  const det = detectMapping(raw, 'dian');
  return { det, ds: buildDianDataset(raw, det.mapping) };
}

function buildLedger(rows: unknown[][]) {
  const raw = sheet(LEDGER_HEADERS, rows, 'auxiliar.xlsx');
  const det = detectMapping(raw, 'ledger');
  return { det, ds: buildLedgerDataset(raw, det.mapping, { ledgerSign: 'credito-ingreso' }) };
}

/** Auxiliar de compras: débito = registro del costo/gasto o la CxP. */
function buildLedgerCompras(rows: unknown[][]) {
  const raw = sheet(LEDGER_HEADERS_COMPRAS, rows, 'auxiliar_compras.xlsx');
  const det = detectMapping(raw, 'ledger');
  return { det, ds: buildLedgerDataset(raw, det.mapping, { ledgerSign: 'debito-ingreso' }) };
}

describe('detección de columnas DIAN', () => {
  it('reconoce el reporte de documentos electrónicos', () => {
    const { det } = buildDian([['900123456', 'ACME SAS', 'FE', '1001', '01/03/2024', '1190000', 'Validado']]);
    expect(det.mapping.nit).toBeGreaterThanOrEqual(0);
    expect(det.mapping.number).toBeGreaterThanOrEqual(0);
    expect(det.mapping.amount).toBeGreaterThanOrEqual(0);
    expect(det.missingRequired).toHaveLength(0);
  });
});

describe('motor de conciliación DIAN vs. auxiliar', () => {
  it('concilia un documento con match exacto de NIT + documento + valor + fecha', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE', '1001', '01/03/2024', '1190000', 'Validado'],
    ]);
    const { ds: ledger } = buildLedger([
      ['01/03/2024', '413505', '900123456', 'ACME SAS', 'FE-1001', 'Venta de servicios', '0', '1190000'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('CONCILIADO');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].reasons.some((r) => r.code === 'DOCUMENTO')).toBe(true);
  });

  it('detecta diferencia de valor cuando el documento coincide pero el monto no', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE', '1002', '02/03/2024', '1000000', 'Validado'],
    ]);
    const { ds: ledger } = buildLedger([
      ['02/03/2024', '413505', '900123456', 'ACME SAS', 'FE-1002', 'Venta de servicios', '0', '950000'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('DIF_VALOR');
  });

  it('marca como no conciliado un documento DIAN sin soporte contable', () => {
    const { ds: dian } = buildDian([
      ['900999888', 'OTRA EMPRESA SAS', 'FE', '55', '05/03/2024', '500000', 'Validado'],
    ]);
    const { ds: ledger } = buildLedger([
      ['05/03/2024', '413505', '900123456', 'ACME SAS', 'FE-1', 'Otra venta', '0', '500000'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('NO_CONCILIADO');
    expect(result.unmatchedDian).toContain(dian.rows[0].id);
  });

  it('marca como no conciliado un registro contable sin soporte DIAN (mismo tercero, sin factura que lo respalde)', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE', '1001', '01/03/2024', '1190000', 'Validado'],
    ]);
    const { ds: ledger } = buildLedger([
      ['01/03/2024', '413505', '900123456', 'ACME SAS', 'FE-1001', 'Venta de servicios', '0', '1190000'],
      // Mismo tercero (sí reporta a la DIAN), pero este ajuste puntual no
      // corresponde a ninguna factura electrónica: sigue siendo "sin soporte".
      ['02/03/2024', '413505', '900123456', 'ACME SAS', 'AJ-99', 'Ajuste manual', '0', '300000'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    const unmatched = ledger.rows.find((l) => l.documentNumber === 'AJ-99')!;
    expect(result.ledgerStatus.get(unmatched.id)).toBe('NO_CONCILIADO');
  });

  it('no exige soporte contable para documentos rechazados o anulados', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE', '2000', '10/03/2024', '800000', 'Rechazado'],
      ['900123456', 'ACME SAS', 'FE', '2001', '11/03/2024', '400000', 'Anulado'],
    ]);
    const { ds: ledger } = buildLedger([]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('NO_VALIDO');
    expect(result.dianStatus.get(dian.rows[1].id)).toBe('NO_VALIDO');
    expect(result.unmatchedDian).toHaveLength(0);
  });

  it('respeta los vínculos manuales aunque el número de documento no coincida', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE', '3001', '15/03/2024', '250000', 'Validado'],
    ]);
    const { ds: ledger } = buildLedger([
      ['15/03/2024', '413505', '900123456', 'ACME SAS', 'DIFERENTE-1', 'Venta varios', '0', '250000'],
    ]);

    const result = reconcileDian({
      dian: dian.rows,
      ledger: ledger.rows,
      config: DEFAULT_DIAN_CONFIG,
      overrides: { ...EMPTY_DIAN_OVERRIDES, manualLinks: [{ dianId: dian.rows[0].id, ledgerId: ledger.rows[0].id }] },
    });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('CONCILIADO');
    expect(result.matches[0].origin).toBe('manual');
  });

  it('encuentra el número de documento dentro de la descripción contable', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE', '4077', '20/03/2024', '600000', 'Validado'],
    ]);
    const { ds: ledger } = buildLedger([
      ['20/03/2024', '413505', '900123456', 'ACME SAS', '', 'Pago factura electronica 4077 ACME', '0', '600000'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    // Señal más débil (número hallado en texto libre, no en un campo dedicado):
    // se cruza pero queda como coincidencia probable, no conciliado automático.
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('PROBABLE');
  });
});

describe('casos reales de auxiliares de compras', () => {
  it('concilia aunque el auxiliar traiga el NIT con el dígito de verificación pegado', () => {
    const base = '800242106';
    const dv = calcDV(base);
    const { ds: dian } = buildDian([
      [base, 'SODIMAC COLOMBIA S.A.', 'FE83', '45567', '02/03/2024', '496500', 'Validado'],
    ]);
    const { ds: ledger } = buildLedgerCompras([
      ['02/03/2024', '220501', base + dv, 'SODIMAC COLOMBIA S.A.', 'FC-345490-0', 'FE8345567', 'Compra de materiales', '0', '496500'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('CONCILIADO');
  });

  it('prefiere "Numero Factura" sobre "Documento" cuando ambos existen', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE83', '45567', '02/03/2024', '496500', 'Validado'],
    ]);
    const { ds: ledger } = buildLedgerCompras([
      // El comprobante interno "FC-345490-0" no tiene relación con el folio DIAN;
      // sólo "Numero Factura" (FE8345567) sí coincide.
      ['02/03/2024', '220501', '900123456', 'ACME SAS', 'FC-345490-0', 'FE8345567', 'Compra', '0', '496500'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('CONCILIADO');
    const match = result.byDian.get(dian.rows[0].id)!;
    expect(match.reasons.some((r) => r.code === 'DOCUMENTO')).toBe(true);
  });

  it('no marca como ambiguas las dos líneas espejo (débito/crédito) de una misma factura', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE83', '45567', '02/03/2024', '496500', 'Validado'],
    ]);
    const { ds: ledger } = buildLedgerCompras([
      ['02/03/2024', '51950501', '900123456', 'ACME SAS', 'FC-345490-0', 'FE8345567', 'Compra', '496500', '0'],
      ['02/03/2024', '22050501', '900123456', 'ACME SAS', 'FC-345490-0', 'FE8345567', 'Compra', '0', '496500'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('CONCILIADO');
    // La línea que no recibió el cruce 1:1 formal hereda el mismo estado:
    // ambas comparten el mismo soporte, ninguna debe verse como "sin soporte".
    const statuses = ledger.rows.map((l) => result.ledgerStatus.get(l.id));
    expect(statuses).toEqual(['CONCILIADO', 'CONCILIADO']);
  });

  it('marca "fuera de alcance" un registro contable de un tercero que nunca reporta a la DIAN', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE83', '45567', '02/03/2024', '496500', 'Validado'],
    ]);
    const { ds: ledger } = buildLedgerCompras([
      ['02/03/2024', '220501', '900123456', 'ACME SAS', 'FC-345490-0', 'FE8345567', 'Compra', '0', '496500'],
      // Nómina de un empleado: no tiene nada que ver con facturación electrónica.
      ['02/03/2024', '250501', '1012345678', 'EMPLEADO X', 'NM-001', '', 'Pago de nómina', '0', '2500000'],
    ]);

    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    const payroll = ledger.rows.find((l) => l.documentNumber === 'NM-001')!;
    expect(result.ledgerStatus.get(payroll.id)).toBe('FUERA_DE_ALCANCE');
    expect(result.unmatchedLedger).not.toContain(payroll.id);
  });

  it('no clasifica como diferencia de valor un cruce exacto cuyo lado contable quedó en negativo', () => {
    const { ds: dian } = buildDian([
      ['900123456', 'ACME SAS', 'FE83', '45567', '02/03/2024', '496500', 'Validado'],
    ]);
    // Convención débito=ingreso: una línea de crédito puro da amount negativo.
    const { ds: ledger } = buildLedgerCompras([
      ['02/03/2024', '220501', '900123456', 'ACME SAS', 'FC-345490-0', 'FE8345567', 'Compra', '0', '496500'],
    ]);

    expect(ledger.rows[0].amount).toBe(-496500);
    const result = reconcileDian({ dian: dian.rows, ledger: ledger.rows, config: DEFAULT_DIAN_CONFIG });
    expect(result.dianStatus.get(dian.rows[0].id)).toBe('CONCILIADO');
  });
});
