/**
 * Barra de filtros compartida por todos los módulos.
 */

import React, { useState } from 'react';
import { useStore } from '../../state/store';
import { isFilterActive } from '../../state/selectors';
import { STATUS_LABEL, type MatchStatus } from '../../core/types';
import { Field, IconFilter, IconX, IconChevronDown, Help } from './primitives';

const STATUSES: MatchStatus[] = [
  'CONCILIADO',
  'PROBABLE',
  'REVISION',
  'DIF_VALOR',
  'DIF_FECHA',
  'DUPLICADO',
  'NO_CONCILIADO',
  'IGNORADO',
];

export function FilterBar({ compact = false }: { compact?: boolean }) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);
  const [open, setOpen] = useState(!compact);

  const active = isFilterActive(filters);

  const toggleStatus = (s: MatchStatus) => {
    setFilter(
      'estados',
      filters.estados.includes(s) ? filters.estados.filter((x) => x !== s) : [...filters.estados, s],
    );
  };

  return (
    <div className="card mb-16">
      <div className="card-head" style={{ cursor: compact ? 'pointer' : 'default' }} onClick={compact ? () => setOpen((v) => !v) : undefined}>
        <IconFilter size={15} />
        <h3>Filtros</h3>
        {active && <span className="badge info">activos</span>}
        <div className="right">
          <button
            className="btn xs ghost"
            onClick={(e) => {
              e.stopPropagation();
              resetFilters();
            }}
            disabled={!active}
          >
            <IconX size={13} /> Limpiar filtros
          </button>
          {compact && (
            <span className="icon-btn" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
              <IconChevronDown size={15} />
            </span>
          )}
        </div>
      </div>

      {open && (
        <div className="card-body">
          <div className="filter-bar">
            <Field label="Buscar" width="lg">
              <input
                placeholder="Descripción, documento, tercero, valor…"
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
              />
            </Field>

            <Field label="Fecha inicial" width="sm">
              <input type="date" value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)} />
            </Field>

            <Field label="Fecha final" width="sm">
              <input type="date" value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)} />
            </Field>

            <Field label="Tercero" width="md">
              <input
                placeholder="Nombre del tercero"
                value={filters.tercero}
                onChange={(e) => setFilter('tercero', e.target.value)}
              />
            </Field>

            <Field label="NIT" width="sm">
              <input placeholder="900123456" value={filters.nit} onChange={(e) => setFilter('nit', e.target.value)} />
            </Field>

            <Field label="Cuenta" width="sm">
              <input placeholder="11100501" value={filters.cuenta} onChange={(e) => setFilter('cuenta', e.target.value)} />
            </Field>

            <Field label="Valor mínimo" width="sm">
              <input
                inputMode="numeric"
                placeholder="0"
                value={filters.minValor}
                onChange={(e) => setFilter('minValor', e.target.value)}
              />
            </Field>

            <Field label="Valor máximo" width="sm">
              <input
                inputMode="numeric"
                placeholder="Sin tope"
                value={filters.maxValor}
                onChange={(e) => setFilter('maxValor', e.target.value)}
              />
            </Field>

            <Field label="Naturaleza" width="sm">
              <select value={filters.naturaleza} onChange={(e) => setFilter('naturaleza', e.target.value as never)}>
                <option value="todos">Todos</option>
                <option value="debito">Sólo débitos</option>
                <option value="credito">Sólo créditos</option>
              </select>
            </Field>

            <Field
              label={
                <span className="row" style={{ gap: 5 }}>
                  Confianza mínima <Help text="Filtra por el score del motor de conciliación (0 a 100)." />
                </span>
              }
              width="md"
            >
              <div className="slider-row" style={{ height: 32 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={filters.minConfianza}
                  onChange={(e) => setFilter('minConfianza', Number(e.target.value))}
                />
                <span className="val">{filters.minConfianza}%</span>
              </div>
            </Field>
          </div>

          <div className="mt-12">
            <label style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--grey-500)', fontWeight: 600 }}>
              Estado
            </label>
            <div className="status-filter mt-8">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  className={'status-toggle' + (filters.estados.includes(s) ? ' on' : '')}
                  onClick={() => toggleStatus(s)}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
