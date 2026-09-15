/**
 * Estado global de la aplicación (Zustand).
 *
 * El store sólo orquesta: toda la lógica vive en `src/core`.
 * La estructura está pensada para envolverse luego en un `Workspace`
 * por empresa (multiempresa) sin cambiar los componentes.
 */

import { create } from 'zustand';
import type {
  AuditEntry,
  BankTx,
  ColumnMapping,
  Dataset,
  LedgerTx,
  ManualOverrides,
  MatchStatus,
  ReconciliationResult,
} from '../core/types';
import { EMPTY_OVERRIDES } from '../core/types';
import { loadFile, loadBuffer, type LoadedFile } from '../core/parsing/loadFile';
import { detectMapping, type DetectionInfo } from '../core/parsing/columnMap';
import { buildBankDataset, buildLedgerDataset, type BuildOptions } from '../core/parsing/buildDataset';
import { reconcile, pairKey } from '../core/reconciliation/engine';
import { DEFAULT_CONFIG, cloneConfig, type ReconciliationConfig } from '../core/reconciliation/config';
import { generateDemoSheets } from '../core/demo/sampleData';

export type Section =
  | 'dashboard'
  | 'importar'
  | 'conciliacion'
  | 'terceros'
  | 'contable'
  | 'alertas'
  | 'reportes'
  | 'configuracion';

export interface Filters {
  search: string;
  dateFrom: string;
  dateTo: string;
  tercero: string;
  nit: string;
  cuenta: string;
  estados: MatchStatus[];
  minValor: string;
  maxValor: string;
  naturaleza: 'todos' | 'debito' | 'credito';
  minConfianza: number;
  maxConfianza: number;
}

export const EMPTY_FILTERS: Filters = {
  search: '',
  dateFrom: '',
  dateTo: '',
  tercero: '',
  nit: '',
  cuenta: '',
  estados: [],
  minValor: '',
  maxValor: '',
  naturaleza: 'todos',
  minConfianza: 0,
  maxConfianza: 100,
};

export interface Progress {
  step: number;
  total: number;
  label: string;
  running: boolean;
}

export interface ImportSlot {
  file: LoadedFile | null;
  mapping: ColumnMapping;
  detection: DetectionInfo | null;
  fileName: string;
}

interface AppState {
  section: Section;
  setSection: (s: Section) => void;

  /* Importación */
  wizardStep: number;
  setWizardStep: (n: number) => void;
  bank: ImportSlot;
  ledger: ImportSlot;
  buildOptions: BuildOptions;
  setBuildOptions: (o: Partial<BuildOptions>) => void;

  bankDataset: Dataset<BankTx> | null;
  ledgerDataset: Dataset<LedgerTx> | null;

  progress: Progress | null;
  error: string | null;
  warnings: string[];

  loadBankFile: (file: File) => Promise<void>;
  loadLedgerFile: (file: File) => Promise<void>;
  reloadWithSheet: (which: 'bank' | 'ledger', sheetName?: string, headerRowIndex?: number) => Promise<void>;
  setMapping: (which: 'bank' | 'ledger', field: string, columnIndex: number) => void;
  autoDetect: (which: 'bank' | 'ledger') => void;
  buildDatasets: () => void;
  loadDemo: () => Promise<void>;
  clearAll: () => void;

  /* Conciliación */
  config: ReconciliationConfig;
  setConfig: (c: ReconciliationConfig) => void;
  overrides: ManualOverrides;
  result: ReconciliationResult | null;
  lastRunAt: Date | null;
  run: () => Promise<void>;

  acceptMatch: (bankId: string, ledgerId: string) => void;
  rejectMatch: (bankId: string, ledgerId: string) => void;
  linkManual: (bankId: string, ledgerId: string) => void;
  unlink: (bankId: string) => void;
  toggleIgnore: (kind: 'bank' | 'ledger', id: string) => void;
  toggleReviewed: (id: string) => void;
  setNote: (id: string, note: string) => void;

  audit: AuditEntry[];
  log: (action: string, detail: string, targets?: string[]) => void;

  /* Filtros */
  filters: Filters;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;

  /* Selección */
  selectedThirdParty: string | null;
  selectThirdParty: (key: string | null) => void;
}

const emptySlot = (): ImportSlot => ({ file: null, mapping: {}, detection: null, fileName: '' });

function overridesWithout(ov: ManualOverrides, bankId: string): ManualOverrides {
  return {
    ...ov,
    accepted: ov.accepted.filter((k) => !k.startsWith(bankId + '|')),
    manualLinks: ov.manualLinks.filter((l) => l.bankId !== bankId),
  };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const useStore = create<AppState>((set, get) => ({
  section: 'importar',
  setSection: (s) => set({ section: s }),

  wizardStep: 1,
  setWizardStep: (n) => set({ wizardStep: n }),
  bank: emptySlot(),
  ledger: emptySlot(),
  buildOptions: { dateOrder: 'auto', decimalHint: 'auto', ledgerSign: 'debito-ingreso', dropTotals: true },
  setBuildOptions: (o) => set({ buildOptions: { ...get().buildOptions, ...o } }),

  bankDataset: null,
  ledgerDataset: null,

  progress: null,
  error: null,
  warnings: [],

  async loadBankFile(file) {
    set({ error: null });
    try {
      const loaded = await loadFile(file);
      const detection = detectMapping(loaded.sheet, 'bank');
      set({
        bank: { file: loaded, mapping: detection.mapping, detection, fileName: file.name },
        warnings: [...get().warnings.filter((w) => !w.startsWith('Extracto:')), ...loaded.warnings.map((w) => 'Extracto: ' + w)],
      });
      get().log('Carga de extracto', file.name + ' (' + loaded.sheet.totalRows + ' filas)');
    } catch (e) {
      set({ error: 'No se pudo leer el extracto: ' + (e as Error).message });
    }
  },

  async loadLedgerFile(file) {
    set({ error: null });
    try {
      const loaded = await loadFile(file);
      const detection = detectMapping(loaded.sheet, 'ledger');
      set({
        ledger: { file: loaded, mapping: detection.mapping, detection, fileName: file.name },
        warnings: [...get().warnings.filter((w) => !w.startsWith('Auxiliar:')), ...loaded.warnings.map((w) => 'Auxiliar: ' + w)],
      });
      get().log('Carga de auxiliar', file.name + ' (' + loaded.sheet.totalRows + ' filas)');
    } catch (e) {
      set({ error: 'No se pudo leer el auxiliar: ' + (e as Error).message });
    }
  },

  async reloadWithSheet(which, sheetName, headerRowIndex) {
    const slot = get()[which];
    if (!slot.file) return;
    const loaded = await loadBuffer(slot.file.buffer, slot.file.sheet.fileName, undefined, {
      sheetName: sheetName ?? slot.file.sheet.sheetName,
      headerRowIndex,
    });
    const detection = detectMapping(loaded.sheet, which);
    set({ [which]: { ...slot, file: loaded, mapping: detection.mapping, detection } } as never);
  },

  setMapping(which, field, columnIndex) {
    const slot = get()[which];
    set({ [which]: { ...slot, mapping: { ...slot.mapping, [field]: columnIndex } } } as never);
  },

  autoDetect(which) {
    const slot = get()[which];
    if (!slot.file) return;
    const detection = detectMapping(slot.file.sheet, which);
    set({ [which]: { ...slot, mapping: detection.mapping, detection } } as never);
  },

  buildDatasets() {
    const { bank, ledger, buildOptions } = get();
    if (!bank.file || !ledger.file) return;
    const bankDataset = buildBankDataset(bank.file.sheet, bank.mapping, buildOptions);
    const ledgerDataset = buildLedgerDataset(ledger.file.sheet, ledger.mapping, buildOptions);
    set({ bankDataset, ledgerDataset });
  },

  async loadDemo() {
    set({ error: null, progress: { step: 1, total: 3, label: 'Generando datos de demostración…', running: true } });
    await wait(60);
    const demo = generateDemoSheets();

    const bankDetection = detectMapping(demo.bank, 'bank');
    const ledgerDetection = detectMapping(demo.ledger, 'ledger');

    set({
      bank: {
        file: { format: 'excel', sheet: demo.bank, buffer: new ArrayBuffer(0), warnings: [] },
        mapping: bankDetection.mapping,
        detection: bankDetection,
        fileName: demo.bank.fileName,
      },
      ledger: {
        file: { format: 'excel', sheet: demo.ledger, buffer: new ArrayBuffer(0), warnings: [] },
        mapping: ledgerDetection.mapping,
        detection: ledgerDetection,
        fileName: demo.ledger.fileName,
      },
      overrides: { ...EMPTY_OVERRIDES },
      warnings: ['Datos de demostración ficticios cargados. Ningún NIT, cuenta o valor corresponde a información real.'],
    });

    get().buildDatasets();
    get().log('Datos de demostración', demo.meta.movimientos + ' movimientos simulados');
    await get().run();
    set({ section: 'dashboard', wizardStep: 8 });
  },

  clearAll() {
    set({
      bank: emptySlot(),
      ledger: emptySlot(),
      bankDataset: null,
      ledgerDataset: null,
      result: null,
      overrides: { ...EMPTY_OVERRIDES },
      warnings: [],
      error: null,
      wizardStep: 1,
      audit: [],
      filters: { ...EMPTY_FILTERS },
      section: 'importar',
    });
  },

  /* ---------------------------------------------------------------- */

  config: cloneConfig(DEFAULT_CONFIG),
  setConfig: (c) => set({ config: c }),
  overrides: { ...EMPTY_OVERRIDES },
  result: null,
  lastRunAt: null,

  async run() {
    const steps: [number, string][] = [
      [5, 'Validando información…'],
      [6, 'Normalizando datos…'],
      [7, 'Ejecutando conciliación…'],
    ];

    set({ error: null, progress: { step: 5, total: 8, label: steps[0][1], running: true } });
    await wait(80);

    get().buildDatasets();
    const { bankDataset, ledgerDataset, config, overrides } = get();

    if (!bankDataset || !ledgerDataset) {
      set({ progress: null, error: 'Debe cargar y mapear ambos archivos antes de conciliar.' });
      return;
    }

    set({ progress: { step: 6, total: 8, label: steps[1][1], running: true } });
    await wait(80);
    set({ progress: { step: 7, total: 8, label: steps[2][1], running: true } });
    await wait(40);

    try {
      const result = reconcile({
        bank: bankDataset.rows,
        ledger: ledgerDataset.rows,
        config,
        overrides,
      });
      set({
        result,
        lastRunAt: result.runAt,
        progress: { step: 8, total: 8, label: 'Conciliación finalizada', running: false },
        wizardStep: 8,
      });
      get().log(
        'Conciliación ejecutada',
        result.matches.length + ' cruces sobre ' + bankDataset.rows.length + ' movimientos bancarios (' + result.elapsedMs + ' ms)',
      );
      await wait(400);
      set({ progress: null });
    } catch (e) {
      set({ progress: null, error: 'Error durante la conciliación: ' + (e as Error).message });
    }
  },

  acceptMatch(bankId, ledgerId) {
    const ov = get().overrides;
    const key = pairKey(bankId, ledgerId);
    set({
      overrides: {
        ...ov,
        accepted: ov.accepted.includes(key) ? ov.accepted : [...ov.accepted, key],
        rejected: ov.rejected.filter((k) => k !== key),
      },
    });
    get().log('Coincidencia aceptada', bankId + ' ↔ ' + ledgerId, [bankId, ledgerId]);
    void get().run();
  },

  rejectMatch(bankId, ledgerId) {
    const ov = get().overrides;
    const key = pairKey(bankId, ledgerId);
    set({
      overrides: {
        ...overridesWithout(ov, bankId),
        rejected: ov.rejected.includes(key) ? ov.rejected : [...ov.rejected, key],
      },
    });
    get().log('Coincidencia rechazada', bankId + ' ↔ ' + ledgerId, [bankId, ledgerId]);
    void get().run();
  },

  linkManual(bankId, ledgerId) {
    const ov = overridesWithout(get().overrides, bankId);
    set({
      overrides: {
        ...ov,
        manualLinks: [...ov.manualLinks.filter((l) => l.ledgerId !== ledgerId), { bankId, ledgerId }],
        rejected: ov.rejected.filter((k) => k !== pairKey(bankId, ledgerId)),
      },
    });
    get().log('Vinculación manual', bankId + ' ↔ ' + ledgerId, [bankId, ledgerId]);
    void get().run();
  },

  unlink(bankId) {
    const { overrides: ov, result } = get();
    const current = result?.byBank.get(bankId);
    const next = overridesWithout(ov, bankId);
    if (current) {
      const key = pairKey(bankId, current.ledgerId);
      next.rejected = next.rejected.includes(key) ? next.rejected : [...next.rejected, key];
    }
    set({ overrides: next });
    get().log('Desvinculación', bankId, [bankId]);
    void get().run();
  },

  toggleIgnore(kind, id) {
    const ov = get().overrides;
    const list = kind === 'bank' ? ov.ignoredBank : ov.ignoredLedger;
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    set({
      overrides: kind === 'bank' ? { ...ov, ignoredBank: next } : { ...ov, ignoredLedger: next },
    });
    get().log(list.includes(id) ? 'Movimiento reactivado' : 'Movimiento ignorado', id, [id]);
    void get().run();
  },

  toggleReviewed(id) {
    const ov = get().overrides;
    const next = ov.reviewed.includes(id) ? ov.reviewed.filter((x) => x !== id) : [...ov.reviewed, id];
    set({ overrides: { ...ov, reviewed: next } });
    get().log(ov.reviewed.includes(id) ? 'Marca de revisión retirada' : 'Marcado como revisado', id, [id]);
  },

  setNote(id, note) {
    const ov = get().overrides;
    set({ overrides: { ...ov, notes: { ...ov.notes, [id]: note } } });
    get().log('Observación registrada', id + ': ' + note.slice(0, 80), [id]);
  },

  audit: [],
  log(action, detail, targets = []) {
    set({
      audit: [
        { id: 'L' + (get().audit.length + 1), at: new Date(), action, detail, targets },
        ...get().audit,
      ].slice(0, 500),
    });
  },

  filters: { ...EMPTY_FILTERS },
  setFilter(key, value) {
    set({ filters: { ...get().filters, [key]: value } });
  },
  resetFilters() {
    set({ filters: { ...EMPTY_FILTERS } });
  },

  selectedThirdParty: null,
  selectThirdParty: (key) => set({ selectedThirdParty: key }),
}));
