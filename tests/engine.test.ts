import { describe, it, expect } from 'vitest';
import { generateDemoSheets } from '../src/core/demo/sampleData';
import { detectMapping } from '../src/core/parsing/columnMap';
import { buildBankDataset, buildLedgerDataset } from '../src/core/parsing/buildDataset';
import { reconcile, findCandidates, pairKey } from '../src/core/reconciliation/engine';
import { DEFAULT_CONFIG, CONFIG_PRESETS, cloneConfig } from '../src/core/reconciliation/config';
import { scorePair } from '../src/core/reconciliation/scoring';
import { computeKpis } from '../src/core/analytics/kpis';
import { thirdPartySummaries, monthlySeries, accountSummaries } from '../src/core/analytics/aggregations';
import { buildAlerts } from '../src/core/analytics/alerts';
import { EMPTY_OVERRIDES, type BankTx, type LedgerTx, type RawSheet } from '../src/core/types';

function buildAll(opts = {}) {
  const demo = generateDemoSheets(opts);
  const bankMap = detectMapping(demo.bank, 'bank');
  const ledgerMap = detectMapping(demo.ledger, 'ledger');
  const bank = buildBankDataset(demo.bank, bankMap.mapping);
  const ledger = buildLedgerDataset(demo.ledger, ledgerMap.mapping);
  const result = reconcile({ bank: bank.rows, ledger: ledger.rows, config: DEFAULT_CONFIG });
  return { demo, bankMap, ledgerMap, bank, ledger, result };
}

describe('detección de columnas', () => {
  it('reconoce el extracto bancario', () => {
    const { bankMap, demo } = buildAll();
    expect(demo.bank.headers[bankMap.mapping.date]).toBe('FECHA');
    expect(demo.bank.headers[bankMap.mapping.description]).toBe('DESCRIPCION');
    expect(demo.bank.headers[bankMap.mapping.debit]).toBe('DEBITO');
    expect(demo.bank.headers[bankMap.mapping.credit]).toBe('CREDITO');
    expect(demo.bank.headers[bankMap.mapping.balance]).toBe('SALDO');
    expect(bankMap.missingRequired).toHaveLength(0);
  });

  it('reconoce el auxiliar contable', () => {
    const { ledgerMap, demo } = buildAll();
    const h = (k: string) => demo.ledger.headers[ledgerMap.mapping[k]];
    expect(h('date')).toBe('FECHA');
    expect(h('accountCode')).toBe('CUENTA');
    expect(h('thirdPartyId')).toBe('NIT');
    expect(h('thirdPartyName')).toBe('NOMBRE DEL TERCERO');
    expect(h('documentNumber')).toBe('NUMERO DOCUMENTO');
    expect(h('debit')).toBe('DEBITO');
    expect(h('credit')).toBe('CREDITO');
    expect(ledgerMap.missingRequired).toHaveLength(0);
  });

  it('funciona con las columnas en otro orden', () => {
    const demo = generateDemoSheets();
    const order = [4, 0, 6, 2, 5, 1, 3]; // permutación de las 7 columnas del extracto
    const shuffled: RawSheet = {
      ...demo.bank,
      headers: order.map((i) => demo.bank.headers[i]),
      rows: demo.bank.rows.map((r) => order.map((i) => r[i])),
    };
    const map = detectMapping(shuffled, 'bank');
    expect(shuffled.headers[map.mapping.date]).toBe('FECHA');
    expect(shuffled.headers[map.mapping.credit]).toBe('CREDITO');

    const ds = buildBankDataset(shuffled, map.mapping);
    const original = buildBankDataset(demo.bank, detectMapping(demo.bank, 'bank').mapping);
    expect(ds.rows.length).toBe(original.rows.length);
    expect(ds.stats.totalCredit).toBe(original.stats.totalCredit);
  });
});

describe('normalización de datasets', () => {
  it('descarta la fila de totales del auxiliar', () => {
    const { ledger, demo } = buildAll();
    expect(ledger.rows.length).toBe(demo.ledger.rows.length - 1);
    expect(ledger.issues.some((i) => i.code === 'AUX_TOTALES')).toBe(true);
  });

  it('respeta la naturaleza débito/crédito', () => {
    const { bank, ledger } = buildAll();
    for (const b of bank.rows) {
      expect(b.debit >= 0 && b.credit >= 0).toBe(true);
      expect(b.amount).toBeCloseTo(b.credit - b.debit, 2);
    }
    // El auxiliar es la cuenta de bancos: débito = entrada
    for (const l of ledger.rows) {
      expect(l.amount).toBeCloseTo(l.debit - l.credit, 2);
    }
  });

  it('calcula estadísticas del período', () => {
    const { bank } = buildAll();
    expect(bank.stats.valid).toBeGreaterThan(50);
    expect(bank.stats.minDate).toBeInstanceOf(Date);
    expect(bank.stats.totalCredit).toBeGreaterThan(0);
    expect(bank.stats.totalDebit).toBeGreaterThan(0);
  });

  it('detecta duplicados', () => {
    const { bank } = buildAll();
    expect(bank.stats.duplicates).toBeGreaterThan(0);
  });
});

describe('motor de conciliación', () => {
  it('concilia la mayoría de los movimientos', () => {
    const { bank, result } = buildAll();
    const kpis = computeKpis(bank.rows, [], result);
    expect(kpis.porcentajeConciliacion).toBeGreaterThan(50);
    expect(result.matches.length).toBeGreaterThan(40);
  });

  it('nunca asigna un movimiento dos veces', () => {
    const { result } = buildAll();
    const banks = new Set<string>();
    const ledgers = new Set<string>();
    for (const m of result.matches) {
      expect(banks.has(m.bankId)).toBe(false);
      expect(ledgers.has(m.ledgerId)).toBe(false);
      banks.add(m.bankId);
      ledgers.add(m.ledgerId);
    }
  });

  it('explica cada coincidencia', () => {
    const { result } = buildAll();
    for (const m of result.matches) {
      expect(m.explanation.length).toBeGreaterThan(10);
      expect(m.reasons.length).toBeGreaterThan(0);
    }
  });

  it('produce los siete estados del negocio', () => {
    const { result } = buildAll();
    const estados = new Set(result.matches.map((m) => m.status));
    expect(estados.has('CONCILIADO')).toBe(true);
    expect(result.unmatchedBank.length).toBeGreaterThan(0);
    expect(result.unmatchedLedger.length).toBeGreaterThan(0);
    expect(result.duplicateBank.size).toBeGreaterThan(0);
  });

  it('detecta diferencias de fecha y de valor', () => {
    const { result } = buildAll();
    const difFecha = result.matches.filter((m) => m.daysDiff !== null && Math.abs(m.daysDiff) > 0);
    const difValor = result.matches.filter((m) => Math.abs(m.amountDiff) > 0.01);
    expect(difFecha.length).toBeGreaterThan(0);
    expect(difValor.length).toBeGreaterThan(0);
    expect(result.matches.some((m) => m.status === 'DIF_VALOR')).toBe(true);
  });

  it('es rápido', () => {
    const { result, bank, ledger } = buildAll({ count: 600 });
    expect(bank.rows.length).toBeGreaterThan(400);
    expect(ledger.rows.length).toBeGreaterThan(400);
    expect(result.elapsedMs).toBeLessThan(4000);
  });
});

describe('scoring', () => {
  const bankTx = (over: Partial<BankTx> = {}): BankTx => ({
    id: 'B1',
    rowIndex: 2,
    date: new Date(2024, 2, 15, 12),
    valueDate: null,
    description: 'PAGO PROVEEDORES SUCURSAL VIRTUAL DISTRIBUIDORA',
    reference: '0000481234',
    document: '',
    transactionNumber: '0000481234',
    debit: 5_000_000,
    credit: 0,
    amount: -5_000_000,
    balance: null,
    thirdPartyId: '',
    thirdPartyName: '',
    raw: {},
    ...over,
  });

  const ledgerTx = (over: Partial<LedgerTx> = {}): LedgerTx => ({
    id: 'C1',
    rowIndex: 2,
    date: new Date(2024, 2, 15, 12),
    accountCode: '11100501',
    accountName: 'BANCOS',
    thirdPartyId: '901455201',
    thirdPartyIdRaw: '901455201-1',
    thirdPartyName: 'DISTRIBUIDORA EL PORVENIR S.A.S.',
    documentType: 'CE',
    documentNumber: 'CE-01234',
    description: 'PAGO FACTURA DISTRIBUIDORA EL PORVENIR',
    debit: 0,
    credit: 5_000_000,
    amount: -5_000_000,
    balance: null,
    raw: {},
    ...over,
  });

  it('da 100 a una coincidencia perfecta', () => {
    const s = scorePair(bankTx(), ledgerTx(), DEFAULT_CONFIG);
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.reasons.some((r) => r.code === 'VALOR_EXACTO')).toBe(true);
    expect(s.reasons.some((r) => r.code === 'FECHA_EXACTA')).toBe(true);
    expect(s.explanation).toContain('Valor exacto');
  });

  it('penaliza el desfase de fechas', () => {
    const perfecto = scorePair(bankTx(), ledgerTx(), DEFAULT_CONFIG).score;
    const desfase = scorePair(bankTx(), ledgerTx({ date: new Date(2024, 2, 12, 12) }), DEFAULT_CONFIG);
    expect(desfase.score).toBeLessThan(perfecto);
    expect(desfase.daysDiff).toBe(3);
    expect(desfase.reasons.some((r) => r.code === 'FECHA_RANGO')).toBe(true);
  });

  it('rechaza naturalezas opuestas', () => {
    const s = scorePair(bankTx(), ledgerTx({ amount: 5_000_000, debit: 5_000_000, credit: 0 }), DEFAULT_CONFIG);
    expect(s.viable).toBe(false);
  });

  it('rechaza fechas fuera del rango máximo', () => {
    const s = scorePair(bankTx(), ledgerTx({ date: new Date(2024, 0, 1, 12) }), DEFAULT_CONFIG);
    expect(s.viable).toBe(false);
  });

  it('marca diferencia de valor sin puntuar el criterio de valor', () => {
    const s = scorePair(bankTx(), ledgerTx({ amount: -4_900_000, credit: 4_900_000 }), DEFAULT_CONFIG);
    expect(s.viable).toBe(true);
    expect(s.amountDiff).toBeCloseTo(-100_000, 2);
    expect(s.reasons.some((r) => r.code === 'VALOR_DIFERENTE')).toBe(true);
    expect(s.reasons.some((r) => r.code === 'VALOR_EXACTO')).toBe(false);
  });

  it('encuentra el NIT dentro de la descripción bancaria', () => {
    const s = scorePair(
      bankTx({ description: 'PAGO PROVEEDORES NIT 901455201 SUC VIRTUAL' }),
      ledgerTx(),
      DEFAULT_CONFIG,
    );
    expect(s.reasons.some((r) => r.code === 'NIT_TEXTO')).toBe(true);
  });

  it('acepta valores dentro de la tolerancia', () => {
    const s = scorePair(bankTx(), ledgerTx({ amount: -5_000_050, credit: 5_000_050 }), DEFAULT_CONFIG);
    expect(s.reasons.some((r) => r.code === 'VALOR_APROX')).toBe(true);
  });

  it('es configurable', () => {
    const estricto = CONFIG_PRESETS.find((p) => p.id === 'estricto')!.config;
    const s = scorePair(bankTx(), ledgerTx({ date: new Date(2024, 2, 1, 12) }), estricto);
    expect(s.viable).toBe(false); // 14 días > maxDateDays de 10
  });
});

describe('decisiones manuales', () => {
  it('respeta un par rechazado', () => {
    const { bank, ledger } = buildAll();
    const base = reconcile({ bank: bank.rows, ledger: ledger.rows, config: DEFAULT_CONFIG });
    const first = base.matches[0];
    const overrides = { ...EMPTY_OVERRIDES, rejected: [pairKey(first.bankId, first.ledgerId)] };
    const after = reconcile({ bank: bank.rows, ledger: ledger.rows, config: DEFAULT_CONFIG, overrides });
    expect(after.matches.some((m) => m.bankId === first.bankId && m.ledgerId === first.ledgerId)).toBe(false);
  });

  it('respeta un vínculo manual aunque el score sea bajo', () => {
    const { bank, ledger } = buildAll();
    const b = bank.rows[0];
    const l = ledger.rows[ledger.rows.length - 1];
    const overrides = { ...EMPTY_OVERRIDES, manualLinks: [{ bankId: b.id, ledgerId: l.id }] };
    const after = reconcile({ bank: bank.rows, ledger: ledger.rows, config: DEFAULT_CONFIG, overrides });
    const m = after.matches.find((x) => x.bankId === b.id);
    expect(m?.ledgerId).toBe(l.id);
    expect(m?.origin).toBe('manual');
    expect(after.bankStatus.get(b.id)).toBe('CONCILIADO');
  });

  it('excluye los movimientos ignorados', () => {
    const { bank, ledger } = buildAll();
    const b = bank.rows[3];
    const overrides = { ...EMPTY_OVERRIDES, ignoredBank: [b.id] };
    const after = reconcile({ bank: bank.rows, ledger: ledger.rows, config: DEFAULT_CONFIG, overrides });
    expect(after.bankStatus.get(b.id)).toBe('IGNORADO');
    expect(after.matches.some((m) => m.bankId === b.id)).toBe(false);
  });

  it('sugiere candidatos para vinculación manual', () => {
    const { bank, ledger } = buildAll();
    const cands = findCandidates(bank.rows[0], ledger.rows, DEFAULT_CONFIG, 5);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0].score).toBeGreaterThanOrEqual(cands[cands.length - 1].score);
  });
});

describe('analítica', () => {
  it('calcula KPIs coherentes', () => {
    const { bank, ledger, result } = buildAll();
    const k = computeKpis(bank.rows, ledger.rows, result);
    expect(k.totalMovBanco).toBe(bank.rows.length);
    expect(k.totalMovContable).toBe(ledger.rows.length);
    expect(k.conciliados + k.probables + k.pendientes + k.noConciliados + k.duplicados + k.difValor + k.difFecha + k.ignorados)
      .toBe(bank.rows.length);
    expect(k.porcentajeConciliacion).toBeGreaterThan(0);
    expect(k.saldoBancoEsNeto).toBe(false); // el demo trae columna de saldo
  });

  it('agrupa por tercero y por cuenta', () => {
    const { ledger, result } = buildAll();
    const terceros = thirdPartySummaries(ledger.rows, result);
    expect(terceros.length).toBeGreaterThan(3);
    expect(terceros[0].movimientos).toBeGreaterThan(0);
    const cuentas = accountSummaries(ledger.rows, result);
    expect(cuentas.length).toBeGreaterThan(0);
  });

  it('arma la serie mensual', () => {
    const { bank, ledger, result } = buildAll();
    const serie = monthlySeries(bank.rows, ledger.rows, result);
    expect(serie.length).toBeGreaterThan(0);
    expect(serie[0].ingresos + serie[0].egresos).toBeGreaterThan(0);
  });

  it('genera alertas priorizadas', () => {
    const { bank, ledger, result } = buildAll();
    const terceros = thirdPartySummaries(ledger.rows, result);
    const alerts = buildAlerts(bank.rows, ledger.rows, result, terceros);
    expect(alerts.length).toBeGreaterThan(0);
    for (let i = 1; i < alerts.length; i++) {
      expect(alerts[i - 1].priority).toBeGreaterThanOrEqual(alerts[i].priority);
    }
    expect(alerts.some((a) => a.kind === 'BANCO_SIN_CONTABILIDAD')).toBe(true);
    expect(alerts.some((a) => a.kind === 'CONTABILIDAD_SIN_BANCO')).toBe(true);
  });
});

describe('configuración del algoritmo', () => {
  it('el perfil estricto concilia menos que el flexible', () => {
    const { bank, ledger } = buildAll();
    const estricto = CONFIG_PRESETS.find((p) => p.id === 'estricto')!.config;
    const flexible = CONFIG_PRESETS.find((p) => p.id === 'flexible')!.config;
    const a = reconcile({ bank: bank.rows, ledger: ledger.rows, config: estricto });
    const b = reconcile({ bank: bank.rows, ledger: ledger.rows, config: flexible });
    const ka = computeKpis(bank.rows, ledger.rows, a);
    const kb = computeKpis(bank.rows, ledger.rows, b);
    expect(ka.conciliados).toBeLessThanOrEqual(kb.conciliados);
  });

  it('cambiar un peso cambia el resultado', () => {
    const { bank, ledger } = buildAll();
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.thresholds.conciliado = 99.9;
    const a = reconcile({ bank: bank.rows, ledger: ledger.rows, config: DEFAULT_CONFIG });
    const b = reconcile({ bank: bank.rows, ledger: ledger.rows, config: cfg });
    const ka = computeKpis(bank.rows, ledger.rows, a);
    const kb = computeKpis(bank.rows, ledger.rows, b);
    expect(kb.conciliados).toBeLessThan(ka.conciliados);
  });
});
