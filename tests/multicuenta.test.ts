/**
 * Extractos PDF de varios bancos, auxiliar con varias cuentas, gastos
 * bancarios con G.M.F y reintegros, PSE reversados y embargos.
 * Los casos replican filas reales de Occidente, Agrario y Serfinanzas.
 */
import { describe, it, expect } from 'vitest';
import { parseStatementLines, findAccountNumber } from '../src/core/parsing/pdfStatement';
import { buildLedgerDataset, filterLedgerByAccount, guessLedgerAccount } from '../src/core/parsing/buildDataset';
import { reconcile } from '../src/core/reconciliation/engine';
import { DEFAULT_CONFIG } from '../src/core/reconciliation/config';
import { computeKpis } from '../src/core/analytics/kpis';
import { buildStatement } from '../src/core/analytics/statement';
import { buildAlerts } from '../src/core/analytics/alerts';
import type { BankTx, LedgerTx, RawSheet } from '../src/core/types';

describe('lector de extractos PDF por filas', () => {
  it('Banco de Occidente: día sin mes, columnas débito/crédito, membrete en la misma línea', () => {
    const lines = [
      ['BANCO DE OCCIDENTE S.A.'],
      ['Extracto - CUENTA CORRIENTE'],
      ['CUENTA No. 830-08042-0'],
      ['FECHA DE CORTE: 30/09/2026'],
      ['SALDO ANTERIOR', '4,169,401.24'],
      ['DIA', 'TRANSACCIÓN', 'IDENT.', 'DEBITOS', 'CREDITOS', 'SALDO'],
      ['01', 'TRANS DESDE BOGOTA POR INTERNET', '0.00', '40,956,000.00', '45,125,401.24'],
      ['01', 'CUOTA ADMINISTRACION OCCICUENTA OCCIRED', 'A697894', '94,500.00', '0.00', '45,030,901.24'],
      ['BANCO DE OCCIDENTE S.A.', '02', 'PAGO TERCERO RECIBIDO DESDE ACH', 'A652638', '0.00', '15,224,896.00', '60,255,797.24'],
      ['SALDO ACTUAL', '60,255,797.24'],
    ];
    const st = parseStatementLines(lines)!;
    expect(st).not.toBeNull();
    expect(st.bank).toBe('Banco de Occidente');
    expect(st.accountNumber).toBe('830080420');
    expect(st.openingBalance).toBe(4169401.24);
    expect(st.rows).toHaveLength(3);
    expect(st.rows[0]).toMatchObject({ date: '2026-09-01', credit: 40956000, debit: 0 });
    expect(st.rows[1]).toMatchObject({ debit: 94500, reference: 'A697894' });
    expect(st.rows[2]).toMatchObject({ date: '2026-09-02', credit: 15224896 });
    expect(st.lastBalance).toBe(st.closingBalance);
  });

  it('Banco Agrario: formato colombiano con signo y sin encabezados de columna', () => {
    const lines = [
      ['ESTADO DE', 'CUENTAS DE AHORRO'],
      ['www.bancoagrario.gov.co'],
      ['SEPTIEMBRE', '2026'],
      ['412070184326'],
      ['SALDO ANTERIOR', '10.264,51', 'SALDO ACTUAL', '0,00'],
      ['01/09', 'CAT AUT DESEMBOLSO DE CARTERA', 'CARTAGENA SUCUR', '144.000.000,00', '144.010.264,51'],
      ['07/09', 'ND COMPRA POR PSE INTERNET', 'INTERNET BANCA', '-4.663.000,00', '139.347.264,51'],
      ['07/09', 'GRAVAMEN A MOVIMIENTO FINANCIERO', 'INTERNET BANCA', '-18.652,00', '139.328.612,51'],
    ];
    const st = parseStatementLines(lines)!;
    expect(st.bank).toBe('Banco Agrario');
    expect(st.openingBalance).toBe(10264.51);
    expect(st.rows.map((r) => [r.date, r.debit, r.credit])).toEqual([
      ['2026-09-01', 0, 144000000],
      ['2026-09-07', 4663000, 0],
      ['2026-09-07', 18652, 0],
    ]);
  });

  it('Serfinanzas: ignora el código de pie de página pegado a la fila', () => {
    const lines = [
      ['DESDE: 31/08/2026 HASTA: 30/09/2026'],
      ['Número de cuenta: 221000040110'],
      ['Saldo Anterior:', '248,733,409.55'],
      ['24/09/2026', 'G.M.F DEBITO BANCARIO', 'DIRECCION GENERAL', '-40,699.00', '248,692,710.55'],
      ['24/09/2026', 'DEBITO A CUENTA PAGO PSE', 'DIRECCION GENERAL', '-2,893,885.00', '245,798,825.55', '29/06/2021_ 37725'],
      ['24/09/2026', 'G.M.F DEBITO BANCARIO', 'DIRECCION GENERAL', '-11,576.00', '245,787,249.55'],
    ];
    const st = parseStatementLines(lines)!;
    expect(st.accountNumber).toBe('221000040110');
    expect(st.rows).toHaveLength(3);
    expect(st.rows[1].debit).toBe(2893885);
  });

  it('separa dos movimientos que el PDF dejó en la misma línea', () => {
    const lines = [
      ['FECHA DE CORTE: 30/09/2026'],
      ['SALDO ANTERIOR', '100.00'],
      ['01', 'A', '10.00', '0.00', '90.00', '01', 'B', '0.00', '20.00', '110.00'],
      ['02', 'C', '5.00', '0.00', '105.00'],
    ];
    const st = parseStatementLines(lines)!;
    expect(st.rows.map((r) => r.description)).toEqual(['A', 'B', 'C']);
  });

  it('se declara no confiable si los saldos no cuadran', () => {
    const lines = [
      ['SALDO ANTERIOR', '100.00'],
      ['01/09/2026', 'A', '-10.00', '50.00'],
      ['02/09/2026', 'B', '-10.00', '20.00'],
      ['03/09/2026', 'C', '-10.00', '1.00'],
    ];
    expect(parseStatementLines(lines)).toBeNull();
  });

  it('encuentra el número de cuenta en distintos membretes', () => {
    expect(findAccountNumber('CUENTA No. 830-08042-0')).toBe('830080420');
    expect(findAccountNumber('Número de cuenta: 221000040110')).toBe('221000040110');
    expect(findAccountNumber('Cuenta 085-069261-15 Bancolombia')).toBe('08506926115');
  });
});

/* ------------------------------------------------------------------ */

const sheet = (rows: unknown[][]): RawSheet => ({
  fileName: 'aux.xlsx', sheetName: 'h', sheetNames: ['h'], headerRowIndex: 0,
  headers: ['Entidad', 'Cuenta PUC', 'Fecha', 'Observación', 'Débitos', 'Créditos', 'Saldo'], rows, totalRows: rows.length,
});
const MAP = { thirdPartyName: 0, accountCode: 1, date: 2, description: 3, debit: 4, credit: 5, balance: 6 };
const AUX = sheet([
  ['11100501  BANCOLOMBIA CG CTACTE #085-069261-15', '', '', '', '', '', ''],
  ['', '11100501', '2026-08-31', 'SALDO INICIAL', 1000, 0, 1000],
  ['CLIENTE A', '11100501', '2026-09-02', 'PAGO', 500, 0, 1500],
  ['Total Movimientos Débito y Crédito', '', '', '', 1500, 0, ''],
  ['11100506  BANCO DE OCCIDENTE CG CTA# 830080420', '', '', '', '', '', ''],
  ['', '11100506', '2026-08-31', 'SALDO INICIAL', 200, 0, 200],
  ['PROVEEDOR B', '11100506', '2026-09-03', 'PAGO', 0, 50, 150],
  ['11100519  BANCO SERFINANZAS', '', '', '', '', '', ''],
  ['', '11100519', '2026-08-31', 'SALDO INICIAL', 30, 0, 30],
  ['PROVEEDOR C', '11100519', '2026-09-04', 'PAGO', 0, 10, 20],
]);

describe('auxiliar con varias cuentas', () => {
  const ds = buildLedgerDataset(AUX, MAP);

  it('lista las cuentas con nombre y saldo inicial propios', () => {
    expect(ds.accounts!.map((a) => [a.code, a.name, a.movements, a.openingBalance])).toEqual([
      ['11100501', 'BANCOLOMBIA CG CTACTE #085-069261-15', 1, 1000],
      ['11100506', 'BANCO DE OCCIDENTE CG CTA# 830080420', 1, 200],
      ['11100519', 'BANCO SERFINANZAS', 1, 30],
    ]);
  });

  it('identifica la cuenta por el número del extracto o por el banco', () => {
    const acc = ds.accounts!;
    expect(guessLedgerAccount(acc, { accountNumber: '830080420' })).toBe('11100506');
    expect(guessLedgerAccount(acc, { accountNumber: '085-069261-15' })).toBe('11100501');
    expect(guessLedgerAccount(acc, { accountNumber: '221000040110', bankName: 'Banco Serfinanzas' })).toBe('11100519');
    expect(guessLedgerAccount(acc, { accountNumber: '999999999' })).toBeNull();
  });

  it('filtra filas, estadísticas y saldo inicial de la cuenta elegida', () => {
    const occ = filterLedgerByAccount(ds, '11100506');
    expect(occ.rows).toHaveLength(1);
    expect(occ.stats.openingBalance).toBe(200);
    expect(occ.stats.net).toBe(-50);
    expect(filterLedgerByAccount(ds, null).rows).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */

const d = (day: number) => new Date(2026, 8, day, 12);
let n = 0;
function B(day: number, description: string, amount: number, balance: number | null = null): BankTx {
  n++;
  return { id: 'B' + n, rowIndex: n, date: d(day), valueDate: null, description, reference: '', document: '', transactionNumber: '',
    debit: amount < 0 ? -amount : 0, credit: amount > 0 ? amount : 0, amount, balance, thirdPartyId: '', thirdPartyName: '', raw: {} };
}
function L(day: number, name: string, amount: number, description = 'PAGO'): LedgerTx {
  n++;
  return { id: 'C' + n, rowIndex: n, date: d(day), accountCode: '11100519', accountName: '', thirdPartyId: '', thirdPartyIdRaw: '',
    thirdPartyName: name, documentType: '', documentNumber: 'NB-' + n, invoiceNumber: '', description,
    debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, amount, balance: null, raw: {} };
}

describe('gastos bancarios, reversos y embargos', () => {
  it('cruza G.M.F y su reintegro contra el asiento de gastos aunque absorba unos pesos', () => {
    const bank = [
      B(22, 'G.M.F DEBITO BANCARIO', -52287),
      B(24, 'G.M.F DEBITO BANCARIO', -40699),
      B(30, 'REINTEGRO GMF CUENTAS CORRIENTES', 84254),
      B(1, 'CUOTA ADMINISTRACION OCCICUENTA OCCIRED', -94500),
    ];
    const ledger = [L(30, 'SERVICIOS FINANCIEROS S.A SERFINANZA CIA', -103237, 'GASTOS BANCARIOS')];
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    for (const b of bank) expect(r.byBank.has(b.id)).toBe(true);
    const diffs = r.matches.filter((m) => m.amountDiff !== 0);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].amountDiff).toBe(5); // -103232 banco vs -103237 libros
    expect(r.matches.filter((m) => m.status !== 'CONCILIADO')).toHaveLength(1);
  });

  it('un PSE rechazado y su reintegro se anulan sin pedir registro contable', () => {
    const bank = [B(28, 'DEBITO A CUENTA PAGO PSE', -21063450), B(30, 'REINTEGRO TRANSACCIONES PSE', 21063450)];
    const r = reconcile({ bank, ledger: [], config: DEFAULT_CONFIG });
    expect(r.bankStatus.get(bank[0].id)).toBe('CONCILIADO');
    expect(r.bankStatus.get(bank[1].id)).toBe('CONCILIADO');
    const k = computeKpis(bank, [], r, { bankOpening: 0, ledgerOpening: 0 });
    expect(k.partidasBanco).toBe(0);
  });

  it('alerta de embargo aunque esté registrado en libros', () => {
    const bank = [B(14, 'EMBARGOS', -1130385)];
    const ledger = [L(29, 'BANCO DE OCCIDENTE S.A.', -1130385)];
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    const al = buildAlerts(bank, ledger, r, []);
    const emb = al.filter((a) => a.kind === 'EMBARGO');
    expect(emb).toHaveLength(1);
    expect(emb[0].severity).toBe('critica');
    expect(emb[0].detail).toContain('BANCO DE OCCIDENTE');
  });

  it('la diferencia de saldo inicial queda explicada (caso Agrario)', () => {
    // Banco arranca en 10.264,51 y libros en 0,51; libros lo corrigen con un ajuste.
    const bank = [B(1, 'CAT AUT DESEMBOLSO DE CARTERA', 100, 10364.51), B(10, 'ND-EMBARGOS DIRGENERAL', -10364.51, 0)];
    const ledger = [L(1, 'BANCO AGRARIO', 100), L(29, 'BANCO AGRARIO', -10364.51), L(30, 'AJUSTE', 10264)];
    ledger[0].balance = 100.51;
    ledger[1].balance = -10264;
    ledger[2].balance = 0;
    const r = reconcile({ bank, ledger, config: DEFAULT_CONFIG });
    const k = computeKpis(bank, ledger, r, { bankOpening: 10264.51, ledgerOpening: 0.51 });
    expect(k.saldoBanco).toBe(0);
    expect(k.saldoContable).toBe(0);
    expect(k.diferenciaSaldoInicial).toBe(10264);
    expect(k.diferenciaSinExplicar).toBe(0);
    const st = buildStatement(bank, ledger, r, k);
    expect(st.sections.find((s) => s.id === 'saldoInicial')!.total).toBe(10264);
    expect(st.sinExplicar).toBe(0);
  });
});
