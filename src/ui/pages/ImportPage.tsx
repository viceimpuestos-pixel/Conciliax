/**
 * Importación paso a paso: cargar, detectar, mapear, validar, normalizar y conciliar.
 */

import React, { useRef, useState } from 'react';
import { useStore, type ImportSlot } from '../../state/store';
import { fieldsFor } from '../../core/parsing/columnMap';
import { ACCEPTED_EXTENSIONS } from '../../core/parsing/loadFile';
import type { Dataset, FieldSpec, ValidationIssue } from '../../core/types';
import { formatDate } from '../../core/normalize/dates';
import { formatMoney, formatNumber } from '../../core/normalize/money';
import {
  Card,
  EmptyState,
  Field,
  Help,
  IconAlert,
  IconBank,
  IconCheck,
  IconFile,
  IconPlay,
  IconRefresh,
  IconTable,
  IconTrash,
  IconUpload,
  Notice,
  Switch,
  Tooltip,
} from '../components/primitives';

const STEPS = [
  'Cargar extracto',
  'Cargar auxiliar',
  'Detectar columnas',
  'Confirmar mapeo',
  'Validar',
  'Normalizar',
  'Conciliar',
  'Resultados',
];

export function ImportPage() {
  const bank = useStore((s) => s.bank);
  const ledger = useStore((s) => s.ledger);
  const bankDataset = useStore((s) => s.bankDataset);
  const ledgerDataset = useStore((s) => s.ledgerDataset);
  const buildOptions = useStore((s) => s.buildOptions);
  const setBuildOptions = useStore((s) => s.setBuildOptions);
  const buildDatasets = useStore((s) => s.buildDatasets);
  const loadBankFile = useStore((s) => s.loadBankFile);
  const loadLedgerFile = useStore((s) => s.loadLedgerFile);
  const loadDemo = useStore((s) => s.loadDemo);
  const clearAll = useStore((s) => s.clearAll);
  const run = useStore((s) => s.run);
  const error = useStore((s) => s.error);
  const warnings = useStore((s) => s.warnings);
  const result = useStore((s) => s.result);
  const setSection = useStore((s) => s.setSection);

  const bothLoaded = Boolean(bank.file && ledger.file);
  const missing = [...(bank.detection?.missingRequired ?? []), ...(ledger.detection?.missingRequired ?? [])];

  // Paso actual deducido del estado real (no de un contador manual)
  const step = !bank.file ? 1 : !ledger.file ? 2 : result ? 8 : bankDataset ? 5 : 4;

  const previewDatasets = () => {
    buildDatasets();
  };

  return (
    <div className="content narrow" style={{ padding: 0 }}>
      <div className="page-head">
        <div>
          <h2>Importación de archivos</h2>
          <div className="sub">
            Cargue el extracto de Bancolombia (Excel, CSV o PDF) y el movimiento auxiliar por tercero.
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void loadDemo()}>
            <IconTable size={15} /> Cargar datos de demostración
          </button>
          {(bank.file || ledger.file) && (
            <button className="btn ghost" onClick={clearAll}>
              <IconTrash size={15} /> Limpiar todo
            </button>
          )}
        </div>
      </div>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < step ? 'done' : n === step ? 'current' : '';
          return (
            <div key={label} className={'step ' + state}>
              <span className="num">{n < step ? <IconCheck size={12} /> : n}</span>
              {label}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-16">
          <Notice type="error">{error}</Notice>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="col mb-16">
          {warnings.map((w, i) => (
            <Notice key={i} type={w.includes('escaneado') ? 'error' : 'info'}>
              {w}
            </Notice>
          ))}
        </div>
      )}

      {/* Pasos 1 y 2: carga */}
      <div className="chart-grid mb-16">
        <div className="span-6">
          <FileSlot
            title="1. Extracto bancario"
            subtitle="Bancolombia u otro banco · .xlsx .xls .csv .pdf"
            icon={<IconBank size={17} />}
            slot={bank}
            onFile={(f) => void loadBankFile(f)}
          />
        </div>
        <div className="span-6">
          <FileSlot
            title="2. Auxiliar contable por tercero"
            subtitle="Movimiento auxiliar · .xlsx .xls .csv"
            icon={<IconFile size={17} />}
            slot={ledger}
            onFile={(f) => void loadLedgerFile(f)}
          />
        </div>
      </div>

      {!bothLoaded && (
        <Card>
          <EmptyState
            icon={<IconUpload size={24} />}
            title="Cargue los dos archivos para continuar"
            description={
              <>
                La aplicación detecta automáticamente las columnas, normaliza fechas y valores, y ejecuta la
                conciliación. Si prefiere ver primero cómo funciona, use el botón
                <strong> Cargar datos de demostración</strong>.
              </>
            }
          />
        </Card>
      )}

      {bothLoaded && (
        <>
          {/* Pasos 3 y 4: mapeo */}
          <Mapper which="bank" title="3-4. Columnas del extracto bancario" />
          <Mapper which="ledger" title="3-4. Columnas del auxiliar contable" />

          {/* Paso 6: opciones de normalización */}
          <Card
            title="6. Opciones de normalización"
            subtitle="Ajuste sólo si la vista previa muestra fechas o valores incorrectos."
            className="mb-16"
          >
            <div className="filter-bar">
              <Field
                label={
                  <span className="row" style={{ gap: 5 }}>
                    Orden de fecha <Help text="En Colombia el formato usual es día/mes/año. Cambie a mes/día/año si su archivo viene en formato estadounidense." />
                  </span>
                }
                width="md"
              >
                <select
                  value={buildOptions.dateOrder}
                  onChange={(e) => {
                    setBuildOptions({ dateOrder: e.target.value as never });
                    previewDatasets();
                  }}
                >
                  <option value="auto">Automático (recomendado)</option>
                  <option value="dmy">Día / Mes / Año</option>
                  <option value="mdy">Mes / Día / Año</option>
                  <option value="ymd">Año / Mes / Día</option>
                </select>
              </Field>

              <Field
                label={
                  <span className="row" style={{ gap: 5 }}>
                    Separador decimal <Help text="Automático interpreta 1.234 como mil doscientos treinta y cuatro (uso colombiano) y 1.23 como un decimal." />
                  </span>
                }
                width="md"
              >
                <select
                  value={buildOptions.decimalHint}
                  onChange={(e) => {
                    setBuildOptions({ decimalHint: e.target.value as never });
                    previewDatasets();
                  }}
                >
                  <option value="auto">Automático (recomendado)</option>
                  <option value="coma">Coma decimal (1.234,56)</option>
                  <option value="punto">Punto decimal (1,234.56)</option>
                </select>
              </Field>

              <Field
                label={
                  <span className="row" style={{ gap: 5 }}>
                    Naturaleza del auxiliar
                    <Help text="Si el auxiliar es la cuenta de bancos (11xx), un débito representa una entrada de dinero. Si exportó una cuenta espejo (proveedores/clientes), invierta la convención." />
                  </span>
                }
                width="lg"
              >
                <select
                  value={buildOptions.ledgerSign}
                  onChange={(e) => {
                    setBuildOptions({ ledgerSign: e.target.value as never });
                    previewDatasets();
                  }}
                >
                  <option value="debito-ingreso">Cuenta de bancos: débito = entrada</option>
                  <option value="credito-ingreso">Cuenta espejo: crédito = entrada</option>
                </select>
              </Field>

              <Field label="Filas de totales" width="auto">
                <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                  <Switch
                    checked={buildOptions.dropTotals !== false}
                    onChange={(v) => {
                      setBuildOptions({ dropTotals: v });
                      previewDatasets();
                    }}
                    label="Omitir subtotales y totales"
                  />
                </div>
              </Field>

              <button className="btn" onClick={previewDatasets}>
                <IconRefresh size={15} /> Actualizar vista previa
              </button>
            </div>
          </Card>

          {/* Paso 5: validación */}
          {(bankDataset || ledgerDataset) && (
            <div className="chart-grid mb-16">
              <div className="span-6">
                <SummaryCard title="5. Resumen del extracto bancario" dataset={bankDataset} kind="bank" />
              </div>
              <div className="span-6">
                <SummaryCard title="5. Resumen del auxiliar contable" dataset={ledgerDataset} kind="ledger" />
              </div>
            </div>
          )}

          {/* Paso 7 */}
          <Card>
            <div className="row wrap" style={{ gap: 12 }}>
              <div className="grow">
                <h3 style={{ fontSize: 14 }}>7. Ejecutar la conciliación</h3>
                <div className="small muted mt-8">
                  {missing.length > 0 ? (
                    <span style={{ color: 'var(--red-600)' }}>
                      Faltan campos obligatorios por mapear. Revise los recuadros marcados en rojo.
                    </span>
                  ) : (
                    <>
                      Se cruzarán <strong>{formatNumber(bankDataset?.rows.length ?? 0)}</strong> movimientos bancarios
                      contra <strong>{formatNumber(ledgerDataset?.rows.length ?? 0)}</strong> registros contables.
                    </>
                  )}
                </div>
              </div>
              <button
                className="btn primary"
                disabled={missing.length > 0}
                onClick={() => {
                  void run().then(() => setSection('dashboard'));
                }}
              >
                <IconPlay size={14} /> Ejecutar conciliación
              </button>
            </div>
          </Card>

          {result && (
            <div className="mt-16">
              <Notice type="success">
                <strong>Conciliación finalizada.</strong> Se generaron {formatNumber(result.matches.length)} cruces en{' '}
                {result.elapsedMs} ms.{' '}
                <button className="btn xs" style={{ marginLeft: 6 }} onClick={() => setSection('dashboard')}>
                  Ver dashboard
                </button>
              </Notice>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/* Zona de carga                                                       */
/* ================================================================== */

function FileSlot({
  title,
  subtitle,
  icon,
  slot,
  onFile,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  slot: ImportSlot;
  onFile: (f: File) => void;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reloadWithSheet = useStore((s) => s.reloadWithSheet);
  const which = title.includes('extracto') || title.includes('Extracto') ? 'bank' : 'ledger';

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
            <div className="dz-sub">Formatos admitidos: Excel (.xlsx, .xls), CSV y PDF de texto.</div>
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

      {file && file.sheet.sheetNames.length > 1 && (
        <div className="filter-bar mt-12">
          <Field label="Hoja del libro" width="lg">
            <select
              value={file.sheet.sheetName}
              onChange={(e) => void reloadWithSheet(which, e.target.value)}
            >
              {file.sheet.sheetNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {file && (
        <div className="filter-bar mt-12">
          <Field
            label={
              <span className="row" style={{ gap: 5 }}>
                Fila de encabezados
                <Help text="La aplicación la detecta sola. Cámbiela si el archivo trae membrete y las columnas no se reconocen." />
              </span>
            }
            width="sm"
          >
            <input
              type="number"
              min={1}
              value={file.sheet.headerRowIndex + 1}
              onChange={(e) => void reloadWithSheet(which, undefined, Math.max(0, Number(e.target.value) - 1))}
            />
          </Field>
          <button className="btn sm" onClick={() => inputRef.current?.click()}>
            <IconRefresh size={14} /> Cambiar archivo
          </button>
        </div>
      )}

      {file && file.sheet.rows.length > 0 && <RawPreview headers={file.sheet.headers} rows={file.sheet.rows} />}
    </Card>
  );
}

function RawPreview({ headers, rows }: { headers: string[]; rows: unknown[][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-12">
      <button className="btn xs ghost" onClick={() => setOpen((v) => !v)}>
        {open ? 'Ocultar' : 'Ver'} vista previa del archivo
      </button>
      {open && (
        <div className="table-wrap mt-8" style={{ maxHeight: 220, border: '1px solid var(--grey-200)', borderRadius: 8 }}>
          <table className="data preview-table">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  {headers.map((_, j) => (
                    <td key={j}>{r[j] instanceof Date ? formatDate(r[j] as Date) : String(r[j] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Mapeo de columnas                                                   */
/* ================================================================== */

function Mapper({ which, title }: { which: 'bank' | 'ledger'; title: string }) {
  const slot = useStore((s) => s[which]);
  const setMapping = useStore((s) => s.setMapping);
  const autoDetect = useStore((s) => s.autoDetect);
  const buildDatasets = useStore((s) => s.buildDatasets);

  if (!slot.file) return null;

  const specs = fieldsFor(which);
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
          {missing.length > 0 && (
            <span style={{ color: 'var(--red-600)', fontWeight: 600 }}> Faltan campos obligatorios.</span>
          )}
        </>
      }
      right={
        <button
          className="btn sm"
          onClick={() => {
            autoDetect(which);
            buildDatasets();
          }}
        >
          <IconRefresh size={14} /> Volver a detectar
        </button>
      }
      className="mb-16"
    >
      <div className="map-grid">
        {specs.map((spec) => (
          <MapRow
            key={spec.key}
            spec={spec}
            headers={headers}
            value={slot.mapping[spec.key] ?? -1}
            confidence={slot.detection?.confidence[spec.key] ?? 0}
            missing={missing.includes(spec.key)}
            sample={sampleFor(slot.mapping[spec.key] ?? -1)}
            onChange={(idx) => {
              setMapping(which, spec.key, idx);
              buildDatasets();
            }}
          />
        ))}
      </div>

      {(slot.mapping.debit < 0 && slot.mapping.credit < 0 && slot.mapping.amount < 0) && (
        <div className="mt-12">
          <Notice type="error">
            Debe mapear <strong>Débito y Crédito</strong>, o bien una única columna de <strong>Valor</strong> con signo.
          </Notice>
        </div>
      )}
    </Card>
  );
}

function MapRow({
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
/* Resumen del dataset                                                 */
/* ================================================================== */

function SummaryCard<T>({
  title,
  dataset,
  kind,
}: {
  title: string;
  dataset: Dataset<T> | null;
  kind: 'bank' | 'ledger';
}) {
  if (!dataset) {
    return (
      <Card title={title}>
        <EmptyState title="Aún sin procesar" description="Confirme el mapeo de columnas para ver el resumen." />
      </Card>
    );
  }

  const s = dataset.stats;
  const errors = dataset.issues.filter((i) => i.level === 'error');

  return (
    <Card title={title} subtitle={dataset.fileName}>
      <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <Mini label="Registros válidos" value={formatNumber(s.valid)} />
        <Mini label="Descartados" value={formatNumber(s.discarded)} tone={s.discarded ? 'amber' : undefined} />
        <Mini label={kind === 'bank' ? 'Total créditos' : 'Total débitos'} value={formatMoney(kind === 'bank' ? s.totalCredit : s.totalDebit)} />
        <Mini label={kind === 'bank' ? 'Total débitos' : 'Total créditos'} value={formatMoney(kind === 'bank' ? s.totalDebit : s.totalCredit)} />
        <Mini label="Neto del período" value={formatMoney(s.net)} tone={s.net >= 0 ? 'green' : 'red'} />
        <Mini
          label="Período"
          value={s.minDate ? formatDate(s.minDate) + ' → ' + formatDate(s.maxDate) : 'Sin fechas'}
          small
        />
        {kind === 'ledger' && <Mini label="Terceros distintos" value={formatNumber(s.distinctThirdParties)} />}
        <Mini label="Posibles duplicados" value={formatNumber(s.duplicates)} tone={s.duplicates ? 'amber' : undefined} />
      </div>

      {dataset.issues.length > 0 && (
        <div className="col">
          {dataset.issues.map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}
        </div>
      )}

      {!errors.length && !dataset.issues.length && <Notice type="success">Sin observaciones. La información quedó lista.</Notice>}
    </Card>
  );
}

function Mini({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'red' | 'amber';
  small?: boolean;
}) {
  return (
    <div className={'kpi ' + (tone ?? 'grey')} style={{ padding: '10px 12px' }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value sm" style={small ? { fontSize: 13.5 } : undefined}>
        {value}
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  const type = issue.level === 'error' ? 'error' : issue.level === 'warning' ? 'warning' : 'info';
  return (
    <Notice type={type as never}>
      {issue.message}
      {issue.count !== undefined && <strong> ({issue.count})</strong>}
      {issue.rows && issue.rows.length > 0 && (
        <div className="small mt-8 muted">Filas del archivo: {issue.rows.join(', ')}{issue.count && issue.count > issue.rows.length ? '…' : ''}</div>
      )}
    </Notice>
  );
}
