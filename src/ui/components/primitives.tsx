/**
 * Componentes reutilizables e iconografía.
 * Todos los iconos son SVG en línea (sin dependencias externas).
 */

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MatchStatus } from '../../core/types';
import { STATUS_LABEL } from '../../core/types';

/* ==================================================================
   Iconos
   ================================================================== */

type IconProps = { size?: number; className?: string; strokeWidth?: number };

const svg = (path: ReactNode, viewBox = '0 0 24 24') =>
  function Icon({ size = 16, className, strokeWidth = 1.8 }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };

export const IconDashboard = svg(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>,
);
export const IconUpload = svg(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M12 4v12" />
  </>,
);
export const IconLink = svg(
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>,
);
export const IconUsers = svg(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);
export const IconBook = svg(
  <>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <path d="M9 7h7M9 11h7" />
  </>,
);
export const IconBell = svg(
  <>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </>,
);
export const IconFile = svg(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h5" />
  </>,
);
export const IconSettings = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);
export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </>,
);
export const IconX = svg(<path d="M18 6 6 18M6 6l12 12" />);
export const IconCheck = svg(<path d="M20 6 9 17l-5-5" />);
export const IconChevronDown = svg(<path d="m6 9 6 6 6-6" />);
export const IconChevronRight = svg(<path d="m9 18 6-6-6-6" />);
export const IconChevronLeft = svg(<path d="m15 18-6-6 6-6" />);
export const IconDownload = svg(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </>,
);
export const IconPlay = svg(<path d="M6 3.5 20 12 6 20.5z" />);
export const IconFilter = svg(<path d="M22 3H2l8 9.46V19l4 2v-8.54z" />);
export const IconAlert = svg(
  <>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
);
export const IconInfo = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </>,
);
export const IconEye = svg(
  <>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconRefresh = svg(
  <>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
  </>,
);
export const IconTrash = svg(
  <>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </>,
);
export const IconPlus = svg(<path d="M12 5v14M5 12h14" />);
export const IconMenu = svg(<path d="M3 6h18M3 12h18M3 18h18" />);
export const IconArrowUp = svg(<path d="M12 19V5M5 12l7-7 7 7" />);
export const IconArrowDown = svg(<path d="M12 5v14M19 12l-7 7-7-7" />);
export const IconBank = svg(
  <>
    <path d="M3 21h18" />
    <path d="M5 21V10M9.5 21V10M14.5 21V10M19 21V10" />
    <path d="M12 3 21 8H3z" />
  </>,
);
export const IconTable = svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18" />
  </>,
);
export const IconUnlink = svg(
  <>
    <path d="M18.84 12.25l1.72-1.71a4 4 0 0 0-5.66-5.66l-1.71 1.72" />
    <path d="M5.17 11.75l-1.71 1.71a4 4 0 0 0 5.66 5.66l1.71-1.71" />
    <path d="M2 2l20 20" />
  </>,
);
export const IconNote = svg(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </>,
);
export const IconEyeOff = svg(
  <>
    <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a18 18 0 0 1-2.16 3.19M6.6 6.6A18 18 0 0 0 2 11s3.6 7 10 7a9 9 0 0 0 5.4-1.6" />
    <path d="M2 2l20 20" />
  </>,
);
export const IconShield = svg(
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </>,
);

/* ==================================================================
   Badges
   ================================================================== */

export function StatusBadge({ status }: { status: MatchStatus }) {
  return (
    <span className={'badge ' + status}>
      <i className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ScoreMeter({ score, showBar = true }: { score: number; showBar?: boolean }) {
  const level = score >= 90 ? 'high' : score >= 70 ? 'mid' : score > 0 ? 'low' : 'none';
  return (
    <span className={'score ' + level}>
      {showBar && (
        <span className="score-bar">
          <i style={{ width: Math.max(2, Math.min(100, score)) + '%' }} />
        </span>
      )}
      {score > 0 ? score.toFixed(0) + '%' : '—'}
    </span>
  );
}

/* ==================================================================
   Tooltip
   ================================================================== */

export function Tooltip({
  content,
  children,
  align = 'center',
}: {
  content: ReactNode;
  children: ReactNode;
  align?: 'center' | 'right';
}) {
  return (
    <span className={'tip' + (align === 'right' ? ' right' : '')}>
      {children}
      <span className="tip-content">{content}</span>
    </span>
  );
}

export function Help({ text }: { text: ReactNode }) {
  return (
    <Tooltip content={text}>
      <span className="help-dot">?</span>
    </Tooltip>
  );
}

/* ==================================================================
   Card
   ================================================================== */

export function Card({
  title,
  subtitle,
  right,
  children,
  flush,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <div className={'card ' + className}>
      {(title || right) && (
        <div className="card-head">
          {title && (
            <div>
              <h3>{title}</h3>
              {subtitle && <div className="sub">{subtitle}</div>}
            </div>
          )}
          {right && <div className="right">{right}</div>}
        </div>
      )}
      <div className={'card-body' + (flush ? ' flush' : '')}>{children}</div>
    </div>
  );
}

/* ==================================================================
   Modal
   ================================================================== */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'md' | 'wide';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const cls = size === 'md' ? '' : ' ' + size;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + cls} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="grow">
            <h3>{title}</h3>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ==================================================================
   Dropdown
   ================================================================== */

export function Dropdown({
  label,
  icon,
  children,
  className = '',
}: {
  label: ReactNode;
  icon?: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button className={'btn ' + className} onClick={() => setOpen((v) => !v)}>
        {icon}
        {label}
        <IconChevronDown size={14} />
      </button>
      {open && <div className="dropdown-menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

/* ==================================================================
   Avisos y estados vacíos
   ================================================================== */

export function Notice({
  type = 'info',
  children,
}: {
  type?: 'info' | 'warning' | 'error' | 'success';
  children: ReactNode;
}) {
  const Ico = type === 'error' || type === 'warning' ? IconAlert : type === 'success' ? IconCheck : IconInfo;
  return (
    <div className={'notice ' + type}>
      <span className="ico">
        <Ico size={15} />
      </span>
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="icon">{icon ?? <IconTable size={24} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

/* ==================================================================
   Otros
   ================================================================== */

export function ProgressBar({
  value,
  tone = 'blue',
}: {
  value: number;
  tone?: 'blue' | 'green' | 'amber' | 'red';
}) {
  const cls = tone === 'blue' ? '' : ' ' + tone;
  return (
    <div className="progress-track">
      <div className={'progress-fill' + cls} style={{ width: Math.max(0, Math.min(100, value)) + '%' }} />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span>{label}</span>
    </label>
  );
}

export function Field({
  label,
  hint,
  width = 'md',
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'auto';
  children: ReactNode;
}) {
  return (
    <div className={'field' + (width === 'auto' ? '' : ' w-' + width)}>
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Celda de dos líneas para las tablas. */
export function Cell({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="cell-main">{main}</div>
      {sub && <div className="cell-sub">{sub}</div>}
    </div>
  );
}
