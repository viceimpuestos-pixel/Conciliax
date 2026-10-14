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
  DianDataset,
  DianManualOverrides,
  DianReconciliationResult,
  LedgerTx,
  ManualOverrides,
  MatchStatus,
  ReconciliationResult,
} from '../core/types';
import { EMPTY_DIAN_OVERRIDES, EMPTY_OVERRIDES } from '../core/types';
import { loadFile, loadBuffer, bankAccountHint, type LoadedFile } from '../core/parsing/loadFile';
import { detectMapping, type DetectionInfo } from '../core/parsing/columnMap';
import { buildBankDataset, buildDianDataset, buildLedgerDataset, filterLedgerByAccount, guessLedgerAccount, type BuildOptions } from '../core/parsing/buildDataset';
import { reconcile, pairKey } from '../core/reconciliation/engine';
import { DEFAULT_CONFIG, cloneConfig, type ReconciliationConfig } from '../core/reconciliation/config';
import {
  DEFAULT_DIAN_CONFIG,
  cloneDianConfig,
  dianPairKey,
  reconcileDian,
  type DianConfig,
} from '../core/reconciliation/dianEngine';
import { generateDemoSheets } from '../core/demo/sampleData';
import { generateDianDemoSheets } from '../core/demo/dianSampleData';
import { reconcileAll, type ConsolidatedResult, type StatementInput } from '../core/analytics/consolidated';

export type Section =
  | 'consolidado'
  | 'dashboard'
  | 'importar'
  | 'conciliacion'
  | 'terceros'
  | 'contable'
  | 'alertas'
  | 'reportes'
  | 'dian'
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
  /**
   * Saldo inicial del extracto digitado por el usuario (cuando el archivo no
   * trae columna de saldo). null = usar el del archivo o asumir el del auxiliar.
   */
  bankOpeningBalance: number | null;
  setBankOpeningBalance: (v: number | null) => void;
  /**
   * Cuenta del auxiliar a conciliar cuando el archivo trae varias (p. ej. 1110
   * con todos los bancos). 'auto' = se elige por el número de cuenta / banco del
   * extracto; un código = elegida por el usuario; null = todas.
   */
  ledgerAccount: 'auto' | string | null;
  setLedgerAccount: (v: 'auto' | string | null) => void;
  /** Cuenta efectivamente usada en la última construcción del auxiliar. */
  ledgerAccountUsed: string | null;

  /* Consolidado: todos los extractos del mes contra el auxiliar */
  consolidated: {
    statements: StatementInput[];
    result: ConsolidatedResult | null;
    progress: string | null;
    error: string | null;
  };
  addConsolidatedFiles: (files: File[]) => Promise<void>;
  removeConsolidated: (id: string) => void;
  setConsolidatedAccount: (id: string, choice: 'auto' | string | null) => void;
  runConsolidated: () => Promise<void>;
  /** Abre una cuenta del consolidado en el modo detalle (dashboard, conciliación, alertas…). */
  openConsolidatedDetail: (statementId: string) => Promise<void>;

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

  /* ---------------------------------------------------------------- */
  /* Módulo DIAN vs. auxiliar contable                                  */
  /* ---------------------------------------------------------------- */

  dianDoc: ImportSlot;
  dianLedger: ImportSlot;
  dianBuildOptions: BuildOptions;
  setDianBuildOptions: (o: Partial<BuildOptions>) => void;

  dianDataset: DianDataset | null;
  dianLedgerDataset: Dataset<LedgerTx> | null;

  dianProgress: Progress | null;
  dianError: string | null;
  dianWarnings: string[];

  loadDianDocFile: (file: File) => Promise<void>;
  loadDianLedgerFile: (file: File) => Promise<void>;
  reloadDianWithSheet: (which: 'dianDoc' | 'dianLedger', sheetName?: string, headerRowIndex?: number) => Promise<void>;
  setDianMapping: (which: 'dianDoc' | 'dianLedger', field: string, columnIndex: number) => void;
  autoDetectDian: (which: 'dianDoc' | 'dianLedger') => void;
  buildDianDatasets: () => void;
  loadDianDemo: () => Promise<void>;
  clearDian: () => void;
  backToDianImport: () => void;

  dianConfig: DianConfig;
  setDianConfig: (c: DianConfig) => void;
  dianOverrides: DianManualOverrides;
  dianResult: DianReconciliationResult | null;
  dianLastRunAt: Date | null;
  runDian: () => Promise<void>;

  acceptDianMatch: (dianId: string, ledgerId: string) => void;
  rejectDianMatch: (dianId: string, ledgerId: string) => void;
  linkDianManual: (dianId: string, ledgerId: string) => void;
  unlinkDian: (dianId: string) => void;
  toggleIgnoreDian: (kind: 'dian' | 'ledger', id: string) => void;
  setDianNote: (id: string, note: string) => void;
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
        // Extracto nuevo: se vuelve a detectar la cuenta del auxiliar y su saldo inicial.
        ledgerAccount: 'auto',
        bankOpeningBalance: null,
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
    const fullLedger = buildLedgerDataset(ledger.file.sheet, ledger.mapping, buildOptions);
    const accounts = fullLedger.accounts ?? [];
    const choice = get().ledgerAccount;
    let code: string | null = null;
    if (accounts.length > 1) {
      code = choice === 'auto' ? guessLedgerAccount(accounts, bankAccountHint(bank.file)) : choice;
      if (code && !accounts.some((a) => a.code === code)) code = null;
    }
    const ledgerDataset = filterLedgerByAccount(fullLedger, code);
    if (accounts.length > 1 && !code) {
      ledgerDataset.issues = [
        {
          level: 'error',
          code: 'AUX_MULTICUENTA',
          message:
            'El auxiliar trae ' + accounts.length + ' cuentas de bancos y no se pudo identificar cuál corresponde a este extracto. ' +
            'Elija la cuenta en "Cuenta del auxiliar a conciliar": conciliar un extracto contra todas las cuentas mezcla bancos.',
        },
        ...ledgerDataset.issues,
      ];
    }
    set({ bankDataset, ledgerDataset, ledgerAccountUsed: code });
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

  ledgerAccount: 'auto',
  ledgerAccountUsed: null,
  setLedgerAccount: (v) => {
    set({ ledgerAccount: v, bankOpeningBalance: null });
    get().buildDatasets();
    const acc = get().ledgerDataset?.accounts?.find((a) => a.code === get().ledgerAccountUsed);
    get().log('Cuenta del auxiliar', acc ? acc.code + ' ' + acc.name : 'Todas las cuentas');
  },

  consolidated: { statements: [], result: null, progress: null, error: null },

  async addConsolidatedFiles(files) {
    const c = get().consolidated;
    set({ consolidated: { ...c, error: null, progress: 'Leyendo ' + files.length + ' extracto(s)…' } });
    const added: StatementInput[] = [];
    const errors: string[] = [];
    for (const f of files) {
      try {
        const loaded = await loadFile(f);
        if (loaded.pdf?.scanned) throw new Error('el PDF es una imagen escaneada (requiere OCR)');
        added.push({ id: 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), fileName: f.name, file: loaded, accountChoice: 'auto' });
      } catch (e) {
        errors.push(f.name + ': ' + (e as Error).message);
      }
    }
    const cur = get().consolidated;
    set({
      consolidated: {
        ...cur,
        statements: [...cur.statements, ...added],
        result: null,
        progress: null,
        error: errors.length ? 'No se pudieron leer: ' + errors.join(' · ') : null,
      },
    });
    get().log('Consolidado: extractos cargados', added.map((a) => a.fileName).join(', '));
  },

  removeConsolidated(id) {
    const c = get().consolidated;
    set({ consolidated: { ...c, statements: c.statements.filter((s) => s.id !== id), result: null } });
  },

  setConsolidatedAccount(id, choice) {
    const c = get().consolidated;
    set({
      consolidated: { ...c, statements: c.statements.map((s) => (s.id === id ? { ...s, accountChoice: choice } : s)) },
    });
    void get().runConsolidated();
  },

  async runConsolidated() {
    const { ledger, buildOptions, config } = get();
    const c = get().consolidated;
    if (!ledger.file) {
      set({ consolidated: { ...c, error: 'Cargue primero el auxiliar contable.' } });
      return;
    }
    if (!c.statements.length) {
      set({ consolidated: { ...c, error: 'Cargue al menos un extracto.' } });
      return;
    }
    set({ consolidated: { ...c, error: null, progress: 'Preparando…' } });
    await wait(30);
    try {
      const result = await reconcileAll({
        ledgerSheet: ledger.file.sheet,
        ledgerMapping: ledger.mapping,
        buildOptions,
        statements: c.statements,
        config,
        onProgress: async (done, total, label) => {
          set({ consolidated: { ...get().consolidated, progress: label + ' (' + (done + 1) + '/' + total + ')' } });
          await wait(20);
        },
      });
      set({ consolidated: { ...get().consolidated, result, progress: null } });
      get().log(
        'Conciliación consolidada',
        result.rows.filter((r) => r.statementId).length + ' cuentas conciliadas, ' + result.findings.length + ' hallazgos',
      );
    } catch (e) {
      set({ consolidated: { ...get().consolidated, progress: null, error: 'Error en el consolidado: ' + (e as Error).message } });
    }
  },

  async openConsolidatedDetail(statementId) {
    const c = get().consolidated;
    const st = c.statements.find((s) => s.id === statementId);
    const row = c.result?.rows.find((r) => r.statementId === statementId);
    if (!st || !row) return;
    const detection = detectMapping(st.file.sheet, 'bank');
    set({
      bank: { file: st.file, mapping: detection.mapping, detection, fileName: st.fileName },
      ledgerAccount: row.accountCode || null,
      bankOpeningBalance: null,
      overrides: { ...EMPTY_OVERRIDES },
    });
    await get().run();
    set({ section: 'dashboard' });
  },

  bankOpeningBalance: null,
  setBankOpeningBalance: (v) => {
    set({ bankOpeningBalance: v });
    get().log('Saldo inicial del banco', v === null ? 'Se usa el saldo inicial del auxiliar' : String(v));
  },

  clearAll() {
    set({
      bankOpeningBalance: null,
      ledgerAccount: 'auto',
      ledgerAccountUsed: null,
      consolidated: { statements: [], result: null, progress: null, error: null },
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

  /* ---------------------------------------------------------------- */
  /* Módulo DIAN vs. auxiliar contable                                  */
  /* ---------------------------------------------------------------- */

  dianDoc: emptySlot(),
  dianLedger: emptySlot(),
  // Por defecto se asume un auxiliar de INGRESOS (cuenta 41xx): crédito = ingreso.
  dianBuildOptions: { dateOrder: 'auto', decimalHint: 'auto', ledgerSign: 'credito-ingreso', dropTotals: true },
  setDianBuildOptions: (o) => set({ dianBuildOptions: { ...get().dianBuildOptions, ...o } }),

  dianDataset: null,
  dianLedgerDataset: null,

  dianProgress: null,
  dianError: null,
  dianWarnings: [],

  async loadDianDocFile(file) {
    set({ dianError: null });
    try {
      const loaded = await loadFile(file);
      const detection = detectMapping(loaded.sheet, 'dian');
      set({
        dianDoc: { file: loaded, mapping: detection.mapping, detection, fileName: file.name },
        dianWarnings: [
          ...get().dianWarnings.filter((w) => !w.startsWith('DIAN:')),
          ...loaded.warnings.map((w) => 'DIAN: ' + w),
        ],
        dianResult: null,
      });
      get().log('Carga de reporte DIAN', file.name + ' (' + loaded.sheet.totalRows + ' filas)');
    } catch (e) {
      set({ dianError: 'No se pudo leer el reporte DIAN: ' + (e as Error).message });
    }
  },

  async loadDianLedgerFile(file) {
    set({ dianError: null });
    try {
      const loaded = await loadFile(file);
      const detection = detectMapping(loaded.sheet, 'ledger');
      set({
        dianLedger: { file: loaded, mapping: detection.mapping, detection, fileName: file.name },
        dianWarnings: [
          ...get().dianWarnings.filter((w) => !w.startsWith('Auxiliar:')),
          ...loaded.warnings.map((w) => 'Auxiliar: ' + w),
        ],
        dianResult: null,
      });
      get().log('Carga de auxiliar (DIAN)', file.name + ' (' + loaded.sheet.totalRows + ' filas)');
    } catch (e) {
      set({ dianError: 'No se pudo leer el auxiliar: ' + (e as Error).message });
    }
  },

  async reloadDianWithSheet(which, sheetName, headerRowIndex) {
    const slot = get()[which];
    if (!slot.file) return;
    const kind = which === 'dianDoc' ? 'dian' : 'ledger';
    const loaded = await loadBuffer(slot.file.buffer, slot.file.sheet.fileName, undefined, {
      sheetName: sheetName ?? slot.file.sheet.sheetName,
      headerRowIndex,
    });
    const detection = detectMapping(loaded.sheet, kind);
    set({ [which]: { ...slot, file: loaded, mapping: detection.mapping, detection } } as never);
  },

  setDianMapping(which, field, columnIndex) {
    const slot = get()[which];
    set({ [which]: { ...slot, mapping: { ...slot.mapping, [field]: columnIndex } } } as never);
  },

  autoDetectDian(which) {
    const slot = get()[which];
    if (!slot.file) return;
    const kind = which === 'dianDoc' ? 'dian' : 'ledger';
    const detection = detectMapping(slot.file.sheet, kind);
    set({ [which]: { ...slot, mapping: detection.mapping, detection } } as never);
  },

  buildDianDatasets() {
    const { dianDoc, dianLedger, dianBuildOptions } = get();
    if (!dianDoc.file || !dianLedger.file) return;
    const dianDataset = buildDianDataset(dianDoc.file.sheet, dianDoc.mapping, dianBuildOptions);
    const dianLedgerDataset = buildLedgerDataset(dianLedger.file.sheet, dianLedger.mapping, dianBuildOptions);
    set({ dianDataset, dianLedgerDataset });
  },

  async loadDianDemo() {
    set({ dianError: null, dianProgress: { step: 1, total: 3, label: 'Generando datos de demostración…', running: true } });
    await wait(60);
    const demo = generateDianDemoSheets();

    const docDetection = detectMapping(demo.dian, 'dian');
    const ledgerDetection = detectMapping(demo.ledger, 'ledger');

    set({
      dianDoc: {
        file: { format: 'excel', sheet: demo.dian, buffer: new ArrayBuffer(0), warnings: [] },
        mapping: docDetection.mapping,
        detection: docDetection,
        fileName: demo.dian.fileName,
      },
      dianLedger: {
        file: { format: 'excel', sheet: demo.ledger, buffer: new ArrayBuffer(0), warnings: [] },
        mapping: ledgerDetection.mapping,
        detection: ledgerDetection,
        fileName: demo.ledger.fileName,
      },
      dianOverrides: { ...EMPTY_DIAN_OVERRIDES },
      dianWarnings: ['Datos de demostración ficticios cargados. Ningún NIT, factura o valor corresponde a información real.'],
    });

    get().buildDianDatasets();
    get().log('Datos de demostración DIAN', demo.meta.documentos + ' documentos simulados');
    await get().runDian();
  },

  clearDian() {
    set({
      dianDoc: emptySlot(),
      dianLedger: emptySlot(),
      dianDataset: null,
      dianLedgerDataset: null,
      dianResult: null,
      dianOverrides: { ...EMPTY_DIAN_OVERRIDES },
      dianWarnings: [],
      dianError: null,
    });
  },

  backToDianImport() {
    set({ dianResult: null });
  },

  dianConfig: cloneDianConfig(DEFAULT_DIAN_CONFIG),
  setDianConfig: (c) => set({ dianConfig: c }),
  dianOverrides: { ...EMPTY_DIAN_OVERRIDES },
  dianResult: null,
  dianLastRunAt: null,

  async runDian() {
    set({ dianError: null, dianProgress: { step: 1, total: 3, label: 'Validando información…', running: true } });
    await wait(60);

    get().buildDianDatasets();
    const { dianDataset, dianLedgerDataset, dianConfig, dianOverrides } = get();

    if (!dianDataset || !dianLedgerDataset) {
      set({ dianProgress: null, dianError: 'Debe cargar y mapear el reporte DIAN y el auxiliar antes de conciliar.' });
      return;
    }

    set({ dianProgress: { step: 2, total: 3, label: 'Ejecutando conciliación…', running: true } });
    await wait(60);

    try {
      const dianResult = reconcileDian({
        dian: dianDataset.rows,
        ledger: dianLedgerDataset.rows,
        config: dianConfig,
        overrides: dianOverrides,
      });
      set({
        dianResult,
        dianLastRunAt: dianResult.runAt,
        dianProgress: { step: 3, total: 3, label: 'Conciliación finalizada', running: false },
      });
      get().log(
        'Conciliación DIAN ejecutada',
        dianResult.matches.length + ' cruces sobre ' + dianDataset.rows.length + ' documentos DIAN (' + dianResult.elapsedMs + ' ms)',
      );
      await wait(300);
      set({ dianProgress: null });
    } catch (e) {
      set({ dianProgress: null, dianError: 'Error durante la conciliación: ' + (e as Error).message });
    }
  },

  acceptDianMatch(dianId, ledgerId) {
    const ov = get().dianOverrides;
    const key = dianPairKey(dianId, ledgerId);
    set({
      dianOverrides: {
        ...ov,
        accepted: ov.accepted.includes(key) ? ov.accepted : [...ov.accepted, key],
        rejected: ov.rejected.filter((k) => k !== key),
      },
    });
    get().log('Coincidencia DIAN aceptada', dianId + ' ↔ ' + ledgerId, [dianId, ledgerId]);
    void get().runDian();
  },

  rejectDianMatch(dianId, ledgerId) {
    const ov = get().dianOverrides;
    const key = dianPairKey(dianId, ledgerId);
    set({
      dianOverrides: {
        ...ov,
        accepted: ov.accepted.filter((k) => k !== key),
        manualLinks: ov.manualLinks.filter((l) => l.dianId !== dianId),
        rejected: ov.rejected.includes(key) ? ov.rejected : [...ov.rejected, key],
      },
    });
    get().log('Coincidencia DIAN rechazada', dianId + ' ↔ ' + ledgerId, [dianId, ledgerId]);
    void get().runDian();
  },

  linkDianManual(dianId, ledgerId) {
    const ov = get().dianOverrides;
    set({
      dianOverrides: {
        ...ov,
        manualLinks: [...ov.manualLinks.filter((l) => l.dianId !== dianId && l.ledgerId !== ledgerId), { dianId, ledgerId }],
        rejected: ov.rejected.filter((k) => k !== dianPairKey(dianId, ledgerId)),
      },
    });
    get().log('Vinculación manual DIAN', dianId + ' ↔ ' + ledgerId, [dianId, ledgerId]);
    void get().runDian();
  },

  unlinkDian(dianId) {
    const { dianOverrides: ov, dianResult } = get();
    const current = dianResult?.byDian.get(dianId);
    const next: DianManualOverrides = {
      ...ov,
      accepted: ov.accepted.filter((k) => !k.startsWith(dianId + '|')),
      manualLinks: ov.manualLinks.filter((l) => l.dianId !== dianId),
    };
    if (current) {
      const key = dianPairKey(dianId, current.ledgerId);
      next.rejected = next.rejected.includes(key) ? next.rejected : [...next.rejected, key];
    }
    set({ dianOverrides: next });
    get().log('Desvinculación DIAN', dianId, [dianId]);
    void get().runDian();
  },

  toggleIgnoreDian(kind, id) {
    const ov = get().dianOverrides;
    const list = kind === 'dian' ? ov.ignoredDian : ov.ignoredLedger;
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    set({
      dianOverrides: kind === 'dian' ? { ...ov, ignoredDian: next } : { ...ov, ignoredLedger: next },
    });
    get().log(list.includes(id) ? 'Movimiento reactivado (DIAN)' : 'Movimiento ignorado (DIAN)', id, [id]);
    void get().runDian();
  },

  setDianNote(id, note) {
    const ov = get().dianOverrides;
    set({ dianOverrides: { ...ov, notes: { ...ov.notes, [id]: note } } });
    get().log('Observación registrada (DIAN)', id + ': ' + note.slice(0, 80), [id]);
  },
}));
