/**
 * Datos de prueba FICTICIOS.
 *
 * Ningún NIT, número de cuenta, nombre de empresa o valor corresponde a
 * información real. Los NIT usan el rango 9xx.xxx.xxx con dígito de
 * verificación calculado, únicamente para que la aplicación pueda demostrar
 * la validación de identificaciones.
 *
 * Los datos se generan con una semilla fija, de modo que la demostración
 * y las pruebas automáticas son reproducibles.
 */

import type { RawSheet } from '../types';
import { calcDV } from '../normalize/nit';

/* ------------------------------------------------------------------ */
/* Generador pseudoaleatorio determinista                              */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Catálogo ficticio de terceros                                       */
/* ------------------------------------------------------------------ */

interface Party {
  nit: string;
  name: string;
  role: 'proveedor' | 'cliente' | 'empleado' | 'estado';
  account: string;
  accountName: string;
}

function withDV(base: string): string {
  return base + '-' + calcDV(base);
}

export const DEMO_PARTIES: Party[] = [
  { nit: withDV('901455201'), name: 'DISTRIBUIDORA EL PORVENIR S.A.S.', role: 'proveedor', account: '22050501', accountName: 'PROVEEDORES NACIONALES' },
  { nit: withDV('901772340'), name: 'SUMINISTROS INDUSTRIALES DEL CARIBE LTDA', role: 'proveedor', account: '22050501', accountName: 'PROVEEDORES NACIONALES' },
  { nit: withDV('900318876'), name: 'TRANSPORTES LOGISTICA ANDINA S.A.S.', role: 'proveedor', account: '23350501', accountName: 'COSTOS Y GASTOS POR PAGAR' },
  { nit: withDV('901093458'), name: 'PAPELERIA Y DOTACIONES OFIMAX', role: 'proveedor', account: '23350501', accountName: 'COSTOS Y GASTOS POR PAGAR' },
  { nit: withDV('900654123'), name: 'COMERCIALIZADORA VALLE VERDE S.A.', role: 'cliente', account: '13050501', accountName: 'CLIENTES NACIONALES' },
  { nit: withDV('901230987'), name: 'INVERSIONES MONTECARLO S.A.S.', role: 'cliente', account: '13050501', accountName: 'CLIENTES NACIONALES' },
  { nit: withDV('900987456'), name: 'CONSTRUCTORA LOS ALAMOS S.A.S.', role: 'cliente', account: '13050501', accountName: 'CLIENTES NACIONALES' },
  { nit: withDV('901556702'), name: 'AGROPECUARIA SAN ISIDRO LTDA', role: 'cliente', account: '13050501', accountName: 'CLIENTES NACIONALES' },
  { nit: '1012345678', name: 'MARTINEZ RUEDA CARLOS ANDRES', role: 'empleado', account: '25050501', accountName: 'SALARIOS POR PAGAR' },
  { nit: '52987654', name: 'GOMEZ PARRA LAURA XIMENA', role: 'empleado', account: '25050501', accountName: 'SALARIOS POR PAGAR' },
  { nit: '800197268-4', name: 'ADMINISTRACION DE IMPUESTOS NACIONALES (FICTICIO)', role: 'estado', account: '23650501', accountName: 'RETENCION EN LA FUENTE POR PAGAR' },
];

const BANK_PARTY: Party = {
  nit: withDV('890903938'),
  name: 'BANCO (ENTIDAD FICTICIA DE DEMOSTRACION)',
  role: 'estado',
  account: '53050501',
  accountName: 'GASTOS BANCARIOS',
};

const BANK_ACCOUNT = '11100501';
const BANK_ACCOUNT_NAME = 'BANCOS MONEDA NACIONAL - CTA CTE 000-000000-00 (DEMO)';

/* ------------------------------------------------------------------ */
/* Modelo interno de un evento económico                               */
/* ------------------------------------------------------------------ */

interface Movement {
  date: Date;
  party: Party;
  /** Positivo = entrada de dinero al banco. */
  amount: number;
  bankDescription: string;
  ledgerDescription: string;
  docType: string;
  docNumber: string;
  reference: string;
  transactionNumber: string;
  /** Escenario de prueba que representa este movimiento. */
  scenario:
    | 'perfecto'
    | 'desfase_fecha'
    | 'diferencia_valor'
    | 'solo_banco'
    | 'solo_contable'
    | 'duplicado'
    | 'sin_nit';
  /** Días de desfase entre el registro contable y el bancario. */
  dateOffset: number;
  /** Diferencia entre el valor bancario y el contable. */
  amountOffset: number;
}

const pad = (n: number, len = 6) => String(n).padStart(len, '0');

function money(rand: () => number, min: number, max: number): number {
  const v = min + rand() * (max - min);
  return Math.round(v / 100) * 100;
}

export interface DemoOptions {
  seed?: number;
  /** Mes base (0-11) y año del período simulado. */
  year?: number;
  month?: number;
  /** Cantidad aproximada de movimientos bancarios. */
  count?: number;
}

function buildMovements(opts: Required<DemoOptions>): Movement[] {
  const rand = mulberry32(opts.seed);
  const movements: Movement[] = [];

  const providers = DEMO_PARTIES.filter((p) => p.role === 'proveedor');
  const clients = DEMO_PARTIES.filter((p) => p.role === 'cliente');
  const employees = DEMO_PARTIES.filter((p) => p.role === 'empleado');

  let doc = 1000;
  let txn = 480000;

  const dayOf = (d: number) => new Date(opts.year, opts.month, Math.min(28, Math.max(1, d)), 12, 0, 0);

  for (let i = 0; i < opts.count; i++) {
    const day = 1 + Math.floor(rand() * 27);
    const roll = rand();
    doc += 1 + Math.floor(rand() * 3);
    txn += 7 + Math.floor(rand() * 40);

    // Distribución de escenarios de prueba
    const sr = rand();
    let scenario: Movement['scenario'] = 'perfecto';
    if (sr > 0.94) scenario = 'solo_banco';
    else if (sr > 0.88) scenario = 'solo_contable';
    else if (sr > 0.82) scenario = 'diferencia_valor';
    else if (sr > 0.72) scenario = 'desfase_fecha';
    else if (sr > 0.69) scenario = 'duplicado';
    else if (sr > 0.64) scenario = 'sin_nit';

    if (roll < 0.38) {
      // Consignación de un cliente
      const party = clients[Math.floor(rand() * clients.length)];
      const amount = money(rand, 1_200_000, 48_000_000);
      movements.push({
        date: dayOf(day),
        party,
        amount,
        bankDescription: 'CONSIGNACION NACIONAL ' + party.name.split(' ').slice(0, 3).join(' '),
        ledgerDescription: 'RECAUDO CLIENTE ' + party.name,
        docType: 'RC',
        docNumber: 'RC-' + pad(doc, 5),
        reference: pad(txn, 10),
        transactionNumber: pad(txn, 10),
        scenario,
        dateOffset: scenario === 'desfase_fecha' ? 1 + Math.floor(rand() * 9) : 0,
        amountOffset: scenario === 'diferencia_valor' ? -Math.round(amount * 0.025) : 0,
      });
    } else if (roll < 0.68) {
      // Pago a proveedor
      const party = providers[Math.floor(rand() * providers.length)];
      const amount = -money(rand, 800_000, 32_000_000);
      movements.push({
        date: dayOf(day),
        party,
        amount,
        bankDescription: 'PAGO PROVEEDORES SUCURSAL VIRTUAL ' + party.name.split(' ')[0],
        ledgerDescription: 'PAGO FACTURA ' + party.name,
        docType: 'CE',
        docNumber: 'CE-' + pad(doc, 5),
        reference: pad(txn, 10),
        transactionNumber: pad(txn, 10),
        scenario,
        dateOffset: scenario === 'desfase_fecha' ? 1 + Math.floor(rand() * 9) : 0,
        amountOffset: scenario === 'diferencia_valor' ? Math.round(Math.abs(amount) * 0.035) : 0,
      });
    } else if (roll < 0.78) {
      // Transferencia entre cuentas propias
      const amount = rand() > 0.5 ? money(rand, 5_000_000, 60_000_000) : -money(rand, 5_000_000, 60_000_000);
      movements.push({
        date: dayOf(day),
        party: { nit: '', name: 'TRASLADO CUENTAS PROPIAS', role: 'estado', account: '11100502', accountName: 'BANCOS - CUENTA AHORROS (DEMO)' },
        amount,
        bankDescription: 'TRANSFERENCIA CTA SUC VIRTUAL TRASLADO INTERNO',
        ledgerDescription: 'TRASLADO ENTRE CUENTAS PROPIAS',
        docType: 'NC',
        docNumber: 'NC-' + pad(doc, 5),
        reference: pad(txn, 10),
        transactionNumber: pad(txn, 10),
        scenario: scenario === 'sin_nit' ? 'sin_nit' : scenario,
        dateOffset: scenario === 'desfase_fecha' ? 1 + Math.floor(rand() * 3) : 0,
        amountOffset: 0,
      });
    } else if (roll < 0.86) {
      // Nómina
      const party = employees[Math.floor(rand() * employees.length)];
      const amount = -money(rand, 1_800_000, 6_500_000);
      movements.push({
        date: dayOf(rand() > 0.5 ? 15 : 28),
        party,
        amount,
        bankDescription: 'PAGO NOMINA PROVEEDORES SUC VIRTUAL',
        ledgerDescription: 'PAGO NOMINA ' + party.name,
        docType: 'CE',
        docNumber: 'CE-' + pad(doc, 5),
        reference: pad(txn, 10),
        transactionNumber: pad(txn, 10),
        scenario: scenario === 'diferencia_valor' ? 'perfecto' : scenario,
        dateOffset: scenario === 'desfase_fecha' ? 1 : 0,
        amountOffset: 0,
      });
    } else if (roll < 0.94) {
      // Gravamen a los movimientos financieros / comisiones (frecuentemente no registrados)
      const amount = -money(rand, 4_000, 180_000);
      movements.push({
        date: dayOf(day),
        party: BANK_PARTY,
        amount,
        bankDescription: rand() > 0.5 ? 'CUOTA MANEJO / COMISION SERVICIOS' : 'IMPUESTO GOBIERNO 4X1000',
        ledgerDescription: 'GASTOS BANCARIOS DEL PERIODO',
        docType: 'NC',
        docNumber: 'NC-' + pad(doc, 5),
        reference: '',
        transactionNumber: pad(txn, 10),
        scenario: rand() > 0.45 ? 'solo_banco' : 'perfecto',
        dateOffset: 0,
        amountOffset: 0,
      });
    } else {
      // Rendimientos financieros
      const amount = money(rand, 30_000, 900_000);
      movements.push({
        date: dayOf(day),
        party: BANK_PARTY,
        amount,
        bankDescription: 'ABONO INTERESES CUENTA',
        ledgerDescription: 'RENDIMIENTOS FINANCIEROS',
        docType: 'NC',
        docNumber: 'NC-' + pad(doc, 5),
        reference: '',
        transactionNumber: pad(txn, 10),
        scenario: rand() > 0.6 ? 'solo_banco' : 'perfecto',
        dateOffset: 0,
        amountOffset: 0,
      });
    }
  }

  return movements.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/* ------------------------------------------------------------------ */
/* Construcción de las hojas crudas                                    */
/* ------------------------------------------------------------------ */

const BANK_HEADERS = [
  'FECHA',
  'DESCRIPCION',
  'SUCURSAL',
  'DOCUMENTO',
  'DEBITO',
  'CREDITO',
  'SALDO',
];

const LEDGER_HEADERS = [
  'FECHA',
  'CUENTA',
  'NOMBRE CUENTA',
  'NIT',
  'NOMBRE DEL TERCERO',
  'TIPO DOC',
  'NUMERO DOCUMENTO',
  'DETALLE',
  'DEBITO',
  'CREDITO',
];

function fmtDate(d: Date): string {
  return (
    String(d.getDate()).padStart(2, '0') +
    '/' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '/' +
    d.getFullYear()
  );
}

/** Formato colombiano con separador de miles, como llega en los extractos. */
function fmtCop(n: number): string {
  if (!n) return '';
  return Math.abs(n)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d),)/g, '.');
}

export interface DemoSheets {
  bank: RawSheet;
  ledger: RawSheet;
  meta: {
    movimientos: number;
    escenarios: Record<string, number>;
  };
}

export function generateDemoSheets(options: DemoOptions = {}): DemoSheets {
  const opts: Required<DemoOptions> = {
    seed: options.seed ?? 20240301,
    year: options.year ?? 2024,
    month: options.month ?? 2, // marzo
    count: options.count ?? 120,
  };

  const movements = buildMovements(opts);
  const escenarios: Record<string, number> = {};

  const bankRows: unknown[][] = [];
  const ledgerRows: unknown[][] = [];

  let saldo = 185_400_000;
  const shift = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12, 0, 0);

  for (const m of movements) {
    escenarios[m.scenario] = (escenarios[m.scenario] ?? 0) + 1;

    const inBank = m.scenario !== 'solo_contable';
    const inLedger = m.scenario !== 'solo_banco';

    if (inBank) {
      saldo += m.amount;
      const push = () =>
        bankRows.push([
          fmtDate(m.date),
          m.bankDescription + (m.scenario === 'sin_nit' ? '' : ' NIT ' + m.party.nit.replace(/\D/g, '').slice(0, 9)),
          m.reference ? m.reference.slice(0, 4) : '0000',
          m.transactionNumber,
          m.amount < 0 ? fmtCop(m.amount) : '',
          m.amount > 0 ? fmtCop(m.amount) : '',
          fmtCop(saldo),
        ]);
      push();
      // El duplicado aparece dos veces en el extracto
      if (m.scenario === 'duplicado') {
        saldo += m.amount;
        push();
      }
    }

    if (inLedger) {
      const ledgerDate = shift(m.date, -m.dateOffset);
      const ledgerAmount = m.amount - m.amountOffset;
      // El auxiliar es la cuenta de bancos: entrada de dinero = débito.
      const debito = ledgerAmount > 0 ? Math.abs(ledgerAmount) : 0;
      const credito = ledgerAmount < 0 ? Math.abs(ledgerAmount) : 0;

      ledgerRows.push([
        fmtDate(ledgerDate),
        BANK_ACCOUNT,
        BANK_ACCOUNT_NAME,
        m.scenario === 'sin_nit' ? '' : m.party.nit,
        m.party.name,
        m.docType,
        m.docNumber,
        m.ledgerDescription,
        debito ? fmtCop(debito) : '',
        credito ? fmtCop(credito) : '',
      ]);
    }
  }

  // Fila de totales, como la traen los auxiliares reales (debe ser descartada)
  const totalDebito = ledgerRows.reduce((a, r) => a + Number(String(r[8] || '0').replace(/\./g, '').replace(',', '.')), 0);
  const totalCredito = ledgerRows.reduce((a, r) => a + Number(String(r[9] || '0').replace(/\./g, '').replace(',', '.')), 0);
  ledgerRows.push(['', '', 'TOTALES', '', '', '', '', '', fmtCop(totalDebito), fmtCop(totalCredito)]);

  const bank: RawSheet = {
    fileName: 'DEMO_Extracto_Bancolombia.xlsx',
    sheetName: 'Movimientos',
    sheetNames: ['Movimientos'],
    headerRowIndex: 0,
    headers: BANK_HEADERS,
    rows: bankRows,
    totalRows: bankRows.length,
  };

  const ledger: RawSheet = {
    fileName: 'DEMO_Auxiliar_por_tercero.xlsx',
    sheetName: 'Auxiliar',
    sheetNames: ['Auxiliar'],
    headerRowIndex: 0,
    headers: LEDGER_HEADERS,
    rows: ledgerRows,
    totalRows: ledgerRows.length,
  };

  return { bank, ledger, meta: { movimientos: movements.length, escenarios } };
}
