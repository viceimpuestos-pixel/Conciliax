/**
 * Casos reales de un extracto Bancolombia sin columna de saldo contra el
 * auxiliar de bancos (cuenta 1110): gastos bancarios agrupados, pagos PSE
 * consolidados, tasas idénticas el mismo día, centavos de redondeo y saldo
 * inicial tomado de la fila "SALDO INICIAL" del auxiliar.
 */
import { describe, it, expect } from 'vitest';
import { reconcile } from '../src/core/reconciliation/engine';
import { DEFAULT_CONFIG } from '../src/core/reconciliation/config';
import { subsetSum, affinity } from '../src/core/reconciliation/grouping';
import { computeKpis } from '../src/core/analytics/kpis';
import { buildBankDataset, buildLedgerDataset } from '../src/core/parsing/buildDataset';
import type { BankTx, LedgerTx, RawSheet } from '../src/core/types';

const d = (day: number) => new Date(2026, 8, day, 12);
let nb = 0;
let nl = 0;
function B(day: number, description: string, amount: number, reference = ''): BankTx {
  nb++;
  return {
    id: 'B' + nb, rowIndex: nb, date: d(day), valueDate: null, description, reference, document: '',
    transactionNumber: '', debit: amount < 0 ? -amount : 0, credit: amount > 0 ? amount : 0, amount,
    balance: null, thirdPartyId: '', thirdPartyName: '', raw: {},
  };
}
function L(day: number, name: string, amount: number, description = 'PAGO DE FACTURAS', nit = ''): LedgerTx {
  nl++;
  return {
    id: 'C' + nl, rowIndex: nl, date: d(day), accountCode: '11100501', accountName: '', thirdPartyId: nit,
    thirdPartyIdRaw: nit, thirdPartyName: name, documentType: '', documentNumber: 'NB-' + nl, invoiceNumber: '',
    description, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, amount, balance: null, raw: {},
  };
}

describe('cruces agrupados', () => {
  it('cruza los cargos bancarios del mes contra el asiento de gastos bancarios', () => {
    const bank = [
      B(3, 'IMPTO GOBIERNO 4X1000', -4000),
      B(10, 'COBRO IVA PAGOS AUTOMATICOS', -424.01),
      B(15, 'SERVICIO PAGO A PROVEEDORES', -2231.6),
      B(20, 'COMIS SWIFT GIRO VTA', -100441),
    ];
    const ledger = [L(30, 'BANCOLOMBIA S.A.', -107096.61, 'gastos bancarios septiembre')];
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    for (const b of bank) expect(r.bankStatus.get(b.id)).toBe('CONCILIADO');
    expect(r.ledgerStatus.get(ledger[0].id)).toBe('CONCILIADO');
    expect(new Set(r.matches.map((m) => m.groupId)).size).toBe(1);
  });

  it('cruza varios PSE contra un solo pago contable (DIAN)', () => {
    const bank = [
      B(1, 'PAGO PSE DIAN   PSE', -100_000_000),
      B(1, 'PAGO PSE DIAN   PSE', -10_000_000),
      B(1, 'PAGO PSE DIAN   PSE', -495_000),
      B(1, 'PAGO PSE INVIMA', -495_000),
    ];
    const ledger = [L(1, 'U.A.E. DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES', -110_495_000)];
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    expect(r.ledgerStatus.get(ledger[0].id)).toBe('CONCILIADO');
    // El PSE a INVIMA del mismo valor no tiene afinidad con la DIAN: queda pendiente.
    expect(r.bankStatus.get(bank[3].id)).toBe('NO_CONCILIADO');
    expect(r.bankStatus.get(bank[2].id)).toBe('CONCILIADO');
  });

  it('reconoce la sigla del tercero en el texto bancario', () => {
    expect(affinity(B(1, 'PAGO PSE DIAN PSE', -1), L(1, 'U.A.E. DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES', -1))).toBe(true);
    expect(affinity(B(1, 'PAGO PSE MINISTERIO DE COMER', -1), L(1, 'MINISTERIO DE COMERCIO INDUSTRIA Y TURISMO', -1))).toBe(true);
    expect(affinity(B(1, 'PAGO PSE INVIMA', -1), L(1, 'TERMINAL DE CONTENEDORES DE CARTAGENA', -1))).toBe(false);
  });

  it('suma de subconjuntos exacta en centavos', () => {
    expect(subsetSum([500, 300, 200, 100], 600, 0)?.sort()).toEqual([0, 3]);
    expect(subsetSum([500, 300], 900, 0)).toBeNull();
    expect(subsetSum([600], 600, 0)).toBeNull(); // un solo elemento es un cruce 1:1, no un grupo
  });
});

describe('cruces 1:1 en datos reales', () => {
  it('tasas idénticas el mismo día no quedan en revisión', () => {
    const bank = [B(1, 'PAGO PSE INVIMA', -214226, '10'), B(1, 'PAGO PSE INVIMA', -214226, '11')];
    const ledger = [
      L(1, 'INSTITUTO NACIONAL DE VIGILANCIA DE MEDICAMENTOS Y', -214226),
      L(1, 'INSTITUTO NACIONAL DE VIGILANCIA DE MEDICAMENTOS Y', -214226),
    ];
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    for (const b of bank) expect(r.bankStatus.get(b.id)).toBe('CONCILIADO');
    expect(r.duplicateBank.size).toBe(0);
  });

  it('centavos de redondeo del banco no son diferencia de valor', () => {
    const bank = [B(4, 'PAGO PSE Sociedad Portuaria', -4061213.04)];
    const ledger = [L(4, 'SOCIEDAD PORTUARIA REGIONAL DE BARRANQUILLA SA', -4061213)];
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    expect(r.bankStatus.get(bank[0].id)).toBe('CONCILIADO');
  });

  it('valor exacto con un día de desfase y candidato único se concilia', () => {
    const bank = [B(3, 'PAGO PSE CMA CGM COLOMBIA SA', -684956.4)];
    const ledger = [L(4, 'CMA CGM COLOMBIA LTDA.', -684956.4)];
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    expect(r.bankStatus.get(bank[0].id)).toBe('CONCILIADO');
  });
});

describe('saldos y diferencia explicada', () => {
  const sheet = (headers: string[], rows: unknown[][]): RawSheet => ({
    fileName: 'x.xlsx', sheetName: 'h', sheetNames: ['h'], headerRowIndex: 0, headers, rows, totalRows: rows.length,
  });

  it('lee el saldo inicial del auxiliar y calcula el neto con la naturaleza de bancos', () => {
    const s = sheet(
      ['Entidad', 'Fecha', 'Observación', 'Débitos', 'Créditos', 'Saldo'],
      [
        ['', '2026-08-31', 'SALDO INICIAL', 1000, 0, 1000],
        ['CLIENTE', '2026-09-01', 'PAGO', 500, 0, 1500],
        ['PROVEEDOR', '2026-09-02', 'PAGO', 0, 200, 1300],
      ],
    );
    const ds = buildLedgerDataset(s, { thirdPartyName: 0, date: 1, description: 2, debit: 3, credit: 4, balance: 5 });
    expect(ds.stats.openingBalance).toBe(1000);
    expect(ds.stats.net).toBe(300); // débitos − créditos en una cuenta de bancos
    expect(ds.rows).toHaveLength(2);
  });

  it('no compara el neto del extracto contra el saldo final del auxiliar', () => {
    const bank = [B(1, 'PAGO DE PROV CLIENTE', 500), B(2, 'PAGO PSE PROVEEDOR', -200), B(3, 'CHEQUE GIRADO', -50)];
    const ledger = [L(1, 'CLIENTE', 500), L(2, 'PROVEEDOR', -200), L(30, 'OTRO PROVEEDOR', -80)];
    ledger[0].balance = 1500;
    ledger[1].balance = 1300;
    ledger[2].balance = 1220;
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    const k = computeKpis(bank, ledger, r, { ledgerOpening: 1000 });
    expect(k.saldoBancoOrigen).toBe('supuesto');
    expect(k.saldoBanco).toBe(1250); // 1000 + 500 − 200 − 50
    expect(k.saldoContable).toBe(1220);
    expect(k.diferencia).toBe(30); // −50 sin registrar + 80 sin cobrar
    expect(k.diferenciaSinExplicar).toBe(0);
    expect(k.partidasBanco).toBe(1);
    expect(k.partidasContables).toBe(1);
  });

  it('usa el saldo inicial digitado por el usuario', () => {
    const bank = [B(1, 'X', 100)];
    const r = reconcile({ bank, ledger: [], config: DEFAULT_CONFIG });
    const k = computeKpis(bank, [], r, { bankOpening: 900, ledgerOpening: 1000 });
    expect(k.saldoBancoOrigen).toBe('inicial');
    expect(k.saldoBanco).toBe(1000);
  });

  it('el consecutivo del banco evita falsos duplicados en la importación', () => {
    const s = sheet(
      ['Fecha', 'Ref1', 'Concepto', 'Valor'],
      [
        ['2026-09-15', '1', 'COBRO IVA PAGOS AUTOMATICOS', -424.01],
        ['2026-09-15', '2', 'COBRO IVA PAGOS AUTOMATICOS', -424.01],
      ],
    );
    const ds = buildBankDataset(s, { date: 0, reference: 1, description: 2, amount: 3 });
    expect(ds.stats.duplicates).toBe(0);
  });
});
