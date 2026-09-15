/**
 * Configuración del motor: pesos, tolerancias y umbrales.
 */

import React, { useState } from 'react';
import { useStore } from '../../state/store';
import { useHasData, useKpis } from '../../state/selectors';
import {
  CONFIG_PRESETS,
  DEFAULT_CONFIG,
  WEIGHT_LABELS,
  cloneConfig,
  type CriteriaWeights,
  type ReconciliationConfig,
} from '../../core/reconciliation/config';
import { Card, Field, Help, IconCheck, IconPlay, IconRefresh, Notice, Switch } from '../components/primitives';
import { formatNumber, formatPercent } from '../../core/normalize/money';

export function SettingsPage() {
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const run = useStore((s) => s.run);
  const hasData = useHasData();
  const kpis = useKpis();
  const [dirty, setDirty] = useState(false);

  const update = (fn: (c: ReconciliationConfig) => void) => {
    const next = cloneConfig(config);
    fn(next);
    setConfig(next);
    setDirty(true);
  };

  const applyPreset = (id: string) => {
    const preset = CONFIG_PRESETS.find((p) => p.id === id);
    if (preset) {
      setConfig(cloneConfig(preset.config));
      setDirty(true);
    }
  };

  const maxScore = Object.values(config.weights).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Configuración del algoritmo</h2>
          <div className="sub">
            Ajuste cómo el motor decide que un movimiento bancario corresponde a un registro contable.
          </div>
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={() => {
              setConfig(cloneConfig(DEFAULT_CONFIG));
              setDirty(true);
            }}
          >
            <IconRefresh size={15} /> Restaurar valores por defecto
          </button>
          <button
            className="btn primary"
            disabled={!hasData}
            onClick={() => {
              void run();
              setDirty(false);
            }}
          >
            <IconPlay size={14} /> Volver a conciliar
          </button>
        </div>
      </div>

      {dirty && hasData && (
        <div className="mb-16">
          <Notice type="warning">
            Cambió la configuración. Pulse <strong>Volver a conciliar</strong> para recalcular con los nuevos parámetros.
          </Notice>
        </div>
      )}

      {hasData && (
        <div className="kpi-grid">
          <div className="kpi green">
            <div className="kpi-label">Conciliados actualmente</div>
            <div className="kpi-value">{formatNumber(kpis.conciliados)}</div>
            <div className="kpi-foot">{formatPercent(kpis.porcentajeConciliacion)} del extracto</div>
          </div>
          <div className="kpi amber">
            <div className="kpi-label">Pendientes</div>
            <div className="kpi-value">{formatNumber(kpis.probables + kpis.pendientes + kpis.difValor + kpis.difFecha)}</div>
            <div className="kpi-foot">Sugerencias por confirmar</div>
          </div>
          <div className="kpi grey">
            <div className="kpi-label">No conciliados</div>
            <div className="kpi-value">{formatNumber(kpis.noConciliados + kpis.duplicados)}</div>
            <div className="kpi-foot">Partidas conciliatorias</div>
          </div>
        </div>
      )}

      {/* Perfiles */}
      <Card title="Perfiles predefinidos" subtitle="Un punto de partida según qué tan estricta deba ser la conciliación" className="mb-16">
        <div className="map-grid">
          {CONFIG_PRESETS.map((p) => (
            <div className="map-row" key={p.id}>
              <div className="map-label">{p.name}</div>
              <div className="map-meta" style={{ display: 'block', lineHeight: 1.5 }}>{p.description}</div>
              <button className="btn sm mt-8" onClick={() => applyPreset(p.id)}>
                <IconCheck size={13} /> Aplicar
              </button>
            </div>
          ))}
        </div>
      </Card>

      <div className="chart-grid">
        {/* Umbrales */}
        <div className="span-6">
          <Card
            title="Umbrales de clasificación"
            subtitle="Score de confianza 0-100 a partir del cual se asigna cada estado"
          >
            <Slider
              label="Conciliado (verde)"
              help="Score mínimo para dar un cruce por conciliado automáticamente."
              value={config.thresholds.conciliado}
              min={50}
              max={100}
              onChange={(v) => update((c) => { c.thresholds.conciliado = v; })}
            />
            <Slider
              label="Coincidencia probable"
              help="Por encima de este score el cruce se propone, pero requiere su aprobación."
              value={config.thresholds.probable}
              min={30}
              max={99}
              onChange={(v) => update((c) => { c.thresholds.probable = v; })}
            />
            <Slider
              label="Pendiente de revisión"
              help="Por debajo de este score el movimiento se marca como no conciliado."
              value={config.thresholds.revision}
              min={10}
              max={90}
              onChange={(v) => update((c) => { c.thresholds.revision = v; })}
            />

            <div className="mt-16">
              <Notice type="info">
                Escala actual: <strong>{config.thresholds.conciliado}-100</strong> conciliado ·{' '}
                <strong>{config.thresholds.probable}-{config.thresholds.conciliado - 1}</strong> probable ·{' '}
                <strong>{config.thresholds.revision}-{config.thresholds.probable - 1}</strong> revisión ·{' '}
                <strong>0-{config.thresholds.revision - 1}</strong> no conciliado.
              </Notice>
            </div>
          </Card>
        </div>

        {/* Tolerancias */}
        <div className="span-6">
          <Card title="Tolerancias" subtitle="Qué tanta diferencia se admite para considerar un cruce">
            <div className="filter-bar">
              <Field
                label={<span className="row" style={{ gap: 5 }}>Diferencia de valor admitida ($) <Help text="Diferencia máxima en pesos para que el valor se considere coincidente." /></span>}
                width="md"
              >
                <input
                  type="number"
                  min={0}
                  value={config.tolerances.amountAbsolute}
                  onChange={(e) => update((c) => { c.tolerances.amountAbsolute = Number(e.target.value); })}
                />
              </Field>

              <Field label="Diferencia porcentual (%)" width="sm">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={config.tolerances.amountPercent}
                  onChange={(e) => update((c) => { c.tolerances.amountPercent = Number(e.target.value); })}
                />
              </Field>

              <Field
                label={<span className="row" style={{ gap: 5 }}>Días de diferencia <Help text="Desfase máximo entre la fecha del banco y la de contabilidad que aún suma puntos." /></span>}
                width="sm"
              >
                <input
                  type="number"
                  min={0}
                  value={config.tolerances.dateWindowDays}
                  onChange={(e) => update((c) => { c.tolerances.dateWindowDays = Number(e.target.value); })}
                />
              </Field>

              <Field
                label={<span className="row" style={{ gap: 5 }}>Días máximos <Help text="Más allá de este desfase el par se descarta por completo." /></span>}
                width="sm"
              >
                <input
                  type="number"
                  min={1}
                  value={config.tolerances.maxDateDays}
                  onChange={(e) => update((c) => { c.tolerances.maxDateDays = Number(e.target.value); })}
                />
              </Field>

              <Field
                label={<span className="row" style={{ gap: 5 }}>Ventana de diferencias ($) <Help text="Permite detectar DIFERENCIAS DE VALOR (retención, GMF, comisión): pares cuyo valor difiere más que la tolerancia pero que el tercero o el documento respaldan." /></span>}
                width="md"
              >
                <input
                  type="number"
                  min={0}
                  value={config.tolerances.diffWindowAbsolute}
                  onChange={(e) => update((c) => { c.tolerances.diffWindowAbsolute = Number(e.target.value); })}
                />
              </Field>

              <Field label="Ventana de diferencias (%)" width="sm">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={config.tolerances.diffWindowPercent}
                  onChange={(e) => update((c) => { c.tolerances.diffWindowPercent = Number(e.target.value); })}
                />
              </Field>
            </div>

            <div className="mt-16">
              <Slider
                label="Similitud mínima de descripción"
                help="0 = cualquier texto suma puntos; 100 = sólo textos casi idénticos."
                value={Math.round(config.tolerances.descriptionMin * 100)}
                min={0}
                max={100}
                onChange={(v) => update((c) => { c.tolerances.descriptionMin = v / 100; })}
              />
              <Slider
                label="Similitud mínima del nombre del tercero"
                help="Qué tan parecido debe ser el nombre del tercero para sumar puntos."
                value={Math.round(config.tolerances.nameMin * 100)}
                min={0}
                max={100}
                onChange={(v) => update((c) => { c.tolerances.nameMin = v / 100; })}
              />
            </div>

            <div className="mt-16 col">
              <Switch
                checked={config.options.requireDirectionMatch}
                onChange={(v) => update((c) => { c.options.requireDirectionMatch = v; })}
                label="Exigir naturaleza coherente (una entrada en el banco sólo cruza con una entrada contable)"
              />
              <Switch
                checked={config.options.flagAmbiguous}
                onChange={(v) => update((c) => { c.options.flagAmbiguous = v; })}
                label="Marcar como revisión cuando hay varios candidatos con el mismo puntaje"
              />
            </div>
          </Card>
        </div>

        {/* Pesos */}
        <div className="span-12">
          <Card
            title="Pesos de los criterios"
            subtitle={
              <>
                El score final es la suma de los puntos obtenidos dividida entre el máximo aplicable al par, llevada a
                una escala de 0 a 100. Suma total de pesos: <strong>{maxScore}</strong>.
              </>
            }
          >
            <div className="map-grid">
              {(Object.keys(config.weights) as (keyof CriteriaWeights)[]).map((k) => (
                <div className="map-row" key={k}>
                  <div className="map-label">{WEIGHT_LABELS[k]}</div>
                  <div className="slider-row mt-8">
                    <input
                      type="range"
                      min={0}
                      max={50}
                      value={config.weights[k]}
                      onChange={(e) => update((c) => { c.weights[k] = Number(e.target.value); })}
                    />
                    <span className="val">{config.weights[k]} pts</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-16">
              <Notice type="info">
                Un criterio con peso <strong>0</strong> deja de participar en la decisión. Si su extracto no trae NIT ni
                referencias, esos criterios simplemente no se aplican: el score se normaliza sólo con los criterios que
                sí se pueden evaluar, de modo que no penalizan.
              </Notice>
            </div>
          </Card>
        </div>

        {/* Rendimiento */}
        <div className="span-12">
          <Card title="Rendimiento" subtitle="Límites del motor para archivos grandes">
            <div className="filter-bar">
              <Field
                label={<span className="row" style={{ gap: 5 }}>Candidatos por movimiento <Help text="Cuántos registros contables se evalúan como posibles contrapartes de cada movimiento bancario." /></span>}
                width="md"
              >
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={config.options.maxCandidates}
                  onChange={(e) => update((c) => { c.options.maxCandidates = Number(e.target.value); })}
                />
              </Field>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Slider({
  label,
  help,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-12">
      <div className="row" style={{ gap: 5, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
        {label}
        {help && <Help text={help} />}
      </div>
      <div className="slider-row">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="val">{value}</span>
      </div>
    </div>
  );
}
