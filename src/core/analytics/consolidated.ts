/**
 * Conciliación consolidada: todos los extractos del mes contra un auxiliar
 * que trae todas las cuentas de bancos.
 *
 * Cada extracto se asigna a su cuenta (automático por número de cuenta / banco,
 * o elegida por el usuario), se concilia con el mismo motor que el modo
 * detalle y se resume en una fila por cuenta. Además se buscan hallazgos que
 * sólo se ven mirando todas las cuentas juntas: cuentas sin extracto,
 * extractos sin cuenta, dos extractos en la misma cuenta y embargos por el
 * mismo valor en bancos distintos.
 */

import type { BankTx, ColumnMapping, Dataset, LedgerAccount, LedgerTx, RawSheet, ReconciliationResult } from '../types';
import type { LoadedFile } from '../parsing/loadFile';
import { bankAccountHint } from '../parsing/loadFile';
import { detectMapping } from '../parsing/columnMap';
import {
  accountKey,
  buildBankDataset,
  buildLedgerDataset,
  filterLedgerByAccount,
  guessLedgerAccount,
  type BuildOptions,
} from '../parsing/buildDataset';
import { reconcile } from '../reconciliation/engine';
import type { ReconciliationConfig } from '../reconciliation/config';
import { computeKpis, type Kpis } from './kpis';
import { buildStatement, type ReconciliationStatement } from './statement';
import { normalizeText } from '../normalize/text';
import { round2 } from '../normalize/money';
import { formatDate } from '../normalize/dates';

export interface StatementInput {
  id: string;
  fileName: string;
  file: LoadedFile;
  /** 'auto' = por número de cuenta / banco; código = elegido; null = sin asignar. */
  accountChoice: 'auto' | string | null;
}

export type AccountState = 'cuadra' | 'explicada' | 'sin_explicar' | 'sin_extracto' | 'error';

export interface Embargo {
  date: Date | null;
  description: string;
  amount: number;
  /** Cómo quedó en libros (si se cruzó). */
  ledger: string;
}

export interface AccountReconciliation {
  accountCode: string;
  accountName: string;
  statementId: string | null;
  fileName: string;
  bankName: string;
  /** La cuenta se eligió automáticamente para este extracto. */
  auto: boolean;
  state: AccountState;
  error?: string;
  saldoLibros: number | null;
  saldoBanco: number | null;
  diferencia: number | null;
  sinExplicar: number | null;
  porcentaje: number | null;
  partidasBanco: number;
  partidasContables: number;
  movimientosBanco: number;
  movimientosLibros: number;
  saldoBancoOrigen: Kpis['saldoBancoOrigen'] | null;
  embargos: Embargo[];
  /** Datos completos para exportar / abrir el detalle. */
  detail?: {
    bank: BankTx[];
    ledger: LedgerTx[];
    result: ReconciliationResult;
    kpis: Kpis;
    statement: ReconciliationStatement;
  };
}

export type FindingLevel = 'alta' | 'media' | 'info';

export interface Finding {
  level: FindingLevel;
  title: string;
  detail: string;
  accounts: string[];
  value: number | null;
}

export interface ConsolidatedResult {
  rows: AccountReconciliation[];
  /** Extractos que no se pudieron asignar a ninguna cuenta. */
  unassigned: { statementId: string; fileName: string; reason: string }[];
  findings: Finding[];
  totals: { saldoLibros: number; saldoBanco: number; diferencia: number; sinExplicar: number };
  runAt: Date;
}

export interface ConsolidatedInput {
  ledgerSheet: RawSheet;
  ledgerMapping: ColumnMapping;
  buildOptions: BuildOptions;
  statements: StatementInput[];
  config: ReconciliationConfig;
  /** Se llama antes de procesar cada extracto (para mostrar progreso). */
  onProgress?: (done: number, total: number, label: string) => Promise<void> | void;
}

function finalLedgerBalance(rows: LedgerTx[], opening: number | null): number {
  const withBal = rows
    .filter((r) => r.balance !== null && Number.isFinite(r.balance))
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0) || a.rowIndex - b.rowIndex);
  if (withBal.length) return round2(withBal[withBal.length - 1].balance as number);
  return round2((opening ?? 0) + rows.reduce((a, r) => a + r.amount, 0));
}

/** Nombre corto del banco a partir del nombre de la cuenta contable. */
export function bankLabel(accountName: string, fallback = ''): string {
  const t = normalizeText(accountName);
  const known = [
    'BANCOLOMBIA', 'OCCIDENTE', 'AGRARIO', 'SERFINANZAS', 'DAVIVIENDA', 'BBVA', 'BOGOTA', 'POPULAR',
    'AV VILLAS', 'ITAU', 'COLPATRIA', 'CAJA SOCIAL', 'BANCOOMEVA', 'GNB', 'FALABELLA', 'PICHINCHA',
  ];
  const k = known.find((w) => t.includes(w));
  return k ? k.charAt(0) + k.slice(1).toLowerCase() : fallback || accountName;
}

export async function reconcileAll(input: ConsolidatedInput): Promise<ConsolidatedResult> {
  const full = buildLedgerDataset(input.ledgerSheet, input.ledgerMapping, input.buildOptions);
  const accounts: LedgerAccount[] =
    full.accounts && full.accounts.length
      ? full.accounts
      : [{ code: '', name: 'Auxiliar completo', movements: full.rows.length, openingBalance: full.stats.openingBalance }];

  // 1. Asignación extracto -> cuenta
  const assigned = new Map<string, { st: StatementInput; auto: boolean }[]>();
  const unassigned: ConsolidatedResult['unassigned'] = [];
  for (const st of input.statements) {
    // Extractos sin movimientos (fiducias, inversiones sin movimiento en el mes) no se concilian.
    const probe = buildBankDataset(st.file.sheet, detectMapping(st.file.sheet, 'bank').mapping, input.buildOptions);
    if (!probe.rows.length && st.accountChoice === 'auto') {
      unassigned.push({
        statementId: st.id,
        fileName: st.fileName,
        reason:
          'No tiene movimientos legibles (por ejemplo, extracto de fiducia o inversión sin movimientos en el mes). Si debe conciliarse, asígnele la cuenta manualmente.',
      });
      continue;
    }
    let code: string | null = null;
    let auto = false;
    if (st.accountChoice === 'auto') {
      code = accounts.length === 1 ? accounts[0].code : guessLedgerAccount(accounts, bankAccountHint(st.file));
      auto = true;
    } else {
      code = st.accountChoice;
    }
    if (code === null || !accounts.some((a) => a.code === code)) {
      unassigned.push({
        statementId: st.id,
        fileName: st.fileName,
        reason: st.accountChoice === 'auto' ? 'No se identificó la cuenta: elíjala manualmente.' : 'Sin cuenta asignada.',
      });
      continue;
    }
    assigned.set(code, [...(assigned.get(code) ?? []), { st, auto }]);
  }

  // 2. Conciliación por cuenta
  const rows: AccountReconciliation[] = [];
  let done = 0;
  const total = input.statements.length;
  for (const acc of accounts) {
    const ledgerDs: Dataset<LedgerTx> = acc.code ? filterLedgerByAccount(full, acc.code) : full;
    const list = assigned.get(acc.code) ?? [];
    const base = {
      accountCode: acc.code,
      accountName: acc.name,
      movimientosLibros: ledgerDs.rows.length,
      embargos: [] as Embargo[],
    };

    if (!list.length) {
      rows.push({
        ...base,
        statementId: null,
        fileName: '',
        bankName: bankLabel(acc.name),
        auto: false,
        state: 'sin_extracto',
        saldoLibros: finalLedgerBalance(ledgerDs.rows, acc.openingBalance),
        saldoBanco: null,
        diferencia: null,
        sinExplicar: null,
        porcentaje: null,
        partidasBanco: 0,
        partidasContables: 0,
        movimientosBanco: 0,
        saldoBancoOrigen: null,
      });
      continue;
    }

    for (const { st, auto } of list) {
      await input.onProgress?.(done, total, 'Conciliando ' + st.fileName + '…');
      done++;
      try {
        const mapping = detectMapping(st.file.sheet, 'bank').mapping;
        const bankDs = buildBankDataset(st.file.sheet, mapping, input.buildOptions);
        if (!bankDs.rows.length) throw new Error('No se leyó ningún movimiento del extracto.');
        const result = reconcile({ bank: bankDs.rows, ledger: ledgerDs.rows, config: input.config });
        const kpis = computeKpis(bankDs.rows, ledgerDs.rows, result, {
          bankOpening: bankDs.stats.openingBalance,
          ledgerOpening: ledgerDs.stats.openingBalance,
        });
        const statement = buildStatement(bankDs.rows, ledgerDs.rows, result, kpis);
        const ledgerById = new Map(ledgerDs.rows.map((l) => [l.id, l]));
        const embargos: Embargo[] = bankDs.rows
          .filter((b) => /EMBARG/.test(normalizeText(b.description)))
          .map((b) => {
            const m = result.byBank.get(b.id);
            const l = m ? ledgerById.get(m.ledgerId) : undefined;
            return {
              date: b.date,
              description: b.description,
              amount: b.amount,
              ledger: l ? (l.thirdPartyName || 'sin tercero') + ' ' + l.documentNumber + ' (' + formatDate(l.date) + ')' : 'No registrado en libros',
            };
          });
        const sin = kpis.diferenciaSinExplicar;
        rows.push({
          ...base,
          embargos,
          statementId: st.id,
          fileName: st.fileName,
          bankName: st.file.pdf?.statement?.bank || bankLabel(acc.name),
          auto,
          state: Math.abs(sin) >= 1 ? 'sin_explicar' : Math.abs(kpis.diferencia) < 1 ? 'cuadra' : 'explicada',
          saldoLibros: kpis.saldoContable,
          saldoBanco: kpis.saldoBanco,
          diferencia: kpis.diferencia,
          sinExplicar: sin,
          porcentaje: kpis.porcentajeConciliacion,
          partidasBanco: kpis.partidasBanco,
          partidasContables: kpis.partidasContables,
          movimientosBanco: bankDs.rows.length,
          saldoBancoOrigen: kpis.saldoBancoOrigen,
          detail: { bank: bankDs.rows, ledger: ledgerDs.rows, result, kpis, statement },
        });
      } catch (e) {
        rows.push({
          ...base,
          statementId: st.id,
          fileName: st.fileName,
          bankName: bankLabel(acc.name),
          auto,
          state: 'error',
          error: (e as Error).message,
          saldoLibros: finalLedgerBalance(ledgerDs.rows, acc.openingBalance),
          saldoBanco: null,
          diferencia: null,
          sinExplicar: null,
          porcentaje: null,
          partidasBanco: 0,
          partidasContables: 0,
          movimientosBanco: 0,
          saldoBancoOrigen: null,
        });
      }
    }
  }

  // 3. Hallazgos que cruzan cuentas
  const findings: Finding[] = [];
  const label = (r: AccountReconciliation) => r.accountCode + ' ' + (r.bankName || r.accountName);

  for (const r of rows) {
    if (r.state === 'sin_explicar') {
      findings.push({
        level: 'alta',
        title: 'Diferencia sin explicar',
        detail: label(r) + ': quedan ' + (r.sinExplicar ?? 0).toLocaleString('es-CO') + ' sin explicar después de las partidas conciliatorias. Revise el saldo inicial del extracto y las partidas del mes anterior.',
        accounts: [r.accountCode],
        value: r.sinExplicar,
      });
    }
    if (r.state === 'error') {
      findings.push({ level: 'alta', title: 'Extracto no procesado', detail: r.fileName + ': ' + r.error, accounts: [r.accountCode], value: null });
    }
    if (r.saldoBancoOrigen === 'supuesto') {
      findings.push({
        level: 'info',
        title: 'Saldo del banco calculado',
        detail: label(r) + ': el extracto no trae saldo; se asumió el saldo inicial del auxiliar. Confirme con el extracto oficial.',
        accounts: [r.accountCode],
        value: null,
      });
    }
    for (const e of r.embargos) {
      findings.push({
        level: 'alta',
        title: 'Embargo',
        detail: label(r) + ' · ' + formatDate(e.date) + ' · ' + e.description + ' · En libros: ' + e.ledger + '. Identifique la entidad embargante y registre el embargo contra ella.',
        accounts: [r.accountCode],
        value: e.amount,
      });
    }
  }

  // Embargos por el mismo valor en dos bancos distintos (total por banco o movimiento individual).
  const embargoAccounts = rows.filter((r) => r.embargos.length);
  for (let i = 0; i < embargoAccounts.length; i++) {
    for (let j = i + 1; j < embargoAccounts.length; j++) {
      const a = embargoAccounts[i];
      const b = embargoAccounts[j];
      if (a.accountCode === b.accountCode) continue;
      const amountsA = [round2(a.embargos.reduce((s, e) => s + e.amount, 0)), ...a.embargos.map((e) => e.amount)];
      const amountsB = [round2(b.embargos.reduce((s, e) => s + e.amount, 0)), ...b.embargos.map((e) => e.amount)];
      const hit = amountsA.find((x) => amountsB.some((y) => Math.abs(x - y) < 1));
      if (hit !== undefined) {
        findings.unshift({
          level: 'alta',
          title: 'Posible embargo cobrado dos veces',
          detail:
            label(a) + ' y ' + label(b) + ' debitaron embargos por el mismo valor (' + Math.abs(hit).toLocaleString('es-CO') +
            '). Si es la misma orden, solicite a la entidad embargante la devolución de lo cobrado de más.',
          accounts: [a.accountCode, b.accountCode],
          value: hit,
        });
      }
    }
  }

  for (const r of rows.filter((x) => x.state === 'sin_extracto')) {
    findings.push({
      level: 'media',
      title: 'Cuenta sin extracto',
      detail: label(r) + ' (saldo en libros ' + (r.saldoLibros ?? 0).toLocaleString('es-CO') + '): cargue el extracto del mes para conciliarla.',
      accounts: [r.accountCode],
      value: r.saldoLibros,
    });
  }
  for (const u of unassigned) {
    findings.push({ level: 'media', title: 'Extracto sin cuenta', detail: u.fileName + ': ' + u.reason, accounts: [], value: null });
  }
  const dupAcc = rows.reduce((m, r) => (r.statementId ? m.set(r.accountCode, (m.get(r.accountCode) ?? 0) + 1) : m), new Map<string, number>());
  for (const [code, count] of dupAcc) {
    if (count > 1) {
      findings.push({
        level: 'media',
        title: 'Dos extractos en la misma cuenta',
        detail: 'La cuenta ' + code + ' recibió ' + count + ' extractos. Si son copias del mismo extracto, quite una; si son dos cuentas bancarias distintas, asigne la correcta.',
        accounts: [code],
        value: null,
      });
    }
  }

  const order: Record<FindingLevel, number> = { alta: 0, media: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);

  const sum = (f: (r: AccountReconciliation) => number | null) => round2(rows.reduce((a, r) => a + (f(r) ?? 0), 0));
  const conc = rows.filter((r) => r.saldoBanco !== null);
  return {
    rows,
    unassigned,
    findings,
    totals: {
      saldoLibros: sum((r) => r.saldoLibros),
      saldoBanco: round2(conc.reduce((a, r) => a + (r.saldoBanco ?? 0), 0)),
      diferencia: round2(conc.reduce((a, r) => a + (r.diferencia ?? 0), 0)),
      sinExplicar: round2(conc.reduce((a, r) => a + (r.sinExplicar ?? 0), 0)),
    },
    runAt: new Date(),
  };
}

export { accountKey };
