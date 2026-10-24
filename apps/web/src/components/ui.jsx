import { useState } from 'react';
import { title, tone } from '../lib/format.js';

export function Button({ variant = 'primary', size, busy, children, className = '', ...props }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} disabled={busy || props.disabled} {...props}>
      {busy && <span className="spinner spinner-sm" aria-hidden />}
      {children}
    </button>
  );
}

export function Badge({ status, children, kind }) {
  return <span className={`badge badge-${kind ?? tone(status)}`}>{children ?? title(status)}</span>;
}

export function Card({ title: heading, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(heading || actions) && (
        <header className="card-head">
          {heading && <h3>{heading}</h3>}
          {actions && <div className="row gap-sm">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="center muted pad-lg">
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

export function Empty({ icon = '∅', title: heading, children }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <strong>{heading}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/** Renders an ApiError (or any Error) with its code, validation issues and request id. */
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  const issues = Array.isArray(error.details) ? error.details : null;
  return (
    <div className="alert alert-bad" role="alert">
      <div className="row between">
        <strong>{error.message}</strong>
        {error.code && <code className="tag">{error.code}</code>}
      </div>
      {issues && (
        <ul className="issues">
          {issues.map((i, n) => (
            <li key={n}>
              <code>{i.path}</code> {i.message}
            </li>
          ))}
        </ul>
      )}
      {!issues && error.details && <pre className="json json-sm">{JSON.stringify(error.details, null, 2)}</pre>}
      <div className="row between small muted">
        <span>{error.status ? `HTTP ${error.status}` : ''}{error.requestId ? ` · request ${error.requestId}` : ''}</span>
        {onRetry && (
          <button className="link" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Json({ value, small }) {
  return <pre className={`json ${small ? 'json-sm' : ''}`}>{JSON.stringify(value, null, 2)}</pre>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title: heading, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={heading}>
        <header className="modal-head">
          <h3>{heading}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Stepper({ value, onChange, min = 0, max = 100 }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">
        −
      </button>
      <span>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase" disabled={value >= max}>
        +
      </button>
    </div>
  );
}

export function CopyId({ id }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-id"
      title="Copy full id"
      onClick={() => {
        navigator.clipboard?.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? 'copied' : id.slice(0, 8)}
    </button>
  );
}

/** Form helper: runs an async submit, tracks busy/error, and resets error on next submit. */
export function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (...args) => {
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, setError };
}
