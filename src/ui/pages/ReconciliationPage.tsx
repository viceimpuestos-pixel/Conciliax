/**
 * Conciliación: revisión de los cruces y acciones manuales del usuario.
 */

import React, { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import {
  useBankRows,
  useFilteredBank,
  useFilteredLedger,
  useLedgerRows,
  useResult,
  type BankRowView,
  type LedgerRowView,
} from '../../state/selectors';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import {
  Card,
  Cell,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLink,
  IconNote,
  IconRefresh,
  IconTrash,
  IconUnlink,
  IconX,
  Modal,
  Notice,
  ScoreMeter,
  StatusBadge,
  Tooltip,
} from '../components/primitives';
import { formatDate } from '../../core/normalize/dates';
import { formatMoney } from '../../core/normalize/money';
import { formatNit } from '../../core/normalize/nit';
import { findBankCandidates, findCandidates } from '../../core/reconciliation/engine';
import type { BankTx, LedgerTx, MatchReason } from '../../core/types';

type Tab = 'banco' | 'contabilidad';

export function ReconciliationPage() {
  const [tab, setTab] = useState<Tab>('banco');
  const [detail, setDetail] = useState<{ kind: Tab; id: string } | null>(null);
  const [linkFor, setLinkFor] = useState<{ kind: Tab; id: string } | null>(null);

  const bankViews = useFilteredBank();
  const ledgerViews = useFilteredLedger();
  const run = useStore((s) => s.run);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Conciliación de movimientos</h2>
          <div className="sub">
            Revise cada cruce, acepte o rechace las sugerencias y vincule manualmente lo que el motor no encontró.
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void run()}>
            <IconRefresh size={15} /> Volver a conciliar
          </button>
        </div>
      </div>

      <FilterBar compact />

      <div className="tabs">
        <button className={'tab' + (tab === 'banco' ? ' on' : '')} onClick={() => setTab('banco')}>
          Movimientos bancarios <span className="count">{bankViews.length}</span>
        </button>
        <button className={'tab' + (tab === 'contabilidad' ? ' on' : '')} onClick={() => setTab('contabilidad')}>
          Movimientos contables <span className="count">{ledgerViews.length}</span>
        </button>
      </div>

      <Card flush>
        {tab === 'banco' ? (
          <BankTable views={bankViews} onOpen={(id) => setDetail({ kind: 'banco', id })} onLink={(id) => setLinkFor({ kind: 'banco', id })} />
        ) : (
          <LedgerTable views={ledgerViews} onOpen={(id) => setDetail({ kind: 'contabilidad', id })} onLink={(id) => setLinkFor({ kind: 'contabilidad', id })} />
        )}
      </Card>

      {detail && <DetailModal kind={detail.kind} id={detail.id} onClose={() => setDetail(null)} onLink={() => { setLinkFor(detail); setDetail(null); }} />}
      {linkFor && <LinkModal kind={linkFor.kind} id={linkFor.id} onClose={() => setLinkFor(null)} />}
    </>
  );
}

/* ================================================================== */
/* Tablas                                                              */
/* ================================================================== */

function RowActions({
  bankId,
  ledgerId,
  onOpen,
  onLink,
  ignored,
  reviewed,
  isBank,
}: {
  bankId?: string;
  ledgerId?: string;
  onOpen: () => void;
  onLink: () => void;
  ignored: boolean;
  reviewed: boolean;
  isBank: boolean;
}) {
  const acceptMatch = useStore((s) => s.acceptMatch);
  const rejectMatch = useStore((s) => s.rejectMatch);
  const unlink = useStore((s) => s.unlink);
  const toggleIgnore = useStore((s) => s.toggleIgnore);
  const toggleReviewed = useStore((s) => s.toggleReviewed);

  const id = isBank ? bankId! : ledgerId!;
  const linked = Boolean(bankId && ledgerId);

  return (
    <div className="row" style={{ gap: 3 }} onClick={(e) => e.stopPropagation()}>
      <Tooltip content="Ver detalle del cruce">
        <button className="icon-btn" onClick={onOpen}>
          <IconEye size={15} />
        </button>
      </Tooltip>

      {linked ? (
        <>
          <Tooltip content="Aceptar la coincidencia (queda conciliado)">
            <button className="icon-btn" style={{ color: 'var(--green-600)' }} onClick={() => acceptMatch(bankId!, ledgerId!)}>
              <IconCheck size={15} />
            </button>
          </Tooltip>
          <Tooltip content="Rechazar esta coincidencia">
            <button className="icon-btn" style={{ color: 'var(--red-600)' }} onClick={() => rejectMatch(bankId!, ledgerId!)}>
              <IconX size={15} />
            </button>
          </Tooltip>
          {isBank && (
            <Tooltip content="Desvincular">
              <button className="icon-btn" onClick={() => unlink(bankId!)}>
                <IconUnlink size={15} />
              </button>
            </Tooltip>
          )}
        </>
      ) : (
        <Tooltip content="Vincular manualmente con otro movimiento">
          <button className="icon-btn" style={{ color: 'var(--blue-600)' }} onClick={onLink}>
            <IconLink size={15} />
          </button>
        </Tooltip>
      )}

      <Tooltip content={reviewed ? 'Quitar marca de revisado' : 'Marcar como revisado'}>
        <button
          className="icon-btn"
          style={reviewed ? { color: 'var(--green-600)' } : undefined}
          onClick={() => toggleReviewed(id)}
        >
          <IconNote size={15} />
        </button>
      </Tooltip>

      <Tooltip content={ignored ? 'Reactivar movimiento' : 'Ignorar movimiento'} align="right">
        <button className="icon-btn" onClick={() => toggleIgnore(isBank ? 'bank' : 'ledger', id)}>
          {ignored ? <IconEye size={15} /> : <IconEyeOff size={15} />}
        </button>
      </Tooltip>
    </div>
  );
}

function BankTable({
  views,
  onOpen,
  onLink,
}: {
  views: BankRowView[];
  onOpen: (id: string) => void;
  onLink: (id: string) => void;
}) {
  const ignoredBank = useStore((s) => s.overrides.ignoredBank);

  const columns: Column<BankRowView>[] = [
    {
      key: 'estado',
      header: 'Estado',
      render: (v) => <StatusBadge status={v.status} />,
      sortValue: (v) => v.status,
      exportValue: (v) => v.status,
      nowrap: true,
    },
    {
      key: 'score',
      header: 'Confianza',
      render: (v) => <ScoreMeter score={v.score} />,
      sortValue: (v) => v.score,
      align: 'right',
      nowrap: true,
    },
    {
      key: 'fecha',
      header: 'Fecha banco',
      render: (v) => formatDate(v.tx.date),
      sortValue: (v) => v.tx.date?.getTime() ?? 0,
      exportValue: (v) => formatDate(v.tx.date),
      nowrap: true,
    },
    {
      key: 'desc',
      header: 'Descripción del extracto',
      render: (v) => (
        <Cell
          main={<span className="truncate" style={{ display: 'block', maxWidth: 330 }}>{v.tx.description || '—'}</span>}
          sub={[v.tx.reference && 'Ref. ' + v.tx.reference, v.tx.transactionNumber && 'Trans. ' + v.tx.transactionNumber]
            .filter(Boolean)
            .join(' · ')}
        />
      ),
      sortValue: (v) => v.tx.description,
    },
    {
      key: 'valor',
      header: 'Valor banco',
      render: (v) => (
        <span className={v.tx.amount >= 0 ? 'value-pos' : 'value-neg'} style={{ fontWeight: 600 }}>
          {formatMoney(v.tx.amount)}
        </span>
      ),
      sortValue: (v) => v.tx.amount,
      align: 'right',
    },
    {
      key: 'tercero',
      header: 'Contrapartida contable',
      render: (v) =>
        v.ledger ? (
          <Cell
            main={<span className="truncate" style={{ display: 'block', maxWidth: 250 }}>{v.ledger.thirdPartyName || '—'}</span>}
            sub={[v.ledger.thirdPartyId && formatNit(v.ledger.thirdPartyId), v.ledger.documentNumber, v.ledger.accountCode]
              .filter(Boolean)
              .join(' · ')}
          />
        ) : (
          <span className="muted small">Sin contrapartida</span>
        ),
      sortValue: (v) => v.ledger?.thirdPartyName ?? '',
    },
    {
      key: 'difs',
      header: 'Diferencias',
      render: (v) => (
        <div className="small">
          {Math.abs(v.amountDiff) > 0.01 && (
            <div className="value-neg tnum">{formatMoney(v.amountDiff)}</div>
          )}
          {v.daysDiff !== null && v.daysDiff !== 0 && (
            <div className="muted">{Math.abs(v.daysDiff)} día(s)</div>
          )}
          {Math.abs(v.amountDiff) <= 0.01 && (v.daysDiff === null || v.daysDiff === 0) && <span className="muted">—</span>}
        </div>
      ),
      sortValue: (v) => Math.abs(v.amountDiff),
      align: 'right',
      nowrap: true,
    },
    {
      key: 'acc',
      header: '',
      render: (v) => (
        <RowActions
          isBank
          bankId={v.tx.id}
          ledgerId={v.ledger?.id}
          onOpen={() => onOpen(v.tx.id)}
          onLink={() => onLink(v.tx.id)}
          ignored={ignoredBank.includes(v.tx.id)}
          reviewed={v.reviewed}
        />
      ),
      sortable: false,
      nowrap: true,
    },
  ];

  return (
    <DataTable
      rows={views}
      columns={columns}
      rowKey={(v) => v.tx.id}
      onRowClick={(v) => onOpen(v.tx.id)}
      rowClassName={(v) => (v.status === 'IGNORADO' ? 'dim' : '')}
      exportName="Conciliacion_banco"
      emptyTitle="Sin movimientos bancarios"
      emptyDescription="Ajuste o limpie los filtros para ver resultados."
      initialSort={{ key: 'fecha', dir: 'asc' }}
    />
  );
}

function LedgerTable({
  views,
  onOpen,
  onLink,
}: {
  views: LedgerRowView[];
  onOpen: (id: string) => void;
  onLink: (id: string) => void;
}) {
  const ignoredLedger = useStore((s) => s.overrides.ignoredLedger);

  const columns: Column<LedgerRowView>[] = [
    {
      key: 'estado',
      header: 'Estado',
      render: (v) => <StatusBadge status={v.status} />,
      sortValue: (v) => v.status,
      nowrap: true,
    },
    {
      key: 'score',
      header: 'Confianza',
      render: (v) => <ScoreMeter score={v.score} />,
      sortValue: (v) => v.score,
      align: 'right',
      nowrap: true,
    },
    {
      key: 'fecha',
      header: 'Fecha',
      render: (v) => formatDate(v.tx.date),
      sortValue: (v) => v.tx.date?.getTime() ?? 0,
      exportValue: (v) => formatDate(v.tx.date),
      nowrap: true,
    },
    {
      key: 'tercero',
      header: 'Tercero',
      render: (v) => (
        <Cell
          main={<span className="truncate" style={{ display: 'block', maxWidth: 260 }}>{v.tx.thirdPartyName || '—'}</span>}
          sub={v.tx.thirdPartyId ? formatNit(v.tx.thirdPartyId) : 'Sin NIT'}
        />
      ),
      sortValue: (v) => v.tx.thirdPartyName,
    },
    {
      key: 'cuenta',
      header: 'Cuenta',
      render: (v) => <Cell main={v.tx.accountCode || '—'} sub={v.tx.accountName} />,
      sortValue: (v) => v.tx.accountCode,
    },
    {
      key: 'doc',
      header: 'Documento',
      render: (v) => <Cell main={(v.tx.documentType + ' ' + v.tx.documentNumber).trim() || '—'} sub={v.tx.description} />,
      sortValue: (v) => v.tx.documentNumber,
    },
    {
      key: 'valor',
      header: 'Valor',
      render: (v) => (
        <span className={v.tx.amount >= 0 ? 'value-pos' : 'value-neg'} style={{ fontWeight: 600 }}>
          {formatMoney(v.tx.amount)}
        </span>
      ),
      sortValue: (v) => v.tx.amount,
      align: 'right',
    },
    {
      key: 'banco',
      header: 'Contrapartida bancaria',
      render: (v) =>
        v.bank ? (
          <Cell
            main={<span className="truncate" style={{ display: 'block', maxWidth: 240 }}>{v.bank.description}</span>}
            sub={formatDate(v.bank.date) + ' · ' + formatMoney(v.bank.amount)}
          />
        ) : (
          <span className="muted small">Sin contrapartida</span>
        ),
      sortValue: (v) => v.bank?.description ?? '',
    },
    {
      key: 'acc',
      header: '',
      render: (v) => (
        <RowActions
          isBank={false}
          bankId={v.bank?.id}
          ledgerId={v.tx.id}
          onOpen={() => onOpen(v.tx.id)}
          onLink={() => onLink(v.tx.id)}
          ignored={ignoredLedger.includes(v.tx.id)}
          reviewed={v.reviewed}
        />
      ),
      sortable: false,
      nowrap: true,
    },
  ];

  return (
    <DataTable
      rows={views}
      columns={columns}
      rowKey={(v) => v.tx.id}
      onRowClick={(v) => onOpen(v.tx.id)}
      rowClassName={(v) => (v.status === 'IGNORADO' ? 'dim' : '')}
      exportName="Conciliacion_contabilidad"
      emptyTitle="Sin movimientos contables"
      emptyDescription="Ajuste o limpie los filtros para ver resultados."
      initialSort={{ key: 'fecha', dir: 'asc' }}
    />
  );
}

/* ================================================================== */
/* Detalle del cruce                                                   */
/* ================================================================== */

function DetailModal({
  kind,
  id,
  onClose,
  onLink,
}: {
  kind: Tab;
  id: string;
  onClose: () => void;
  onLink: () => void;
}) {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  const overrides = useStore((s) => s.overrides);
  const setNote = useStore((s) => s.setNote);
  const acceptMatch = useStore((s) => s.acceptMatch);
  const rejectMatch = useStore((s) => s.rejectMatch);
  const unlink = useStore((s) => s.unlink);
  const toggleReviewed = useStore((s) => s.toggleReviewed);

  const bankTx = kind === 'banco' ? bank.find((b) => b.id === id) : null;
  const match = kind === 'banco' ? result.byBank.get(id) : result.byLedger.get(id);
  const ledgerTx =
    kind === 'contabilidad' ? ledger.find((l) => l.id === id) : match ? ledger.find((l) => l.id === match.ledgerId) ?? null : null;
  const bankSide = kind === 'banco' ? bankTx : match ? bank.find((b) => b.id === match.bankId) ?? null : null;

  const targetId = kind === 'banco' ? id : id;
  const [note, setLocalNote] = useState(overrides.notes[targetId] ?? '');
  const status = kind === 'banco' ? result.bankStatus.get(id) : result.ledgerStatus.get(id);

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={
        <span className="row" style={{ gap: 10 }}>
          Detalle del movimiento {status && <StatusBadge status={status} />}
        </span>
      }
      subtitle={match ? 'Cruce ' + match.bankId + ' ↔ ' + match.ledgerId + ' · origen ' + (match.origin === 'manual' ? 'manual' : 'automático') : 'Sin contrapartida asignada'}
      footer={
        <>
          <button className="btn" onClick={() => toggleReviewed(targetId)}>
            <IconCheck size={14} /> {overrides.reviewed.includes(targetId) ? 'Quitar revisado' : 'Marcar revisado'}
          </button>
          {match ? (
            <>
              <button className="btn danger" onClick={() => { rejectMatch(match.bankId, match.ledgerId); onClose(); }}>
                <IconX size={14} /> Rechazar
              </button>
              <button className="btn" onClick={() => { unlink(match.bankId); onClose(); }}>
                <IconUnlink size={14} /> Desvincular
              </button>
              <button className="btn success" onClick={() => { acceptMatch(match.bankId, match.ledgerId); onClose(); }}>
                <IconCheck size={14} /> Aceptar coincidencia
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={onLink}>
              <IconLink size={14} /> Vincular manualmente
            </button>
          )}
        </>
      }
    >
      {match && (
        <div className="mb-16">
          <Notice type={match.status === 'CONCILIADO' ? 'success' : match.status === 'NO_CONCILIADO' ? 'error' : 'info'}>
            <strong>Confianza {match.score.toFixed(0)}%.</strong> {match.explanation}
          </Notice>
        </div>
      )}

      <div className="detail-grid mb-16">
        <div className="detail-col">
          <header className="bank">Extracto bancario</header>
          {bankSide ? (
            <>
              <KV k="Identificador" v={bankSide.id} />
              <KV k="Fila del archivo" v={String(bankSide.rowIndex)} />
              <KV k="Fecha" v={formatDate(bankSide.date)} />
              {bankSide.valueDate && <KV k="Fecha de valor" v={formatDate(bankSide.valueDate)} />}
              <KV k="Descripción" v={bankSide.description || '—'} />
              <KV k="Referencia" v={bankSide.reference || '—'} />
              <KV k="Documento" v={bankSide.document || '—'} />
              <KV k="N.º transacción" v={bankSide.transactionNumber || '—'} />
              <KV k="Débito" v={bankSide.debit ? formatMoney(bankSide.debit) : '—'} num />
              <KV k="Crédito" v={bankSide.credit ? formatMoney(bankSide.credit) : '—'} num />
              <KV k="Valor neto" v={formatMoney(bankSide.amount)} num />
              {bankSide.balance !== null && <KV k="Saldo" v={formatMoney(bankSide.balance)} num />}
            </>
          ) : (
            <div className="kv">
              <span className="muted">Sin movimiento bancario asociado.</span>
            </div>
          )}
        </div>

        <div className="detail-col">
          <header className="ledger">Auxiliar contable</header>
          {ledgerTx ? (
            <>
              <KV k="Identificador" v={ledgerTx.id} />
              <KV k="Fila del archivo" v={String(ledgerTx.rowIndex)} />
              <KV k="Fecha" v={formatDate(ledgerTx.date)} />
              <KV k="Cuenta" v={(ledgerTx.accountCode || '—') + (ledgerTx.accountName ? ' — ' + ledgerTx.accountName : '')} />
              <KV k="NIT" v={ledgerTx.thirdPartyId ? formatNit(ledgerTx.thirdPartyId) : '—'} />
              <KV k="Tercero" v={ledgerTx.thirdPartyName || '—'} />
              <KV k="Documento" v={(ledgerTx.documentType + ' ' + ledgerTx.documentNumber).trim() || '—'} />
              <KV k="Descripción" v={ledgerTx.description || '—'} />
              <KV k="Débito" v={ledgerTx.debit ? formatMoney(ledgerTx.debit) : '—'} num />
              <KV k="Crédito" v={ledgerTx.credit ? formatMoney(ledgerTx.credit) : '—'} num />
              <KV k="Valor neto" v={formatMoney(ledgerTx.amount)} num />
            </>
          ) : (
            <div className="kv">
              <span className="muted">Sin registro contable asociado.</span>
            </div>
          )}
        </div>
      </div>

      {match && match.reasons.length > 0 && (
        <div className="mb-16">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>¿Por qué se seleccionó esta coincidencia?</h4>
          <div className="reason-list">
            {match.reasons.map((r: MatchReason, i) => (
              <div key={i} className={'reason' + (r.points <= 0 ? ' zero' : '')}>
                <span>{r.label}</span>
                <span className="pts">{r.points > 0 ? '+' + r.points : '0'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>Observación</label>
        <textarea
          value={note}
          placeholder="Anote aquí la justificación de la partida conciliatoria, el soporte pendiente, etc."
          onChange={(e) => setLocalNote(e.target.value)}
          onBlur={() => setNote(targetId, note)}
        />
        <div className="hint">La observación queda registrada en la bitácora y se incluye en la exportación a Excel.</div>
      </div>
    </Modal>
  );
}

function KV({ k, v, num }: { k: string; v: string; num?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={'v' + (num ? ' num' : '')}>{v}</span>
    </div>
  );
}

/* ================================================================== */
/* Vinculación manual                                                  */
/* ================================================================== */

function LinkModal({ kind, id, onClose }: { kind: Tab; id: string; onClose: () => void }) {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  const config = useStore((s) => s.config);
  const linkManual = useStore((s) => s.linkManual);
  const [search, setSearch] = useState('');

  const isBank = kind === 'banco';
  const source = isBank ? bank.find((b) => b.id === id) : ledger.find((l) => l.id === id);

  const suggestions = useMemo(() => {
    if (!source) return [];
    if (isBank) {
      return findCandidates(source as BankTx, ledger, config, 40).map((c) => ({
        id: c.ledgerId,
        score: c.score,
        explanation: c.explanation,
        amountDiff: c.amountDiff,
        daysDiff: c.daysDiff,
      }));
    }
    return findBankCandidates(source as LedgerTx, bank, config, 40).map((c) => ({
      id: c.bankId,
      score: c.score,
      explanation: c.explanation,
      amountDiff: c.amountDiff,
      daysDiff: c.daysDiff,
    }));
  }, [source, bank, ledger, config, isBank]);

  const term = search.trim().toLowerCase();
  const others = isBank ? ledger : bank;

  const rows = useMemo(() => {
    const byId = new Map(suggestions.map((s) => [s.id, s]));
    const pool = term
      ? others.filter((o) => {
          const text = isBank
            ? [(o as LedgerTx).thirdPartyName, (o as LedgerTx).documentNumber, (o as LedgerTx).description, String(Math.abs(o.amount))].join(' ')
            : [(o as BankTx).description, (o as BankTx).reference, String(Math.abs(o.amount))].join(' ');
          return text.toLowerCase().includes(term);
        })
      : others.filter((o) => byId.has(o.id));

    return pool
      .map((o) => ({ tx: o, s: byId.get(o.id) }))
      .sort((a, b) => (b.s?.score ?? -1) - (a.s?.score ?? -1))
      .slice(0, 80);
  }, [others, suggestions, term, isBank]);

  if (!source) return null;

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title="Vincular manualmente"
      subtitle={
        (isBank ? 'Movimiento bancario ' : 'Registro contable ') +
        source.id +
        ' · ' +
        formatDate(source.date) +
        ' · ' +
        formatMoney(source.amount)
      }
      footer={<button className="btn" onClick={onClose}>Cerrar</button>}
    >
      <div className="mb-12">
        <Notice type="info">
          Se muestran primero los candidatos que el motor considera compatibles. Use el buscador para vincular
          cualquier otro movimiento, incluso si el valor o la fecha no coinciden.
        </Notice>
      </div>

      <div className="field mb-12">
        <label>Buscar entre {isBank ? 'los registros contables' : 'los movimientos bancarios'}</label>
        <input
          placeholder="Tercero, documento, descripción o valor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-wrap fixed-h">
        <table className="data">
          <thead>
            <tr>
              <th>Confianza</th>
              <th>Fecha</th>
              <th>{isBank ? 'Tercero / documento' : 'Descripción'}</th>
              <th className="num">Valor</th>
              <th>Diferencias</th>
              <th>Estado actual</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tx, s }) => {
              const status = isBank ? result.ledgerStatus.get(tx.id) : result.bankStatus.get(tx.id);
              return (
                <tr key={tx.id}>
                  <td className="num">
                    {s ? <ScoreMeter score={s.score} /> : <span className="muted small">—</span>}
                  </td>
                  <td className="nowrap">{formatDate(tx.date)}</td>
                  <td>
                    {isBank ? (
                      <Cell
                        main={(tx as LedgerTx).thirdPartyName || '—'}
                        sub={[(tx as LedgerTx).documentNumber, (tx as LedgerTx).description].filter(Boolean).join(' · ')}
                      />
                    ) : (
                      <Cell main={(tx as BankTx).description} sub={(tx as BankTx).reference} />
                    )}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {formatMoney(tx.amount)}
                  </td>
                  <td className="small">
                    {s ? (
                      <>
                        {Math.abs(s.amountDiff) > 0.01 && <div className="value-neg">{formatMoney(s.amountDiff)}</div>}
                        {s.daysDiff !== null && s.daysDiff !== 0 && <div className="muted">{Math.abs(s.daysDiff)} día(s)</div>}
                        {Math.abs(s.amountDiff) <= 0.01 && (s.daysDiff === null || s.daysDiff === 0) && <span className="muted">Coincide</span>}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{status && <StatusBadge status={status} />}</td>
                  <td className="nowrap">
                    <button
                      className="btn xs primary"
                      onClick={() => {
                        linkManual(isBank ? id : tx.id, isBank ? tx.id : id);
                        onClose();
                      }}
                    >
                      <IconLink size={12} /> Vincular
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="center muted" style={{ padding: 28 }}>
                  No hay candidatos. Escriba en el buscador para explorar todos los movimientos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
