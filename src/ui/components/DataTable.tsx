/**
 * Tabla profesional reutilizable: encabezado fijo, ordenamiento,
 * paginación y exportación de lo que está en pantalla.
 */

import React, { useMemo, useState, type ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight, IconDownload, IconTable, EmptyState } from './primitives';
import { exportRows } from '../../core/export/excel';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Contenido de la celda. */
  render: (row: T, index: number) => ReactNode;
  /** Valor usado para ordenar y para exportar. */
  sortValue?: (row: T) => string | number | null;
  /** Valor usado al exportar a Excel (por defecto, sortValue). */
  exportValue?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  width?: number | string;
  nowrap?: boolean;
  className?: string;
  sortable?: boolean;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  rowClassName?: (row: T) => string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  /** Nombre base del archivo si se permite exportar. */
  exportName?: string;
  toolbar?: ReactNode;
  maxHeight?: boolean;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  rowClassName,
  pageSize = 50,
  emptyTitle = 'Sin registros',
  emptyDescription,
  exportName,
  toolbar,
  maxHeight = true,
  initialSort,
}: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages - 1);
  const slice = sorted.slice(current * size, current * size + size);

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  const doExport = () => {
    const data = sorted.map((r, i) => {
      const obj: Record<string, unknown> = {};
      for (const c of columns) {
        const get = c.exportValue ?? c.sortValue;
        if (!get) continue;
        obj[typeof c.header === 'string' ? c.header : c.key] = get(r);
      }
      return obj;
    });
    exportRows(data, 'Datos', (exportName ?? 'Conciliax') + '.xlsx');
  };

  if (!rows.length) {
    return (
      <>
        {toolbar}
        <EmptyState icon={<IconTable size={24} />} title={emptyTitle} description={emptyDescription} />
      </>
    );
  }

  return (
    <>
      {toolbar}
      <div className={'table-wrap' + (maxHeight ? ' fixed-h' : '')}>
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false && Boolean(c.sortValue);
                return (
                  <th
                    key={c.key}
                    className={
                      (c.align === 'right' ? 'num ' : '') +
                      (sortable ? 'sortable ' : '') +
                      (c.nowrap ? 'nowrap ' : '')
                    }
                    style={c.width ? { width: c.width } : undefined}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}
                  >
                    {c.header}
                    {sort?.key === c.key && <span className="arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={
                    (onRowClick ? 'clickable ' : '') +
                    (selectedKey === key ? 'selected ' : '') +
                    (rowClassName ? rowClassName(row) : '')
                  }
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={
                        (c.align === 'right' ? 'num ' : '') +
                        (c.nowrap ? 'nowrap ' : '') +
                        (c.className ?? '')
                      }
                    >
                      {c.render(row, current * size + i)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <span>
          <strong className="tnum">{sorted.length.toLocaleString('es-CO')}</strong> registro
          {sorted.length === 1 ? '' : 's'}
          {sorted.length > size && (
            <>
              {' '}· mostrando {current * size + 1}–{Math.min(sorted.length, current * size + size)}
            </>
          )}
        </span>

        {exportName && (
          <button className="btn xs" onClick={doExport} title="Exportar a Excel lo que está en pantalla">
            <IconDownload size={13} /> Excel
          </button>
        )}

        <div className="pager">
          <select
            className="btn xs"
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              setPage(0);
            }}
            style={{ paddingRight: 4 }}
          >
            {[25, 50, 100, 250, 1000].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
          <button className="btn xs" disabled={current === 0} onClick={() => setPage(current - 1)}>
            <IconChevronLeft size={13} />
          </button>
          <span className="small tnum" style={{ minWidth: 62, textAlign: 'center' }}>
            {current + 1} / {pages}
          </span>
          <button className="btn xs" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            <IconChevronRight size={13} />
          </button>
        </div>
      </div>
    </>
  );
}
