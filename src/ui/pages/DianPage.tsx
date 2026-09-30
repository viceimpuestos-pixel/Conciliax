/**
 * Módulo DIAN vs. auxiliar contable: concilia el reporte de documentos
 * electrónicos (facturación) contra el libro auxiliar, para detectar
 * facturas sin registrar, registros sin soporte DIAN y diferencias de valor.
 *
 * Flujo independiente del banco: sus propios archivos, su propio mapeo,
 * su propio motor (`dianEngine.ts`), pero reutiliza los mismos primitivos
 * de UI y el mismo `buildLedgerDataset` del lado contable.
 */

import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import type { DianMatch, DianMatchStatus, DianReconciliationResult, DianTx, FieldSpec, LedgerTx } from '../../core/types';
import { DIAN_STATUS_LABEL } from '../../core/types';
import { formatDate } from '../../core/normalize/dates';
import { formatMoney, formatNumber } from '../../core/normalize/money';
import { formatNit } from '../../core/normalize/nit';
import { ACCEPTED_EXTENSIONS } from '../../core/parsing/loadFile';
import { fieldsFor } from '../../core/parsing/columnMap';
import { DataTable, type Column } from '../components/DataTable';
import {
  Card,
  DianStatusBadge,
  EmptyState,
  Field,
  Help,
  IconAlert,
  IconCheck,
  IconFile,
  IconPlay,
  IconRefresh,
  IconTable,
  IconUnlink,
  IconUpload,
  IconX,
  Modal,
  Notice,
  ScoreMeter,
  Switch,
} from '../components/primitives';

export function DianPage() {
  const dianResult = useStore((s) => s.dianResult);
  return dianResult ? <DianResultsView /> : <DianImportView />;
}

/* ================================================================== */
/* Importación                                                         */
/* ================================================================== */

function DianImportView() {
  const dianDoc = useStore((s) => s.dianDoc);
  const dianLedger = useStore((s) => s.dianLedger);
  const dianWarnings = useStore((s) => s.dianWarnings);
  const dianError = useStore((s) => s.dianError);
  const dianBuildOptions = useStore((s) => s.dianBuildOptions);
  const setDianBuildOptions = useStore((s) => s.setDianBuildOptions);
  const loadDianDocFile = useStore((s) => s.loadDianDocFile);
  const loadDianLedgerFile = useStore((s) => s.loadDianLedgerFile);
  const buildDianDatasets = useStore((s) => s.buildDianDatasets);
  const runDian = useStore((s) => s.runDian);
  const loadDianDemo = useStore((s) => s.loadDianDemo);
  const dianDataset = useStore((s) => s.dianDataset);
  const dianLedgerDataset = useStore((s) => s.dianLedgerDataset);

  const ready = Boolean(dianDoc.file && dianLedger.file);

  return (
    <div>
      <div className="row between mb-16">
        <div>
          <h2 className="page-title">Conciliación DIAN vs. auxiliar</h2>
          <p className="page-sub">
            Cargue el reporte de documentos electrónicos (facturación) de la DIAN y el libro auxiliar de la
            cuenta correspondiente (ingresos o compras, según lo que esté conciliando).
          </p>
        </div>
        <button className="btn" onClick={() => void loadDianDemo()}>
          <IconTable size={15} /> Cargar datos de demostración
        </button>
      </div>

      {dianError && <Notice type="error">{dianError}</Notice>}
      {dianWarnings.length > 0 && (
        <div className="mb-16">
          {dianWarnings.map((w, i) => (
            <Notice key={i} type="info">
              {w}
            </Notice>
          ))}
        </div>
      )}

      <div className="grid-2 mb-16">
        <DianDropzone
          title="1. Documentos electrónicos DIAN"
          subtitle="Reporte de facturación · .xlsx .xls .csv"
          icon={<IconFile size={15} />}
          slot={dianDoc}
          onFile={(f) => void loadDianDocFile(f)}
        />
        <DianDropzone
          title="2. Auxiliar contable"
          subtitle="Cuenta de ingresos o compras · .xlsx .xls .csv"
          icon={<IconTable size={15} />}
          slot={dianLedger}
          onFile={(f) => void loadDianLedgerFile(f)}
        />
      </div>

      {dianDoc.file && <DianMapper which="dianDoc" title="3. Columnas del reporte DIAN" />}
      {dianLedger.file && <DianMapper which="dianLedger" title="4. Columnas del auxiliar contable" />}

      {ready && (
        <Card title="5. Opciones de normalización" subtitle="Ajuste sólo si la vista previa muestra valores incorrectos." className="mb-16">
          <div className="filter-bar">
            <Field label="Naturaleza del auxiliar" width="lg" hint="Si concilia una cuenta de ingresos (41xx), un crédito es un ingreso. Si concilia costos/gastos o cuentas por pagar (compras), invierta la convención.">
              <select
                value={dianBuildOptions.ledgerSign}
                onChange={(e) => {
                  setDianBuildOptions({ ledgerSign: e.target.value as 'debito-ingreso' | 'credito-ingreso' });
                  buildDianDatasets();
                }}
              >
                <option value="credito-ingreso">Cuenta de ingresos (ventas): crédito = ingreso</option>
                <option value="debito-ingreso">Cuenta de compras/CxP: débito = registro</option>
              </select>
            </Field>
            <Field label="Omitir totales" width="sm">
              <Switch
                checked={dianBuildOptions.dropTotals ?? true}
                onChange={(v) => {
                  setDianBuildOptions({ dropTotals: v });
                  buildDianDatasets();
                }}
                label="Subtotales/totales"
              />
            </Field>
          </div>
        </Card>
      )}

      {ready && dianDataset && dianLedgerDataset && (
        <Card title="6. Ejecutar la conciliación" className="mb-16">
          <p className="mb-12">
            Se cruzarán {formatNumber(dianDataset.rows.length)} documentos DIAN contra{' '}
            {formatNumber(dianLedgerDataset.rows.length)} registros contables.
          </p>
          <button className="btn primary" onClick={() => void runDian()}>
            <IconPlay size={15} /> Ejecutar conciliación
          </button>
        </Card>
      )}
    </div>
  );
}

function DianDropzone({
  title,
  subtitle,
  icon,
  slot,
  onFile,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  slot: { file: { sheet: { totalRows: number; headers: string[]; sheetName: string } } | null; fileName: string };
  onFile: (f: File) => void;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const file = slot.file;
  const ext = slot.fileName.split('.').pop()?.toLowerCase() ?? '';
  const iconClass = ext === 'pdf' ? 'pdf' : ext === 'csv' || ext === 'txt' ? 'csv' : 'xlsx';

  return (
    <Card title={<span className="row" style={{ gap: 8 }}>{icon} {title}</span>} subtitle={subtitle}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <div
        className={'dropzone' + (over ? ' over' : '') + (file ? ' filled' : '')}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
      >
        {!file ? (
          <>
            <IconUpload size={22} />
            <div className="dz-title mt-8">Arrastre el archivo aquí o haga clic para seleccionarlo</div>
            <div className="dz-sub">Formatos admitidos: Excel (.xlsx, .xls) y CSV.</div>
          </>
        ) : (
          <div className="file-summary">
            <div className={'file-icon ' + iconClass}>{ext.toUpperCase().slice(0, 4)}</div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="dz-title truncate">{slot.fileName}</div>
              <div className="dz-sub">
                {formatNumber(file.sheet.totalRows)} filas · {file.sheet.headers.length} columnas · hoja{' '}
                <strong>{file.sheet.sheetName}</strong>
              </div>
            </div>
            <IconCheck size={18} />
          </div>
        )}
      </div>
    </Card>
  );
}

function DianMapper({ which, title }: { which: 'dianDoc' | 'dianLedger'; title: string }) {
  const slot = useStore((s) => s[which]);
  const setDianMapping = useStore((s) => s.setDianMapping);
  const autoDetectDian = useStore((s) => s.autoDetectDian);
  const buildDianDatasets = useStore((s) => s.buildDianDatasets);

  if (!slot.file) return null;

  const specs = fieldsFor(which === 'dianDoc' ? 'dian' : 'ledger');
  const headers = slot.file.sheet.headers;
  const rows = slot.file.sheet.rows;
  const missing = slot.detection?.missingRequired ?? [];

  const sampleFor = (col: number): string => {
    if (col < 0) return '';
    for (const r of rows.slice(0, 12)) {
      const v = r[col];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        return v instanceof Date ? formatDate(v) : String(v).slice(0, 40);
      }
    }
    return '(vacío)';
  };

  const detected = specs.filter((s) => slot.mapping[s.key] >= 0).length;

  return (
    <Card
      title={title}
      subtitle={
        <>
          {detected} de {specs.length} campos identificados automáticamente.
          {missing.length > 0 && <span style={{ color: 'var(--red-600)', fontWeight: 600 }}> Faltan campos obligatorios.</span>}
        </>
      }
      right={
        <button
          className="btn sm"
          onClick={() => {
            autoDetectDian(which);
            buildDianDatasets();
          }}
        >
          <IconRefresh size={14} /> Volver a detectar
        </button>
      }
      className="mb-16"
    >
      <div className="map-grid">
        {specs.map((spec) => (
          <DianMapRow
            key={spec.key}
            spec={spec}
            headers={headers}
            value={slot.mapping[spec.key] ?? -1}
            confidence={slot.detection?.confidence[spec.key] ?? 0}
            missing={missing.includes(spec.key)}
            sample={sampleFor(slot.mapping[spec.key] ?? -1)}
            onChange={(idx) => {
              setDianMapping(which, spec.key, idx);
              buildDianDatasets();
            }}
          />
        ))}
      </div>
    </Card>
  );
}

function DianMapRow({
  spec,
  headers,
  value,
  confidence,
  missing,
  sample,
  onChange,
}: {
  spec: FieldSpec;
  headers: string[];
  value: number;
  confidence: number;
  missing: boolean;
  sample: string;
  onChange: (idx: number) => void;
}) {
  const cls = missing ? 'missing' : value >= 0 && confidence >= 80 ? 'auto' : spec.required ? 'required' : '';
  return (
    <div className={'map-row ' + cls}>
      <div className="map-label">
        {spec.label}
        {spec.required && <span style={{ color: 'var(--red-500)' }}>*</span>}
        {spec.help && <Help text={spec.help} />}
      </div>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={-1}>— Sin asignar —</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
      <div className="map-meta">
        {value >= 0 ? (
          confidence >= 80 ? (
            <span className="badge CONCILIADO" style={{ fontSize: 10 }}>
              <IconCheck size={10} /> Detectado {confidence}%
            </span>
          ) : (
            <span className="badge neutral" style={{ fontSize: 10 }}>
              Confianza {confidence}%
            </span>
          )
        ) : (
          <span className="badge neutral" style={{ fontSize: 10 }}>
            Sin asignar
          </span>
        )}
      </div>
      {value >= 0 && <div className="sample">{sample}</div>}
    </div>
  );
}

/* ================================================================== */
/* Resultados                                                          */
/* ================================================================== */

type Tab = 'dian' | 'ledger';

function DianResultsView() {
  const dianDataset = useStore((s) => s.dianDataset);
  const dianLedgerDataset = useStore((s) => s.dianLedgerDataset);
  const dianResult = useStore((s) => s.dianResult);
  const dianLastRunAt = useStore((s) => s.dianLastRunAt);
  const runDian = useStore((s) => s.runDian);
  const backToDianImport = useStore((s) => s.backToDianImport);

  const [tab, setTab] = useState<Tab>('dian');
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState<DianMatchStatus | 'todos'>('todos');
  const [openDoc, setOpenDoc] = useState<DianTx | null>(null);
  const [openLedger, setOpenLedger] = useState<LedgerTx | null>(null);

  if (!dianDataset || !dianLedgerDataset || !dianResult) return null;

  const kpis = useMemo(() => computeDianKpis(dianDataset.rows, dianLedgerDataset.rows, dianResult), [dianDataset, dianLedgerDataset, dianResult]);

  const dianRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dianDataset.rows.filter((d) => {
      const status = dianResult.dianStatus.get(d.id) ?? 'NO_CONCILIADO';
      if (estado !== 'todos' && status !== estado) return false;
      if (!q) return true;
      return (
        d.thirdPartyName.toLowerCase().includes(q) ||
        d.nit.includes(q) ||
        d.number.toLowerCase().includes(q) ||
        d.prefix.toLowerCase().includes(q)
      );
    });
  }, [dianDataset, dianResult, search, estado]);

  const ledgerRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dianLedgerDataset.rows.filter((l) => {
      const status = dianResult.ledgerStatus.get(l.id) ?? 'NO_CONCILIADO';
      if (estado !== 'todos' && status !== estado) return false;
      if (!q) return true;
      return (
        l.thirdPartyName.toLowerCase().includes(q) ||
        l.thirdPartyId.includes(q) ||
        l.documentNumber.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q)
      );
    });
  }, [dianLedgerDataset, dianResult, search, estado]);

  const dianColumns: Column<DianTx>[] = [
    {
      key: 'status',
      header: 'Estado',
      render: (d) => <DianStatusBadge status={dianResult.dianStatus.get(d.id) ?? 'NO_CONCILIADO'} />,
      sortValue: (d) => dianResult.dianStatus.get(d.id) ?? '',
      width: 170,
    },
    { key: 'fecha', header: 'Fecha', render: (d) => formatDate(d.issueDate), sortValue: (d) => d.issueDate?.getTime() ?? 0, nowrap: true },
    {
      key: 'doc',
      header: 'Documento',
      render: (d) => (d.prefix ? d.prefix + ' ' : '') + d.number,
      sortValue: (d) => d.documentKey,
    },
    { key: 'tercero', header: 'Tercero', render: (d) => d.thirdPartyName || '—', sortValue: (d) => d.thirdPartyName },
    { key: 'nit', header: 'NIT', render: (d) => formatNit(d.nit), sortValue: (d) => d.nit },
    { key: 'valor', header: 'Valor', render: (d) => formatMoney(d.amount), sortValue: (d) => d.amount, align: 'right' },
    {
      key: 'score',
      header: 'Confianza',
      render: (d) => <ScoreMeter score={dianResult.byDian.get(d.id)?.score ?? 0} />,
      sortValue: (d) => dianResult.byDian.get(d.id)?.score ?? -1,
    },
  ];

  const ledgerColumns: Column<LedgerTx>[] = [
    {
      key: 'status',
      header: 'Estado',
      render: (l) => <DianStatusBadge status={dianResult.ledgerStatus.get(l.id) ?? 'NO_CONCILIADO'} />,
      sortValue: (l) => dianResult.ledgerStatus.get(l.id) ?? '',
      width: 170,
    },
    { key: 'fecha', header: 'Fecha', render: (l) => formatDate(l.date), sortValue: (l) => l.date?.getTime() ?? 0, nowrap: true },
    { key: 'doc', header: 'Documento', render: (l) => l.documentNumber || '—', sortValue: (l) => l.documentNumber },
    { key: 'tercero', header: 'Tercero', render: (l) => l.thirdPartyName || '—', sortValue: (l) => l.thirdPartyName },
    { key: 'nit', header: 'NIT', render: (l) => formatNit(l.thirdPartyId), sortValue: (l) => l.thirdPartyId },
    { key: 'desc', header: 'Descripción', render: (l) => l.description || '—', sortValue: (l) => l.description },
    { key: 'valor', header: 'Valor', render: (l) => formatMoney(Math.abs(l.amount)), sortValue: (l) => Math.abs(l.amount), align: 'right' },
  ];

  return (
    <div>
      <div className="row between mb-16">
        <div>
          <h2 className="page-title">Resultado de la conciliación DIAN</h2>
          <p className="page-sub">
            {dianDataset.fileName} · {dianLedgerDataset.fileName}
            {dianLastRunAt && <> · Última conciliación: {dianLastRunAt.toLocaleString('es-CO')}</>}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={backToDianImport}>
            <IconUpload size={14} /> Cambiar archivos
          </button>
          <button className="btn primary" onClick={() => void runDian()}>
            <IconRefresh size={14} /> Volver a conciliar
          </button>
        </div>
      </div>

      <div className="kpi-grid mb-16">
        <Kpi label="Documentos DIAN" value={formatNumber(kpis.totalDian)} foot={formatMoney(kpis.valorDian) + ' en total'} />
        <Kpi label="Registros contables" value={formatNumber(kpis.totalLedger)} foot={formatMoney(kpis.valorLedger) + ' en total'} />
        <Kpi label="Conciliados" value={formatNumber(kpis.conciliados)} tone="green" foot={formatMoney(kpis.valorConciliado)} />
        <Kpi label="Facturas DIAN sin registrar" value={formatNumber(kpis.dianSinLedger)} tone={kpis.dianSinLedger ? 'red' : 'green'} foot={formatMoney(kpis.valorDianSinLedger)} />
        <Kpi label="Registros sin soporte DIAN" value={formatNumber(kpis.ledgerSinDian)} tone={kpis.ledgerSinDian ? 'amber' : 'green'} foot={formatMoney(kpis.valorLedgerSinDian)} />
        <Kpi label="Diferencias de valor" value={formatNumber(kpis.difValor)} tone={kpis.difValor ? 'red' : 'green'} foot="Mismo documento, valor distinto" />
        <Kpi label="No válidos ante la DIAN" value={formatNumber(kpis.noValidos)} foot="Rechazados / anulados" />
        <Kpi label="% conciliado" value={kpis.porcentaje.toFixed(1) + '%'} tone={kpis.porcentaje >= 90 ? 'green' : kpis.porcentaje >= 70 ? 'amber' : 'red'} foot="Sobre documentos válidos" />
      </div>

      <div className="filter-bar mb-16">
        <div className="seg">
          <button className={'seg-btn' + (tab === 'dian' ? ' active' : '')} onClick={() => setTab('dian')}>
            Documentos DIAN ({formatNumber(dianDataset.rows.length)})
          </button>
          <button className={'seg-btn' + (tab === 'ledger' ? ' active' : '')} onClick={() => setTab('ledger')}>
            Auxiliar contable ({formatNumber(dianLedgerDataset.rows.length)})
          </button>
        </div>
        <Field label="Buscar" width="lg">
          <input placeholder="Tercero, NIT, número de documento…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label="Estado" width="md">
          <select value={estado} onChange={(e) => setEstado(e.target.value as DianMatchStatus | 'todos')}>
            <option value="todos">Todos</option>
            {Object.entries(DIAN_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {tab === 'dian' ? (
        <DataTable
          rows={dianRows}
          columns={dianColumns}
          rowKey={(d) => d.id}
          onRowClick={setOpenDoc}
          exportName="Conciliax_DIAN"
          emptyTitle="Sin documentos que coincidan con el filtro"
        />
      ) : (
        <DataTable
          rows={ledgerRows}
          columns={ledgerColumns}
          rowKey={(l) => l.id}
          onRowClick={setOpenLedger}
          exportName="Conciliax_Auxiliar_DIAN"
          emptyTitle="Sin registros que coincidan con el filtro"
        />
      )}

      {openDoc && (
        <DianDocDetail
          doc={openDoc}
          ledger={dianLedgerDataset.rows}
          result={dianResult}
          onClose={() => setOpenDoc(null)}
        />
      )}
      {openLedger && (
        <LedgerDetail
          row={openLedger}
          dian={dianDataset.rows}
          result={dianResult}
          onClose={() => setOpenLedger(null)}
        />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  foot,
  tone,
}: {
  label: string;
  value: string;
  foot?: string;
  tone?: 'green' | 'red' | 'amber';
}) {
  return (
    <div className={'kpi' + (tone ? ' ' + tone : '')}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

interface DianKpis {
  totalDian: number;
  totalLedger: number;
  valorDian: number;
  valorLedger: number;
  conciliados: number;
  valorConciliado: number;
  dianSinLedger: number;
  valorDianSinLedger: number;
  ledgerSinDian: number;
  valorLedgerSinDian: number;
  difValor: number;
  noValidos: number;
  porcentaje: number;
}

function computeDianKpis(dian: DianTx[], ledger: LedgerTx[], result: DianReconciliationResult): DianKpis {
  let valorDian = 0;
  let valorLedger = 0;
  let conciliados = 0;
  let valorConciliado = 0;
  let dianSinLedger = 0;
  let valorDianSinLedger = 0;
  let difValor = 0;
  let noValidos = 0;

  for (const d of dian) {
    valorDian += d.amount;
    const status = result.dianStatus.get(d.id) ?? 'NO_CONCILIADO';
    if (status === 'CONCILIADO') {
      conciliados++;
      valorConciliado += d.amount;
    } else if (status === 'NO_CONCILIADO') {
      dianSinLedger++;
      valorDianSinLedger += d.amount;
    } else if (status === 'DIF_VALOR') {
      difValor++;
    } else if (status === 'NO_VALIDO') {
      noValidos++;
    }
  }

  let ledgerSinDian = 0;
  let valorLedgerSinDian = 0;
  for (const l of ledger) {
    valorLedger += Math.abs(l.amount);
    const status = result.ledgerStatus.get(l.id) ?? 'NO_CONCILIADO';
    if (status === 'NO_CONCILIADO' || status === 'REVISION') {
      ledgerSinDian++;
      valorLedgerSinDian += Math.abs(l.amount);
    }
  }

  const validos = dian.length - noValidos;
  const porcentaje = validos > 0 ? (conciliados / validos) * 100 : 0;

  return {
    totalDian: dian.length,
    totalLedger: ledger.length,
    valorDian,
    valorLedger,
    conciliados,
    valorConciliado,
    dianSinLedger,
    valorDianSinLedger,
    ledgerSinDian,
    valorLedgerSinDian,
    difValor,
    noValidos,
    porcentaje,
  };
}

/* ================================================================== */
/* Detalle de un documento / registro                                  */
/* ================================================================== */

function MatchReasonsList({ match }: { match: DianMatch | undefined }) {
  if (!match) return <p className="sub">Sin cruce automático.</p>;
  return (
    <table className="mini-table">
      <tbody>
        {match.reasons.map((r, i) => (
          <tr key={i}>
            <td>{r.label}</td>
            <td className="num">{r.points > 0 ? '+' + r.points : r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DianDocDetail({
  doc,
  ledger,
  result,
  onClose,
}: {
  doc: DianTx;
  ledger: LedgerTx[];
  result: DianReconciliationResult;
  onClose: () => void;
}) {
  const acceptDianMatch = useStore((s) => s.acceptDianMatch);
  const rejectDianMatch = useStore((s) => s.rejectDianMatch);
  const unlinkDian = useStore((s) => s.unlinkDian);
  const toggleIgnoreDian = useStore((s) => s.toggleIgnoreDian);

  const status = result.dianStatus.get(doc.id) ?? 'NO_CONCILIADO';
  const match = result.byDian.get(doc.id);
  const matchedLedger = match ? ledger.find((l) => l.id === match.ledgerId) : null;

  return (
    <Modal open onClose={onClose} title="Detalle del documento DIAN" subtitle={<DianStatusBadge status={status} />} size="wide">
      <div className="grid-2">
        <div>
          <h4 className="mb-8">Documento electrónico</h4>
          <table className="mini-table">
            <tbody>
              <tr><td>Tipo</td><td>{doc.documentType || '—'}</td></tr>
              <tr><td>Documento</td><td>{(doc.prefix ? doc.prefix + ' ' : '') + doc.number}</td></tr>
              <tr><td>CUFE</td><td className="truncate">{doc.cufe || '—'}</td></tr>
              <tr><td>Fecha emisión</td><td>{formatDate(doc.issueDate)}</td></tr>
              <tr><td>Fecha validación</td><td>{formatDate(doc.validationDate)}</td></tr>
              <tr><td>NIT</td><td>{formatNit(doc.nit)}</td></tr>
              <tr><td>Tercero</td><td>{doc.thirdPartyName || '—'}</td></tr>
              <tr><td>Valor total</td><td>{formatMoney(doc.amount)}</td></tr>
              <tr><td>IVA</td><td>{formatMoney(doc.tax)}</td></tr>
              <tr><td>Estado DIAN</td><td>{doc.statusRaw || '—'}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 className="mb-8">Registro contable {matchedLedger ? 'cruzado' : ''}</h4>
          {matchedLedger ? (
            <table className="mini-table">
              <tbody>
                <tr><td>Fecha</td><td>{formatDate(matchedLedger.date)}</td></tr>
                <tr><td>Cuenta</td><td>{matchedLedger.accountCode} — {matchedLedger.accountName}</td></tr>
                <tr><td>Documento</td><td>{matchedLedger.documentNumber || '—'}</td></tr>
                <tr><td>Tercero</td><td>{matchedLedger.thirdPartyName || '—'}</td></tr>
                <tr><td>NIT</td><td>{formatNit(matchedLedger.thirdPartyId)}</td></tr>
                <tr><td>Descripción</td><td>{matchedLedger.description || '—'}</td></tr>
                <tr><td>Valor</td><td>{formatMoney(Math.abs(matchedLedger.amount))}</td></tr>
              </tbody>
            </table>
          ) : (
            <EmptyState icon={<IconAlert size={20} />} title="Sin registro contable" description="No se encontró un movimiento en el auxiliar para este documento." />
          )}

          <h4 className="mb-8 mt-16">¿Por qué se seleccionó esta coincidencia?</h4>
          <MatchReasonsList match={match} />
        </div>
      </div>

      <div className="row mt-16" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {status === 'NO_VALIDO' && (
          <span className="badge neutral">No requiere soporte contable: documento {doc.statusRaw?.toLowerCase() || 'no válido'}.</span>
        )}
        {matchedLedger && (
          <button className="btn" onClick={() => { unlinkDian(doc.id); onClose(); }}>
            <IconUnlink size={14} /> Desvincular
          </button>
        )}
        {matchedLedger && match && match.status !== 'CONCILIADO' && (
          <button className="btn" onClick={() => { rejectDianMatch(doc.id, matchedLedger.id); onClose(); }}>
            <IconX size={14} /> Rechazar
          </button>
        )}
        {matchedLedger && match && match.status !== 'CONCILIADO' && (
          <button className="btn primary" onClick={() => { acceptDianMatch(doc.id, matchedLedger.id); onClose(); }}>
            <IconCheck size={14} /> Aceptar coincidencia
          </button>
        )}
        <button className="btn" onClick={() => { toggleIgnoreDian('dian', doc.id); onClose(); }}>
          Ignorar documento
        </button>
      </div>
    </Modal>
  );
}

function LedgerDetail({
  row,
  dian,
  result,
  onClose,
}: {
  row: LedgerTx;
  dian: DianTx[];
  result: DianReconciliationResult;
  onClose: () => void;
}) {
  const toggleIgnoreDian = useStore((s) => s.toggleIgnoreDian);
  const status = result.ledgerStatus.get(row.id) ?? 'NO_CONCILIADO';
  const match = result.byLedger.get(row.id);
  const matchedDoc = match ? dian.find((d) => d.id === match.dianId) : null;

  return (
    <Modal open onClose={onClose} title="Detalle del registro contable" subtitle={<DianStatusBadge status={status} />} size="wide">
      <table className="mini-table">
        <tbody>
          <tr><td>Fecha</td><td>{formatDate(row.date)}</td></tr>
          <tr><td>Cuenta</td><td>{row.accountCode} — {row.accountName}</td></tr>
          <tr><td>Documento</td><td>{row.documentNumber || '—'}</td></tr>
          <tr><td>Tercero</td><td>{row.thirdPartyName || '—'}</td></tr>
          <tr><td>NIT</td><td>{formatNit(row.thirdPartyId)}</td></tr>
          <tr><td>Descripción</td><td>{row.description || '—'}</td></tr>
          <tr><td>Valor</td><td>{formatMoney(Math.abs(row.amount))}</td></tr>
        </tbody>
      </table>

      {matchedDoc ? (
        <Notice type="success">Cruzado con el documento DIAN {(matchedDoc.prefix ? matchedDoc.prefix + ' ' : '') + matchedDoc.number}.</Notice>
      ) : (
        <Notice type="warning">No se encontró un documento electrónico DIAN que soporte este registro contable.</Notice>
      )}

      <div className="row mt-16" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => { toggleIgnoreDian('ledger', row.id); onClose(); }}>
          Ignorar registro
        </button>
      </div>
    </Modal>
  );
}
