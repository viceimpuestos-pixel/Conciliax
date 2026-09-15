/**
 * Modelo de dominio de Conciliax.
 * Este archivo no depende de React ni del DOM: puede ejecutarse en Node.
 */

export type SourceKind = 'bank' | 'ledger';

/** Movimiento del extracto bancario ya normalizado. */
export interface BankTx {
  id: string;
  rowIndex: number;
  date: Date | null;
  valueDate: Date | null;
  description: string;
  reference: string;
  document: string;
  transactionNumber: string;
  /** Salida de dinero (pagos, retiros). Siempre positivo. */
  debit: number;
  /** Entrada de dinero (consignaciones, transferencias recibidas). Siempre positivo. */
  credit: number;
  /** Firmado: credit - debit. Positivo = ingreso al banco. */
  amount: number;
  balance: number | null;
  /** Tercero/NIT si el extracto lo trae (opcional). */
  thirdPartyId: string;
  thirdPartyName: string;
  raw: Record<string, unknown>;
}

/** Movimiento del auxiliar contable por tercero ya normalizado. */
export interface LedgerTx {
  id: string;
  rowIndex: number;
  date: Date | null;
  accountCode: string;
  accountName: string;
  /** NIT normalizado (solo dígitos, sin dígito de verificación). */
  thirdPartyId: string;
  thirdPartyIdRaw: string;
  thirdPartyName: string;
  documentType: string;
  documentNumber: string;
  description: string;
  debit: number;
  credit: number;
  /**
   * Firmado según la convención configurada. Con la convención por defecto
   * ("la cuenta auxiliar es la cuenta de bancos"), débito = ingreso.
   */
  amount: number;
  balance: number | null;
  raw: Record<string, unknown>;
}

export type AnyTx = BankTx | LedgerTx;

/** Estados posibles de un movimiento / cruce. */
export type MatchStatus =
  | 'CONCILIADO'
  | 'PROBABLE'
  | 'REVISION'
  | 'NO_CONCILIADO'
  | 'DUPLICADO'
  | 'DIF_VALOR'
  | 'DIF_FECHA'
  | 'IGNORADO';

export const STATUS_LABEL: Record<MatchStatus, string> = {
  CONCILIADO: 'Conciliado',
  PROBABLE: 'Coincidencia probable',
  REVISION: 'Pendiente de revisión',
  NO_CONCILIADO: 'No conciliado',
  DUPLICADO: 'Duplicado',
  DIF_VALOR: 'Diferencia de valor',
  DIF_FECHA: 'Diferencia de fecha',
  IGNORADO: 'Ignorado',
};

/** Un criterio que aportó (o restó) puntos al score. */
export interface MatchReason {
  code: string;
  label: string;
  points: number;
}

/** Cruce entre un movimiento bancario y uno contable. */
export interface Match {
  id: string;
  bankId: string;
  ledgerId: string;
  score: number;
  status: MatchStatus;
  reasons: MatchReason[];
  /** bank.amount - ledger.amount */
  amountDiff: number;
  daysDiff: number | null;
  origin: 'auto' | 'manual';
  /** Explicación legible: "Valor exacto + mismo tercero + 2 días de diferencia". */
  explanation: string;
}

/** Resultado completo de una corrida del motor. */
export interface ReconciliationResult {
  matches: Match[];
  /** id bancario -> match */
  byBank: Map<string, Match>;
  /** id contable -> match */
  byLedger: Map<string, Match>;
  bankStatus: Map<string, MatchStatus>;
  ledgerStatus: Map<string, MatchStatus>;
  unmatchedBank: string[];
  unmatchedLedger: string[];
  duplicateBank: Set<string>;
  duplicateLedger: Set<string>;
  ignoredBank: Set<string>;
  ignoredLedger: Set<string>;
  runAt: Date;
  elapsedMs: number;
}

/** Decisiones manuales del usuario que sobreviven a una re-ejecución. */
export interface ManualOverrides {
  /** Pares forzados: `${bankId}|${ledgerId}` */
  accepted: string[];
  /** Pares prohibidos: `${bankId}|${ledgerId}` */
  rejected: string[];
  /** Vínculos creados a mano (fuerzan el cruce aunque el score sea bajo). */
  manualLinks: { bankId: string; ledgerId: string }[];
  ignoredBank: string[];
  ignoredLedger: string[];
  reviewed: string[];
  notes: Record<string, string>;
}

export const EMPTY_OVERRIDES: ManualOverrides = {
  accepted: [],
  rejected: [],
  manualLinks: [],
  ignoredBank: [],
  ignoredLedger: [],
  reviewed: [],
  notes: {},
};

/** Entrada de la bitácora de auditoría. */
export interface AuditEntry {
  id: string;
  at: Date;
  action: string;
  detail: string;
  targets: string[];
}

/** Hoja cruda leída de un archivo. */
export interface RawSheet {
  fileName: string;
  sheetName: string;
  sheetNames: string[];
  /** Fila de encabezados detectada (índice dentro de `rows`). */
  headerRowIndex: number;
  headers: string[];
  /** Filas de datos (posteriores al encabezado). */
  rows: unknown[][];
  totalRows: number;
}

/** Campos canónicos del extracto bancario. */
export type BankField =
  | 'date'
  | 'valueDate'
  | 'description'
  | 'reference'
  | 'document'
  | 'transactionNumber'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance'
  | 'thirdPartyId'
  | 'thirdPartyName';

/** Campos canónicos del auxiliar contable. */
export type LedgerField =
  | 'date'
  | 'accountCode'
  | 'accountName'
  | 'thirdPartyId'
  | 'thirdPartyName'
  | 'documentType'
  | 'documentNumber'
  | 'description'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance';

/** Mapeo campo canónico -> índice de columna en la hoja (-1 = sin asignar). */
export type ColumnMapping = Record<string, number>;

export interface FieldSpec {
  key: string;
  label: string;
  /** Sinónimos normalizados para la detección automática. */
  synonyms: string[];
  required?: boolean;
  type: 'date' | 'text' | 'money' | 'id';
  help?: string;
}

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  count?: number;
  rows?: number[];
}

/** Dataset normalizado listo para conciliar. */
export interface Dataset<T> {
  kind: SourceKind;
  fileName: string;
  sheetName: string;
  rows: T[];
  mapping: ColumnMapping;
  headers: string[];
  issues: ValidationIssue[];
  stats: DatasetStats;
}

export interface DatasetStats {
  total: number;
  valid: number;
  discarded: number;
  minDate: Date | null;
  maxDate: Date | null;
  totalDebit: number;
  totalCredit: number;
  net: number;
  duplicates: number;
  distinctThirdParties: number;
}
