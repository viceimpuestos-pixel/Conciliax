/**
 * Consolidado: varios extractos contra un auxiliar con varias cuentas.
 */
import { describe, it, expect } from 'vitest';
import { reconcileAll } from '../src/core/analytics/consolidated';
import { DEFAULT_CONFIG } from '../src/core/reconciliation/config';
import type { LoadedFile } from '../src/core/parsing/loadFile';
import type { RawSheet } from '../src/core/types';

const ledgerSheet: RawSheet = {
  fileName: 'aux.xlsx', sheetName: 'h', sheetNames: ['h'], headerRowIndex: 0,
  headers: ['Entidad', 'Cuenta PUC', 'Fecha', 'Observación', 'Débitos', 'Créditos', 'Saldo'],
  rows: [
    ['11100501  BANCOLOMBIA CG CTACTE #085-069261-15', '', '', '', '', '', ''],
    ['', '11100501', '2026-08-31', 'SALDO INICIAL', 1000, 0, 1000],
    ['CLIENTE A', '11100501', '2026-09-02', 'RECAUDO', 500, 0, 1500],
    ['BANCOLOMBIA S.A.', '11100501', '2026-09-30', 'PAGO', 0, 300, 1200],
    ['11100506  BANCO DE OCCIDENTE CG CTA# 830080420', '', '', '', '', '', ''],
    ['', '11100506', '2026-08-31', 'SALDO INICIAL', 2000, 0, 2000],
    ['PROVEEDOR B', '11100506', '2026-09-03', 'PAGO PROVEEDOR', 0, 400, 1600],
    ['11100512  DAVIVIENDA CTA.CTE.56169998012', '', '', '', '', '', ''],
    ['', '11100512', '2026-08-31', 'SALDO INICIAL', 50, 0, 50],
    ['PROVEEDOR C', '11100512', '2026-09-05', 'PAGO', 0, 10, 40],
  ],
  totalRows: 10,
};
const ledgerMapping = { thirdPartyName: 0, accountCode: 1, date: 2, description: 3, debit: 4, credit: 5, balance: 6 };

function statement(fileName: string, rows: unknown[][]): LoadedFile {
  return {
    format: 'excel',
    buffer: new ArrayBuffer(0),
    warnings: [],
    sheet: {
      fileName, sheetName: 'h', sheetNames: ['h'], headerRowIndex: 0,
      headers: ['Fecha', 'Descripción', 'Cuenta', 'Débito', 'Crédito', 'Saldo'], rows, totalRows: rows.length,
    },
  };
}

describe('conciliación consolidada', () => {
  it('asigna cada extracto, concilia por cuenta y encuentra hallazgos entre bancos', async () => {
    const bancolombia = statement('E8506926115_202609.xlsx', [
      ['', 'SALDO INICIAL', '', '', '', 1000],
      ['2026-09-02', 'CONSIGNACION CLIENTE A', '085-069261-15', 0, 500, 1500],
      ['2026-09-09', 'DEBITO POR EMBARGO', '085-069261-15', 300, 0, 1200],
    ]);
    const occidente = statement('occidente_830-080420.xlsx', [
      ['', 'SALDO INICIAL', '', '', '', 2000],
      ['2026-09-03', 'PAGO PROVEEDOR B', '', 400, 0, 1600],
      ['2026-09-14', 'EMBARGOS', '', 300, 0, 1300],
    ]);
    const res = await reconcileAll({
      ledgerSheet,
      ledgerMapping,
      buildOptions: {},
      config: DEFAULT_CONFIG,
      statements: [
        { id: 's1', fileName: 'bancolombia.xlsx', file: bancolombia, accountChoice: 'auto' },
        { id: 's2', fileName: 'occidente.xlsx', file: occidente, accountChoice: 'auto' },
      ],
    });

    const byCode = Object.fromEntries(res.rows.map((r) => [r.accountCode, r]));
    expect(byCode['11100501'].statementId).toBe('s1');
    expect(byCode['11100501'].state).toBe('cuadra');
    expect(byCode['11100506'].statementId).toBe('s2');
    expect(byCode['11100506'].state).toBe('explicada'); // embargo de 300 sin registrar
    expect(byCode['11100506'].diferencia).toBe(-300);
    expect(byCode['11100506'].sinExplicar).toBe(0);
    expect(byCode['11100512'].state).toBe('sin_extracto');
    expect(byCode['11100512'].saldoLibros).toBe(40);

    const titles = res.findings.map((f) => f.title);
    expect(titles[0]).toBe('Posible embargo cobrado dos veces');
    expect(titles).toContain('Cuenta sin extracto');
    expect(titles.filter((t) => t === 'Embargo')).toHaveLength(2);
    expect(res.totals.sinExplicar).toBe(0);
  });

  it('un extracto sin movimientos no se asigna y lo explica', async () => {
    const fiducia = statement('fiducia.pdf', [['', 'NO EXISTEN MOVIMIENTOS', '', '', '', '']]);
    const res = await reconcileAll({
      ledgerSheet, ledgerMapping, buildOptions: {}, config: DEFAULT_CONFIG,
      statements: [{ id: 'f', fileName: 'fiducia.pdf', file: fiducia, accountChoice: 'auto' }],
    });
    expect(res.unassigned).toHaveLength(1);
    expect(res.unassigned[0].reason).toMatch(/sin movimientos/);
  });
});
