'use client';

import { useStats } from '@/hooks/useApi';
import { NumberRoll, Stagger, StaggerItem } from '@/components/tikto/motion';
import { Chip } from '@/components/tikto/primitives';

/** Compact USD ("$12.4M") and compact counts ("15.5K") — tabular everywhere. */
const usd = (v: number) =>
  `$${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(v)}`;
const compact = (v: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const int = (v: number) => new Intl.NumberFormat('en').format(Math.round(v));

type StatKey =
  | 'total_volume_usd'
  | 'volume_24h_usd'
  | 'total_orders'
  | 'completed_orders'
  | 'active_orders'
  | 'supported_chains';

interface Metric {
  key: StatKey;
  label: string;
  fmt: (v: number) => string;
  hint: string;
  accent?: boolean;
  live?: boolean;
}

// The instrument cluster — real /api/stats fields, no placeholders.
const METRICS: Metric[] = [
  { key: 'total_volume_usd', label: 'Total volume', fmt: usd, hint: 'settled, all-time', accent: true },
  { key: 'volume_24h_usd', label: '24h volume', fmt: usd, hint: 'trailing 24 hours' },
  { key: 'total_orders', label: 'Total orders', fmt: compact, hint: 'lifetime swaps' },
  { key: 'completed_orders', label: 'Completed', fmt: compact, hint: 'settled native' },
  { key: 'active_orders', label: 'Active now', fmt: int, hint: 'in flight', live: true },
  { key: 'supported_chains', label: 'Chains', fmt: int, hint: 'destinations live' },
];

export function StatsCards() {
  const { data } = useStats();

  return (
    <Stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {METRICS.map((m) => {
        const v = data?.[m.key];
        return (
          <StaggerItem key={m.key} className="h-full">
            <div
              className="tk-panel h-full flex flex-col"
              style={m.accent ? { borderLeft: '2px solid var(--tk-live)' } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="tk-label">{m.label}</span>
                {m.live && v != null && v > 0 && <Chip tone="ok">live</Chip>}
              </div>
              <div className="mt-2 leading-none">
                {v != null ? (
                  <NumberRoll
                    value={v}
                    format={m.fmt}
                    className={`tk-num font-bold text-ink-0 leading-none ${m.accent ? 'text-[27px]' : 'text-2xl'}`}
                  />
                ) : (
                  <span
                    className={`tk-num font-bold text-ink-4 leading-none ${m.accent ? 'text-[27px]' : 'text-2xl'}`}
                    aria-label="loading"
                  >
                    ——
                  </span>
                )}
              </div>
              <div className="mt-auto pt-2 text-[11px] text-ink-3">{m.hint}</div>
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

export default StatsCards;
