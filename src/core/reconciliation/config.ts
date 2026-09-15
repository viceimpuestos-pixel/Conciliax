/**
 * Parámetros configurables del motor de conciliación.
 *
 * Todo el comportamiento del algoritmo se controla desde aquí:
 * pesos de cada criterio, tolerancias y umbrales de clasificación.
 * La pantalla "Configuración" edita este objeto en caliente.
 */

export interface CriteriaWeights {
  /** Valor idéntico (diferencia <= 0.01). */
  exactAmount: number;
  /** Valor dentro de la tolerancia (puntaje proporcional). */
  approxAmount: number;
  /** Misma fecha exacta. */
  exactDate: number;
  /** Fecha dentro de la ventana de días (puntaje proporcional). */
  dateWindow: number;
  /** Mismo NIT / identificación. */
  nit: number;
  /** Nombre del tercero similar. */
  thirdPartyName: number;
  /** Referencia coincidente. */
  reference: number;
  /** Número de documento coincidente. */
  documentNumber: number;
  /** Similitud de descripción / concepto. */
  description: number;
  /** Naturaleza coherente (crédito bancario ↔ débito contable). */
  direction: number;
}

export interface Tolerances {
  /** Diferencia absoluta admitida en pesos. */
  amountAbsolute: number;
  /** Diferencia porcentual admitida (0.5 = 0,5%). */
  amountPercent: number;
  /**
   * Ventana ampliada para detectar DIFERENCIAS DE VALOR: pares cuyo valor
   * difiere más que la tolerancia pero que aún pueden ser el mismo movimiento
   * (retención, GMF, comisión). No otorgan puntos por valor, así que sólo
   * sobreviven si el tercero / documento / fecha coinciden.
   */
  diffWindowPercent: number;
  diffWindowAbsolute: number;
  /** Días de diferencia que aún puntúan. */
  dateWindowDays: number;
  /** Más allá de estos días el par se descarta por completo. */
  maxDateDays: number;
  /** Similitud mínima de descripción para otorgar puntos (0..1). */
  descriptionMin: number;
  /** Similitud mínima de nombre de tercero para otorgar puntos (0..1). */
  nameMin: number;
}

export interface Thresholds {
  /** >= este score => CONCILIADO. */
  conciliado: number;
  /** >= este score => COINCIDENCIA PROBABLE. */
  probable: number;
  /** >= este score => PENDIENTE DE REVISIÓN. Por debajo, NO CONCILIADO. */
  revision: number;
}

export interface EngineOptions {
  /**
   * Exige que la naturaleza coincida: una entrada en el banco sólo puede
   * cruzarse con una entrada en la contabilidad.
   */
  requireDirectionMatch: boolean;
  /** Marcar como REVISIÓN cuando hay varios candidatos con el mismo puntaje. */
  flagAmbiguous: boolean;
  /** Máximo de candidatos evaluados por movimiento bancario. */
  maxCandidates: number;
}

export interface ReconciliationConfig {
  weights: CriteriaWeights;
  tolerances: Tolerances;
  thresholds: Thresholds;
  options: EngineOptions;
}

export const DEFAULT_CONFIG: ReconciliationConfig = {
  weights: {
    exactAmount: 40,
    approxAmount: 28,
    exactDate: 16,
    dateWindow: 12,
    nit: 14,
    thirdPartyName: 10,
    reference: 8,
    documentNumber: 10,
    description: 10,
    direction: 8,
  },
  tolerances: {
    amountAbsolute: 100,
    amountPercent: 0.5,
    diffWindowPercent: 5,
    diffWindowAbsolute: 5000,
    dateWindowDays: 5,
    maxDateDays: 30,
    descriptionMin: 0.4,
    nameMin: 0.7,
  },
  thresholds: {
    conciliado: 90,
    probable: 70,
    revision: 50,
  },
  options: {
    requireDirectionMatch: true,
    flagAmbiguous: true,
    maxCandidates: 25,
  },
};

/** Perfiles listos para usar. */
export const CONFIG_PRESETS: { id: string; name: string; description: string; config: ReconciliationConfig }[] = [
  {
    id: 'equilibrado',
    name: 'Equilibrado (recomendado)',
    description: 'Tolerancia de $100 y 5 días. Balance entre automatización y control.',
    config: DEFAULT_CONFIG,
  },
  {
    id: 'estricto',
    name: 'Estricto',
    description: 'Sólo cruza valores idénticos y fechas muy cercanas. Máxima precisión.',
    config: {
      ...DEFAULT_CONFIG,
      tolerances: {
        amountAbsolute: 0,
        amountPercent: 0,
        diffWindowPercent: 2,
        diffWindowAbsolute: 1000,
        dateWindowDays: 2,
        maxDateDays: 10,
        descriptionMin: 0.5,
        nameMin: 0.8,
      },
      thresholds: { conciliado: 95, probable: 80, revision: 60 },
    },
  },
  {
    id: 'flexible',
    name: 'Flexible',
    description: 'Amplía tolerancias a $2.000 y 15 días. Útil para cierres atrasados.',
    config: {
      ...DEFAULT_CONFIG,
      tolerances: {
        amountAbsolute: 2000,
        amountPercent: 1,
        diffWindowPercent: 10,
        diffWindowAbsolute: 20000,
        dateWindowDays: 15,
        maxDateDays: 60,
        descriptionMin: 0.3,
        nameMin: 0.6,
      },
      thresholds: { conciliado: 85, probable: 65, revision: 45 },
    },
  },
];

export const WEIGHT_LABELS: Record<keyof CriteriaWeights, string> = {
  exactAmount: 'Valor exacto',
  approxAmount: 'Valor aproximado',
  exactDate: 'Fecha exacta',
  dateWindow: 'Fecha dentro del rango',
  nit: 'Mismo NIT',
  thirdPartyName: 'Nombre del tercero',
  reference: 'Referencia',
  documentNumber: 'Número de documento',
  description: 'Similitud de descripción',
  direction: 'Naturaleza (débito/crédito)',
};

export function cloneConfig(c: ReconciliationConfig): ReconciliationConfig {
  return {
    weights: { ...c.weights },
    tolerances: { ...c.tolerances },
    thresholds: { ...c.thresholds },
    options: { ...c.options },
  };
}
