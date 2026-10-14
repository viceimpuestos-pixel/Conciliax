/**
 * Consolidado de bancos: todos los extractos del mes contra el auxiliar que
 * trae todas las cuentas. Una fila por cuenta, hallazgos que cruzan cuentas y
 * acceso al detalle de cada una.
 */

import React, { useRef } from 'react';
import { useStore } from '../../state/store';
import type { AccountReconciliation, AccountState } from '../../core/analytics/consolidated';
import { exportConsolidated } from '../../core/export/excel';
import { ACCEPTED_EXTENSIONS, bankAccountHint } from '../../core/parsing/loadFile';
import { buildLedgerDataset } from '../../core/parsing/buildDataset';
import { formatMoney, formatNumber, formatPercent } from '../../core/normalize/money';
import { Card, EmptyState, IconAlert, IconBank, IconDownload, IconFile, IconPlay, IconTrash, IconUpload, Notice } from '../components/primitives';

const STATE: Record<AccountState, { label: string; cls: string }> = {
  cuadra: { label: 'Cuadra', cls: 'CONCILIADO' },
  explicada: { label: 'Explicada por partidas', cls: 'PROBABLE' },
  sin_explicar: { label: 'Sin explicar', cls: 'DIF_VALOR' },
  sin_extracto: { label: 'Falta extracto', cls: 'NO_CONCILIADO' },
  error: { label: 'Error de lectura', cls: 'DUPLICADO' },
};

export function ConsolidatedPage() {
  const ledger = useStore((s) => s.ledger);
  const buildOptions = useStore((s) => s.buildOptions);
  const c = useStore((s) => s.consolidated);
  const loadLedgerFile = useStore((s) => s.loadLedgerFile);
  const addFiles = useStore((s) => s.addConsolidatedFiles);
  const remove = useStore((s) => s.removeConsolidated);
  const setAccount = useStore((s) => s.setConsolidatedAccount);
  const runAll = useStore((s) => s.runConsolidated);
  const openDetail = useStore((s) => s.openConsolidatedDetail);
  const log = useStore((s) => s.log);
  const ledgerInput = useRef<HTMLInputElement>(null);
  const bankInput = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = React.useState<string | null>(null);

  const accounts = React.useMemo(() => {
    if (!ledger.file) return [];
    try {
      return buildLedgerDataset(ledger.file.sheet, ledger.mapping, buildOptions).accounts ?? [];
    } catch {
      return [];
    }
  }, [ledger.file, ledger.mapping, buildOptions]);

  const res = c.result;
  const rowFor = (statementId: string) => res?.rows.find((r) => r.statementId === statementId);
  const high = res?.findings.filter((f) => f.level === 'alta').length ?? 0;
  const conciliadas = res?.rows.filter((r) => r.statementId && r.state !== 'error').length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Consolidado de bancos</h2>
          <div className="sub">
            Cargue el auxiliar con todas las cuentas de bancos y los extractos del mes: cada extracto se asigna a su cuenta y se
            concilia por separado.
          </div>
        </div>
        <div className="actions">
          {res && (
            <button
              className="btn"
              onClick={() => {
                const name = exportConsolidated(res, ledger.fileName);
                log('Exportación consolidado', name);
              }}
            >
              <IconDownload size={15} /> Exportar Excel
            </button>
          )}
          <button
            className="btn primary"
            disabled={!ledger.file || !c.statements.length || !!c.progress}
            onClick={() => void runAll()}
          >
            <IconPlay size={14} /> Conciliar todo
          </button>
        </div>
      </div>

      {c.error && <Notice type="error">{c.error}</Notice>}
      {c.progress && <Notice type="info">{c.progress}</Notice>}

      <div className="chart-grid mb-16">
        {/* Auxiliar */}
        <div className="span-6">
          <Card
            title="1. Auxiliar contable"
            subtitle={ledger.file ? ledger.fileName : 'Libro auxiliar con todas las cuentas de bancos (1110…)'}
            right={
              <button className="btn sm" onClick={() => ledgerInput.current?.click()}>
                <IconUpload size={14} /> {ledger.file ? 'Cambiar' : 'Cargar'}
              </button>
            }
          >
            <input
              ref={ledgerInput}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadLedgerFile(f);
                e.target.value = '';
              }}
            />
            {!ledger.file ? (
              <EmptyState icon={<IconFile size={24} />} title="Sin auxiliar" description="Cargue el libro auxiliar del mes." />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Nombre</th>
                    <th style={{ textAlign: 'right' }}>Movimientos</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.code}>
                      <td className="tnum">{a.code}</td>
                      <td>{a.name || '—'}</td>
                      <td className="tnum" style={{ textAlign: 'right' }}>{formatNumber(a.movements)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* Extractos */}
        <div className="span-6">
          <Card
            title="2. Extractos del mes"
            subtitle="PDF, Excel o CSV de cada banco · puede seleccionar varios a la vez"
            right={
              <button className="btn sm" onClick={() => bankInput.current?.click()}>
                <IconUpload size={14} /> Agregar extractos
              </button>
            }
          >
            <input
              ref={bankInput}
              type="file"
              multiple
              accept={ACCEPTED_EXTENSIONS}
              style={{ display: 'none' }}
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                if (fs.length) void addFiles(fs);
                e.target.value = '';
              }}
            />
            {!c.statements.length ? (
              <EmptyState icon={<IconBank size={24} />} title="Sin extractos" description="Agregue los extractos de todos los bancos del mes." />
            ) : (
              <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Extracto</th>
                    <th>Cuenta del auxiliar</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {c.statements.map((s) => {
                    const hint = bankAccountHint(s.file);
                    const r = rowFor(s.id);
                    const autoLabel = r && s.accountChoice === 'auto' ? ' → ' + r.accountCode + ' ' + r.bankName : '';
                    return (
                      <tr key={s.id}>
                        <td>
                          <div>{s.fileName}</div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {[s.file.pdf?.statement?.bank, hint.accountNumber && 'cta ' + hint.accountNumber, s.file.pdf?.statement && s.file.pdf.statement.validated + ' mov. validados']
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </td>
                        <td>
                          <select
                            value={s.accountChoice ?? '__none'}
                            onChange={(e) => setAccount(s.id, e.target.value === '__none' ? null : e.target.value)}
                            style={{ width: '100%', maxWidth: 230 }}
                          >
                            <option value="auto">Automático{autoLabel}</option>
                            {accounts.map((a) => (
                              <option key={a.code} value={a.code}>
                                {a.code} · {a.name}
                              </option>
                            ))}
                            <option value="__none">No conciliar</option>
                          </select>
                        </td>
                        <td>
                          <button className="icon-btn" title="Quitar" onClick={() => remove(s.id)}>
                            <IconTrash size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
            {res?.unassigned.map((u) => (
              <div key={u.statementId} className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {u.fileName}: {u.reason}
              </div>
            ))}
          </Card>
        </div>
      </div>

      {res && (
        <>
          <div className="kpi-grid">
            <Kpi label="Cuentas conciliadas" value={conciliadas + ' de ' + res.rows.length} tone={conciliadas === res.rows.length ? 'green' : 'amber'} />
            <Kpi label="Saldo en libros (todas)" value={formatMoney(res.totals.saldoLibros)} tone="blue" />
            <Kpi label="Saldo en bancos (conciliadas)" value={formatMoney(res.totals.saldoBanco)} tone="navy" />
            <Kpi
              label="Diferencia sin explicar"
              value={formatMoney(Math.abs(res.totals.sinExplicar) < 0.005 ? 0 : res.totals.sinExplicar, true)}
              tone={Math.abs(res.totals.sinExplicar) < 1 ? 'green' : 'red'}
            />
            <Kpi label="Hallazgos prioritarios" value={formatNumber(high)} tone={high ? 'red' : 'green'} />
          </div>

          <Card title="Conciliación por cuenta" subtitle="Saldo en libros vs. saldo del extracto de cada banco" flush>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Banco / extracto</th>
                    <th style={{ textAlign: 'right' }}>Saldo libros</th>
                    <th style={{ textAlign: 'right' }}>Saldo banco</th>
                    <th style={{ textAlign: 'right' }}>Diferencia</th>
                    <th style={{ textAlign: 'right' }}>Sin explicar</th>
                    <th style={{ textAlign: 'right' }}>Conciliado</th>
                    <th style={{ textAlign: 'right' }}>Partidas</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r, i) => (
                    <AccountRow
                      key={r.accountCode + '-' + i}
                      r={r}
                      busy={opening === r.statementId}
                      onOpen={async () => {
                        if (!r.statementId) return;
                        setOpening(r.statementId);
                        await openDetail(r.statementId);
                        setOpening(null);
                      }}
                    />
                  ))}
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 600 }}>Total</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(res.totals.saldoLibros)}</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(res.totals.saldoBanco)}</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(res.totals.diferencia, true)}</td>
                    <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(Math.abs(res.totals.sinExplicar) < 0.005 ? 0 : res.totals.sinExplicar, true)}</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-16">
            <Card title="Hallazgos" subtitle="Lo que hay que revisar, mirando todas las cuentas juntas">
              {!res.findings.length ? (
                <Notice type="success">Sin hallazgos: todas las cuentas cuadran o quedan explicadas.</Notice>
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  {res.findings.map((f, i) => (
                    <Notice key={i} type={f.level === 'alta' ? 'error' : f.level === 'media' ? 'warning' : 'info'}>
                      <strong>{f.title}</strong>
                      {f.value !== null && <> · {formatMoney(f.value, true)}</>}
                      <div style={{ fontSize: 12, marginTop: 2 }}>{f.detail}</div>
                    </Notice>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function AccountRow({ r, onOpen, busy }: { r: AccountReconciliation; onOpen: () => void; busy: boolean }) {
  const st = STATE[r.state];
  const money = (v: number | null, dec = false) =>
    v === null ? <span className="muted">—</span> : formatMoney(Math.abs(v) < 0.005 ? 0 : v, dec);
  return (
    <tr>
      <td className="tnum">{r.accountCode}</td>
      <td>
        <div>{r.bankName || r.accountName}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {r.fileName || 'Sin extracto'}
          {r.auto && ' · asignado automáticamente'}
          {r.saldoBancoOrigen === 'supuesto' && ' · saldo del banco calculado'}
        </div>
      </td>
      <td className="tnum" style={{ textAlign: 'right' }}>{money(r.saldoLibros)}</td>
      <td className="tnum" style={{ textAlign: 'right' }}>{money(r.saldoBanco)}</td>
      <td className="tnum" style={{ textAlign: 'right' }}>{money(r.diferencia, true)}</td>
      <td className="tnum" style={{ textAlign: 'right', color: r.sinExplicar && Math.abs(r.sinExplicar) >= 1 ? 'var(--red-600)' : undefined }}>
        {money(r.sinExplicar, true)}
      </td>
      <td className="tnum" style={{ textAlign: 'right' }}>{r.porcentaje === null ? '—' : formatPercent(r.porcentaje)}</td>
      <td className="tnum" style={{ textAlign: 'right' }}>
        {r.statementId ? formatNumber(r.partidasBanco + r.partidasContables) : '—'}
      </td>
      <td>
        <span className={'badge ' + st.cls}>
          <span className="dot" />
          {st.label}
        </span>
        {r.embargos.length > 0 && (
          <span className="badge DIF_VALOR" style={{ marginLeft: 4 }} title="Embargos debitados por el banco">
            <IconAlert size={11} /> {r.embargos.length} embargo{r.embargos.length > 1 ? 's' : ''}
          </span>
        )}
      </td>
      <td>
        {r.statementId && r.state !== 'error' && (
          <button className="btn sm" onClick={onOpen} disabled={busy}>
            {busy ? 'Abriendo…' : 'Ver detalle'}
          </button>
        )}
      </td>
    </tr>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'navy' | 'grey' }) {
  return (
    <div className={'kpi ' + tone}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
