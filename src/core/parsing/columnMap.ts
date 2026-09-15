/**
 * Diccionario de campos canónicos y detección automática de columnas.
 *
 * Para soportar otro banco u otro software contable basta agregar sinónimos
 * aquí (o un perfil en BANK_PROFILES): el motor de conciliación no cambia.
 */

import type { ColumnMapping, FieldSpec, RawSheet } from '../types';
import { normalizeText } from '../normalize/text';
import { parseMoney } from '../normalize/money';
import { parseDate } from '../normalize/dates';

/* ------------------------------------------------------------------ */
/* Campos del extracto bancario                                        */
/* ------------------------------------------------------------------ */

export const BANK_FIELDS: FieldSpec[] = [
  {
    key: 'date',
    label: 'Fecha',
    type: 'date',
    required: true,
    synonyms: [
      'FECHA', 'FECHA MOVIMIENTO', 'FECHA DE MOVIMIENTO', 'FECHA TRANSACCION',
      'FECHA DE TRANSACCION', 'FECHA OPERACION', 'FECHA DE OPERACION', 'F MOVIMIENTO',
      'FEC MOVIMIENTO', 'DATE', 'FECHA PROCESO', 'FECHA REGISTRO',
    ],
    help: 'Fecha en que el banco registró el movimiento.',
  },
  {
    key: 'valueDate',
    label: 'Fecha de valor',
    type: 'date',
    synonyms: ['FECHA VALOR', 'FECHA DE VALOR', 'FECHA APLICACION', 'VALUE DATE'],
  },
  {
    key: 'description',
    label: 'Descripción / Concepto',
    type: 'text',
    required: true,
    synonyms: [
      'DESCRIPCION', 'DESCRIPCION MOVIMIENTO', 'CONCEPTO', 'DETALLE', 'DETALLE MOVIMIENTO',
      'GLOSA', 'OBSERVACION', 'OBSERVACIONES', 'TRANSACCION', 'DESCRIPCION TRANSACCION',
      'NOMBRE TRANSACCION', 'TIPO TRANSACCION', 'MOVIMIENTO', 'DESCRIPTION', 'NARRACION',
    ],
  },
  {
    key: 'reference',
    label: 'Referencia',
    type: 'text',
    synonyms: [
      'REFERENCIA', 'REF', 'REFERENCIA 1', 'REFERENCIA 2', 'REFERENCIA PAGO',
      'OFICINA', 'SUCURSAL', 'CODIGO REFERENCIA', 'REFERENCE',
    ],
  },
  {
    key: 'document',
    label: 'Documento',
    type: 'text',
    synonyms: ['DOCUMENTO', 'NRO DOCUMENTO', 'NUMERO DOCUMENTO', 'COMPROBANTE', 'CHEQUE', 'NRO CHEQUE'],
  },
  {
    key: 'transactionNumber',
    label: 'Número de transacción',
    type: 'text',
    synonyms: [
      'NUMERO DE TRANSACCION', 'NUMERO TRANSACCION', 'NRO TRANSACCION', 'NO TRANSACCION',
      'ID TRANSACCION', 'CONSECUTIVO', 'SECUENCIA', 'AUTORIZACION', 'NRO AUTORIZACION',
    ],
  },
  {
    key: 'debit',
    label: 'Débito (salidas)',
    type: 'money',
    synonyms: [
      'DEBITO', 'DEBITOS', 'DEBE', 'CARGO', 'CARGOS', 'RETIRO', 'RETIROS',
      'VALOR DEBITO', 'EGRESO', 'EGRESOS', 'SALIDA', 'SALIDAS', 'DEBIT',
    ],
    help: 'Salidas de dinero. Se toma siempre en positivo.',
  },
  {
    key: 'credit',
    label: 'Crédito (entradas)',
    type: 'money',
    synonyms: [
      'CREDITO', 'CREDITOS', 'HABER', 'ABONO', 'ABONOS', 'CONSIGNACION', 'CONSIGNACIONES',
      'VALOR CREDITO', 'INGRESO', 'INGRESOS', 'ENTRADA', 'ENTRADAS', 'DEPOSITO', 'CREDIT',
    ],
    help: 'Entradas de dinero. Se toma siempre en positivo.',
  },
  {
    key: 'amount',
    label: 'Valor (columna única con signo)',
    type: 'money',
    synonyms: [
      'VALOR', 'VALOR TRANSACCION', 'VALOR MOVIMIENTO', 'IMPORTE', 'MONTO',
      'VALOR TOTAL', 'AMOUNT', 'VALOR NETO',
    ],
    help: 'Úselo cuando el extracto trae un solo valor con signo (negativo = salida).',
  },
  {
    key: 'balance',
    label: 'Saldo',
    type: 'money',
    synonyms: ['SALDO', 'SALDO FINAL', 'SALDO DISPONIBLE', 'NUEVO SALDO', 'BALANCE', 'SALDO ACUMULADO'],
  },
  {
    key: 'thirdPartyId',
    label: 'NIT / Identificación (opcional)',
    type: 'id',
    synonyms: ['NIT', 'IDENTIFICACION', 'CEDULA', 'DOCUMENTO TERCERO', 'NIT TERCERO', 'ID TERCERO'],
  },
  {
    key: 'thirdPartyName',
    label: 'Tercero (opcional)',
    type: 'text',
    synonyms: ['TERCERO', 'NOMBRE TERCERO', 'BENEFICIARIO', 'ORDENANTE', 'PAGADOR', 'CLIENTE', 'PROVEEDOR'],
  },
];

/* ------------------------------------------------------------------ */
/* Campos del auxiliar contable por tercero                            */
/* ------------------------------------------------------------------ */

export const LEDGER_FIELDS: FieldSpec[] = [
  {
    key: 'date',
    label: 'Fecha',
    type: 'date',
    required: true,
    synonyms: [
      'FECHA', 'FECHA MOVIMIENTO', 'FECHA DOCUMENTO', 'FECHA DE DOCUMENTO',
      'FECHA REGISTRO', 'FECHA CONTABILIZACION', 'F DOCUMENTO', 'DATE',
    ],
  },
  {
    key: 'accountCode',
    label: 'Código de cuenta',
    type: 'text',
    synonyms: [
      'CUENTA', 'CUENTA CONTABLE', 'CODIGO CUENTA', 'CODIGO DE CUENTA', 'COD CUENTA',
      'CTA', 'CTA CONTABLE', 'AUXILIAR', 'CODIGO', 'PUC', 'CUENTA PUC',
    ],
  },
  {
    key: 'accountName',
    label: 'Nombre de cuenta',
    type: 'text',
    synonyms: [
      'NOMBRE CUENTA', 'NOMBRE DE CUENTA', 'DESCRIPCION CUENTA', 'DESCRIPCION DE CUENTA',
      'NOMBRE DE LA CUENTA', 'CUENTA NOMBRE', 'DENOMINACION',
    ],
  },
  {
    key: 'thirdPartyId',
    label: 'NIT / Identificación',
    type: 'id',
    synonyms: [
      'NIT', 'NIT TERCERO', 'IDENTIFICACION', 'IDENTIFICACION TERCERO', 'CEDULA',
      'CC NIT', 'DOCUMENTO TERCERO', 'ID TERCERO', 'CODIGO TERCERO', 'NUMERO IDENTIFICACION',
    ],
  },
  {
    key: 'thirdPartyName',
    label: 'Nombre del tercero',
    type: 'text',
    synonyms: [
      'TERCERO', 'NOMBRE TERCERO', 'NOMBRE DEL TERCERO', 'RAZON SOCIAL', 'NOMBRE',
      'CLIENTE', 'PROVEEDOR', 'BENEFICIARIO', 'DESCRIPCION TERCERO',
    ],
  },
  {
    key: 'documentType',
    label: 'Tipo de documento',
    type: 'text',
    synonyms: [
      'TIPO DOCUMENTO', 'TIPO DE DOCUMENTO', 'TIPO DOC', 'CLASE DOCUMENTO',
      'TIPO COMPROBANTE', 'PREFIJO', 'TIPO', 'DOC TIPO',
    ],
  },
  {
    key: 'documentNumber',
    label: 'Número de documento',
    type: 'text',
    synonyms: [
      'NUMERO DOCUMENTO', 'NUMERO DE DOCUMENTO', 'NRO DOCUMENTO', 'NO DOCUMENTO',
      'DOCUMENTO', 'COMPROBANTE', 'NRO COMPROBANTE', 'CONSECUTIVO', 'NUM DOC', 'DOC',
    ],
  },
  {
    key: 'description',
    label: 'Descripción / Detalle',
    type: 'text',
    synonyms: [
      'DESCRIPCION', 'DETALLE', 'CONCEPTO', 'OBSERVACION', 'OBSERVACIONES', 'GLOSA',
      'NOTA', 'DETALLE MOVIMIENTO', 'DESCRIPCION MOVIMIENTO',
    ],
  },
  {
    key: 'debit',
    label: 'Débito',
    type: 'money',
    synonyms: ['DEBITO', 'DEBITOS', 'DEBE', 'VALOR DEBITO', 'CARGO', 'DEBIT', 'DB'],
  },
  {
    key: 'credit',
    label: 'Crédito',
    type: 'money',
    synonyms: ['CREDITO', 'CREDITOS', 'HABER', 'VALOR CREDITO', 'ABONO', 'CREDIT', 'CR'],
  },
  {
    key: 'amount',
    label: 'Valor (columna única con signo)',
    type: 'money',
    synonyms: ['VALOR', 'IMPORTE', 'MONTO', 'VALOR MOVIMIENTO', 'NETO', 'AMOUNT'],
  },
  {
    key: 'balance',
    label: 'Saldo',
    type: 'money',
    synonyms: ['SALDO', 'SALDO FINAL', 'SALDO ACUMULADO', 'NUEVO SALDO', 'BALANCE'],
  },
];

export function fieldsFor(kind: 'bank' | 'ledger'): FieldSpec[] {
  return kind === 'bank' ? BANK_FIELDS : LEDGER_FIELDS;
}

/** Todos los sinónimos conocidos (usado para detectar la fila de encabezado). */
export const ALL_SYNONYMS: Set<string> = new Set(
  [...BANK_FIELDS, ...LEDGER_FIELDS].flatMap((f) => [normalizeText(f.label), ...f.synonyms]),
);

/* ------------------------------------------------------------------ */
/* Detección automática                                                */
/* ------------------------------------------------------------------ */

export interface DetectionInfo {
  mapping: ColumnMapping;
  /** Confianza 0..100 por campo. */
  confidence: Record<string, number>;
  /** Campos obligatorios que no se pudieron detectar. */
  missingRequired: string[];
}

/** Similitud simple entre encabezado y sinónimo. */
function headerMatchScore(header: string, spec: FieldSpec): number {
  const h = normalizeText(header);
  if (!h) return 0;
  const candidates = [normalizeText(spec.label), ...spec.synonyms];

  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    if (h === c) return 100;
    if (h.replace(/\s/g, '') === c.replace(/\s/g, '')) return 98;
    if (h.startsWith(c) || c.startsWith(h)) best = Math.max(best, 88);
    if (h.includes(c) && c.length >= 4) best = Math.max(best, 80);
    if (c.includes(h) && h.length >= 4) best = Math.max(best, 74);
  }
  return best;
}

/** Analiza el contenido de una columna para confirmar su tipo. */
function contentScore(rows: unknown[][], col: number, type: FieldSpec['type']): number {
  const sample = rows.slice(0, 60).map((r) => r?.[col]).filter((v) => v !== null && v !== undefined && v !== '');
  if (!sample.length) return 0;
  let hits = 0;
  for (const v of sample) {
    switch (type) {
      case 'date':
        if (parseDate(v)) hits++;
        break;
      case 'money': {
        const raw = String(v).trim();
        if (/[\d]/.test(raw) && !/[a-zA-Z]{3,}/.test(raw)) hits++;
        break;
      }
      case 'id':
        if (/^[\d.\-\s]{5,}$/.test(String(v).trim())) hits++;
        break;
      case 'text':
        if (String(v).trim().length > 0) hits++;
        break;
    }
  }
  return (hits / sample.length) * 100;
}

/**
 * Detecta automáticamente el mapeo de columnas.
 * Combina el nombre del encabezado (peso alto) con el contenido (desempate).
 */
export function detectMapping(sheet: RawSheet, kind: 'bank' | 'ledger'): DetectionInfo {
  const specs = fieldsFor(kind);
  const mapping: ColumnMapping = {};
  const confidence: Record<string, number> = {};
  for (const s of specs) {
    mapping[s.key] = -1;
    confidence[s.key] = 0;
  }

  type Candidate = { field: string; col: number; score: number };
  const candidates: Candidate[] = [];

  sheet.headers.forEach((header, col) => {
    for (const spec of specs) {
      const nameScore = headerMatchScore(header, spec);
      if (nameScore <= 0) continue;
      const content = contentScore(sheet.rows, col, spec.type);
      // El nombre manda; el contenido ajusta +-15.
      const score = nameScore * 0.85 + content * 0.15;
      candidates.push({ field: spec.key, col, score });
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  const usedCols = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== -1) continue;
    if (usedCols.has(c.col)) continue;
    mapping[c.field] = c.col;
    confidence[c.field] = Math.round(Math.min(100, c.score));
    usedCols.add(c.col);
  }

  // Si no hay débito/crédito pero sí un "valor", se usa la columna única.
  if (mapping.debit === -1 && mapping.credit === -1 && mapping.amount === -1) {
    const idx = sheet.headers.findIndex((h) => /VALOR|IMPORTE|MONTO/.test(normalizeText(h)));
    if (idx >= 0 && !usedCols.has(idx)) {
      mapping.amount = idx;
      confidence.amount = 60;
    }
  }

  const missingRequired = specs
    .filter((s) => s.required && mapping[s.key] === -1)
    .map((s) => s.key);

  // El valor es obligatorio de alguna de las dos formas
  if (mapping.debit === -1 && mapping.credit === -1 && mapping.amount === -1) {
    missingRequired.push('amount');
  }

  return { mapping, confidence, missingRequired };
}

/* ------------------------------------------------------------------ */
/* Perfiles de banco (extensible)                                      */
/* ------------------------------------------------------------------ */

export interface BankProfile {
  id: string;
  name: string;
  /** Sinónimos extra que se suman a los genéricos para este banco. */
  extraSynonyms?: Partial<Record<string, string[]>>;
  /** Sugerencia de orden de fecha. */
  dateOrder?: 'auto' | 'dmy' | 'mdy' | 'ymd';
}

export const BANK_PROFILES: BankProfile[] = [
  {
    id: 'bancolombia',
    name: 'Bancolombia',
    dateOrder: 'dmy',
    extraSynonyms: {
      description: ['DESCRIPCION MOTIVO', 'MOTIVO', 'CLASE MOVIMIENTO'],
      reference: ['SUCURSAL', 'DCTO'],
      transactionNumber: ['NUMERO DOCUMENTO'],
    },
  },
  { id: 'davivienda', name: 'Davivienda', dateOrder: 'dmy' },
  { id: 'bbva', name: 'BBVA', dateOrder: 'dmy' },
  { id: 'bogota', name: 'Banco de Bogotá', dateOrder: 'dmy' },
  { id: 'generico', name: 'Genérico / Otro banco', dateOrder: 'auto' },
];

/** Aplica los sinónimos extra de un perfil (mutación controlada y reversible). */
export function withProfile(profileId: string): FieldSpec[] {
  const profile = BANK_PROFILES.find((p) => p.id === profileId);
  if (!profile?.extraSynonyms) return BANK_FIELDS;
  return BANK_FIELDS.map((f) => {
    const extra = profile.extraSynonyms?.[f.key];
    return extra ? { ...f, synonyms: [...f.synonyms, ...extra] } : f;
  });
}
