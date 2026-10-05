/**
 * Detalle de la diferencia banco − contabilidad: estado de conciliación en
 * formato tradicional, con cada partida conciliatoria y su subtotal.
 */

import React, { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useAccounts, useAlerts, useBankRows, useKpis, useLedgerRows, useResult, useThirdParties } from '../../state/selectors';
import { buildStatement, type StatementSection } from '../../core/analytics/statement';
import { exportExcel } from '../../core/export/excel';
import { formatDate } from '../../core/normalize/dates';
import { formatMoney, formatNumber } from '../../core/normalize/money';
import { IconDownload, Modal } from './primitives';

export function StatementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const bank = useBankRows();
  const ledger = useLedgerRows();
  const result = useResult();
  const kpis = useKpis();
  const alerts = useAlerts();
  const thirdParties = useThirdParties();
  const accounts = useAccounts();
  const overrides = useStore((s) => s.overrides);
  const bankFile = useStore((s) => s.bank.fileName);
  const ledgerFile = useStore((s) => s.ledger.fileName);
  const log = useStore((s) => s.log);

  const st = useMemo(() => buildStatement(bank, ledger, result, kpis), [bank, ledger, result, kpis]);

  const download = () => {
    const name = exportExcel(
      {
        bank,
        ledger,
        result,
        kpis,
        alerts,
        thirdParties,
        accounts,
        notes: overrides.notes,
        reviewed: new Set(overrides.reviewed),
        meta: { bankFile, ledgerFile, generatedAt: new Date() },
      },
      ['partidas'],
      'Conciliacion_bancaria_partidas.xlsx',
    );
    log('Exportación de partidas conciliatorias', name);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      title="Conciliación bancaria — partidas conciliatorias"
      subtitle="Del saldo en libros al saldo en banco, partida por partida"
      footer={
        <button className="btn primary" onClick={download}>
          <IconDownload size={15} /> Descargar en Excel
        </button>
      }
    >
      <table className="data" style={{ marginBottom: 12 }}>
        <tbody>
          <Line label="Saldo según libros" value={st.saldoLibros} strong />
          {st.sections
            .filter((s) => s.items.length)
            .map((s) => (
              <Line
                key={s.id}
                label={(s.id === 'diferenciasCruces' ? '(±) ' : s.sign > 0 ? '(+) ' : '(−) ') + s.title + ' · ' + formatNumber(s.items.length)}
                value={s.sign * s.total}
              />
            ))}
          <Line label="Saldo según banco (conciliado)" value={st.saldoBancoConciliado} strong />
          <Line label="Saldo según banco (extracto)" value={st.saldoBanco} />
          <Line label="Diferencia sin explicar" value={st.sinExplicar} strong />
        </tbody>
      </table>

      {kpis.saldoBancoOrigen === 'supuesto' && (
        <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
          El extracto no trae columna de saldo: el saldo del banco es el saldo inicial del auxiliar (
          {formatMoney(kpis.saldoInicialBanco ?? 0)}) + los movimientos del extracto. Si el extracto oficial muestra otro
          saldo inicial, edítelo en la tarjeta “Saldo según banco”.
        </p>
      )}

      {st.sections
        .filter((s) => s.items.length)
        .map((s) => (
          <SectionDetail key={s.id} section={s} />
        ))}
    </Modal>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr>
      <td style={{ fontWeight: strong ? 600 : 400 }}>{label}</td>
      <td className="tnum" style={{ textAlign: 'right', fontWeight: strong ? 600 : 400, whiteSpace: 'nowrap' }}>
        {formatMoney(value, true)}
      </td>
    </tr>
  );
}

function SectionDetail({ section }: { section: StatementSection }) {
  const [open, setOpen] = useState(section.items.length <= 15);
  return (
    <div style={{ marginTop: 14 }}>
      <button
        className="btn sm ghost"
        style={{ fontWeight: 600, paddingLeft: 0 }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} {section.title} ({formatNumber(section.items.length)}) · {formatMoney(section.total, true)}
      </button>
      <div className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
        {section.hint}
      </div>
      {open && (
        <div className="table-wrap" style={{ maxHeight: 320 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Fila</th>
                <th>Descripción</th>
                <th>Documento / Ref.</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {section.items.map((it) => (
                <tr key={it.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(it.date)}</td>
                  <td className="tnum">{it.row}</td>
                  <td>{it.description}</td>
                  <td>{it.reference}</td>
                  <td className="tnum" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatMoney(it.value, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
