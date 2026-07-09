'use client';

import { useState, useMemo, useCallback } from 'react';
import { useVolumeHistory } from '@/hooks/useApi';
import { Tick } from '@/components/tikto/Tick';
import { Chip } from '@/components/tikto/primitives';
import { cn } from '@/lib/utils';

const periods = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
];

const usd = (v: number) =>
  `$${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(v)}`;

export function VolumeChart() {
  const [period, setPeriod] = useState('7d');
  const { data, isLoading } = useVolumeHistory(period);

  // Past actuals for the Tick spine. Memoised so scrub re-renders don't rebuild
  // the canvas (which would drop an in-progress drag).
  const past = useMemo(() => (data?.points || []).map((p) => Math.round(p.volume)), [data]);
  const base = past.length ? past[past.length - 1] : undefined;

  // The forward cone's slope tracks the real trend across the window — a
  // scenario you scrub, not a claimed number.
  const drift = useMemo(() => {
    if (past.length < 2 || !past[0]) return 0.05;
    const t = (past[past.length - 1] - past[0]) / past[0];
    return Math.max(-0.35, Math.min(0.35, t * 0.5));
  }, [past]);

  const [scrub, setScrub] = useState<{ v: number; future: boolean } | null>(null);
  const onScrub = useCallback((v: number, future: boolean) => {
    setScrub((prev) => (prev && prev.v === v && prev.future === future ? prev : { v, future }));
  }, []);

  const win = useMemo(() => {
    if (!past.length) return null;
    const total = past.reduce((a, b) => a + b, 0);
    return { total, peak: Math.max(...past), avg: total / past.length };
  }, [past]);

  return (
    <div className="tk-panel h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="tk-panel__title" style={{ margin: 0 }}>Bridge volume</span>
          <span className="tk-label">navigable time</span>
        </div>
        <div className="flex items-center gap-3">
          {scrub && (
            <span className="tk-tick__readout">
              {scrub.future ? 'projection' : 'actual'} <b>{usd(scrub.v)}</b>
            </span>
          )}
          <div className="flex bg-surface-elevated rounded-lg p-1">
            {periods.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  'px-3 py-1 text-xs font-medium font-mono rounded-md transition-colors',
                  period === p.key ? 'bg-live-500 text-[#00141a]' : 'text-ink-3 hover:text-ink-0'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {base != null ? (
        <Tick past={past} base={base} drift={drift} volatility={1} height={168} onScrub={onScrub} />
      ) : (
        <div className="h-[168px] flex items-center justify-center text-ink-4 text-sm tk-num">
          {isLoading ? 'loading volume history…' : 'no volume data'}
        </div>
      )}

      {win && (
        <div className="grid grid-cols-3 gap-3 mt-3">
          {[
            { k: `${period} total`, v: usd(win.total) },
            { k: 'peak day', v: usd(win.peak) },
            { k: 'daily avg', v: usd(win.avg) },
          ].map((s) => (
            <div
              key={s.k}
              className="rounded-[10px] px-3 py-2"
              style={{ background: 'var(--tk-surface-2)', border: '1px solid var(--tk-line-1)' }}
            >
              <div className="tk-label">{s.k}</div>
              <div className="tk-num text-sm font-bold text-ink-0 mt-0.5">{s.v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-4 font-mono">
        <Chip tone="watch">cone</Chip>
        <span>drag or ← → to scrub · past is solid, forward fans to a confidence band</span>
      </div>
    </div>
  );
}

export default VolumeChart;
