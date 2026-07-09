'use client';

/** Reusable Tiktó building blocks (wrap the tk-* classes from tikto.css). */
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

type Tone = 'ok' | 'watch' | 'warning' | 'critical' | 'stale';

export function Chip({ tone = 'ok', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tk-chip tk-chip--${tone}`}>{children}</span>;
}

export function DecisionCard({
  title,
  tone,
  chip,
  children,
  className = '',
}: {
  title?: ReactNode;
  tone?: Tone;
  chip?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`tk-card ${tone ? `tk-card--${tone}` : ''} ${className}`}>
      {(title || chip) && (
        <div className="tk-card__head">
          {title && <span className="tk-card__title">{title}</span>}
          {chip}
        </div>
      )}
      {children}
    </div>
  );
}

export function Hero({ value, unit, delta }: { value: ReactNode; unit?: string; delta?: { dir: 'up' | 'down'; text: string } }) {
  return (
    <div className="tk-hero">
      <span className="tk-hero__value">{value}</span>
      {unit && <span className="tk-hero__unit">{unit}</span>}
      {delta && <span className={`tk-hero__delta tk-hero__delta--${delta.dir}`}>{delta.dir === 'up' ? '▲' : '▼'} {delta.text}</span>}
    </div>
  );
}

export function Panel({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`tk-panel ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          {title && <span className="tk-panel__title" style={{ margin: 0 }}>{title}</span>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

const CONF = (v: number) => (v >= 0.75 ? 'var(--tk-ok)' : v >= 0.5 ? 'var(--tk-warning)' : 'var(--tk-critical)');
export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="tk-conf">
      <div className="tk-conf__track"><div className="tk-conf__fill" style={{ width: `${pct}%`, background: CONF(value) }} /></div>
      <span className="tk-conf__label" style={{ color: CONF(value) }}>{pct}%</span>
    </div>
  );
}

export function TrustStrip({ items }: { items: { label: ReactNode; value?: ReactNode; dot?: string }[] }) {
  return (
    <div className="tk-trust">
      {items.map((it, i) => (
        <span key={i} className="flex items-center" style={{ gap: 14 }}>
          {i > 0 && <span className="tk-trust__sep" />}
          <span className="tk-trust__item">
            {it.dot && <span className="tk-trust__dot" style={{ color: it.dot }} />}
            {it.label} {it.value != null && <b>{it.value}</b>}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Provenance-on-pull: a value with a dashed underline that unfolds its derivation. */
export function Provenance({
  children,
  rows,
}: {
  children: ReactNode;
  rows: { k: string; v: ReactNode; weight?: number }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <span>
      <button className="tk-pull inline-flex items-center gap-1" onClick={() => setOpen((o) => !o)} style={{ background: 'none' }}>
        {children} <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
      {open && (
        <div className="tk-prov">
          {rows.map((r, i) => (
            <div key={i} className="tk-prov__row">
              <span className="tk-prov__k">{r.k}</span>
              <span className="tk-prov__v flex items-center gap-2">
                {r.weight != null && <span className="tk-prov__bar" style={{ width: 40 * r.weight }} />}
                {r.v}
              </span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
