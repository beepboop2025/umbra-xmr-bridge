'use client';

import { useMemo, useState, useCallback } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { LivingMap, type MapNode, type MapEdge } from '@/components/tikto/LivingMap';
import { Tick } from '@/components/tikto/Tick';
import { Reveal } from '@/components/tikto/motion';
import { Chip, TrustStrip } from '@/components/tikto/primitives';
import { useVolumeHistory, useStats } from '@/hooks/useApi';
import { useRateHistory } from '@/hooks/useRate';
import { COUNTERPARTY_CHAINS } from '@/lib/chains';
import { cn } from '@/lib/utils';

const usd = (v: number) =>
  `$${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(v)}`;

const periods = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '90d', label: '90 Days' },
];

// Network topology: XMR hub + every live counterparty on the ring.
const RING = COUNTERPARTY_CHAINS.map((c) => c.id);
const MAP_NODES: MapNode[] = [
  { x: 0.5, y: 0.5, r: 9, label: 'XMR' },
  ...RING.map((s, i) => {
    const a = (i / RING.length) * Math.PI * 2 - Math.PI / 2;
    return { x: 0.5 + Math.cos(a) * 0.4, y: 0.5 + Math.sin(a) * 0.42, r: 5, label: s } as MapNode;
  }),
];
const MAP_EDGES: MapEdge[] = RING.map((_, i) => [0, i + 1, 0.4 + (i % 3) * 0.2] as MapEdge);

function DailyBars({ points }: { points: Array<{ date: string; volume: number; count: number }> }) {
  if (!points.length) return <div className="text-ink-4 text-sm py-8 text-center tk-num">no data</div>;
  const peak = Math.max(...points.map((p) => p.volume)) || 1;
  const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <div>
      <div className="flex items-end gap-[3px] h-40">
        {points.map((p, i) => {
          const h = Math.max(3, Math.round((p.volume / peak) * 100));
          return (
            <div
              key={i}
              className="flex-1 min-w-0 flex items-end"
              title={`${fmtDay(p.date)} · ${usd(p.volume)} · ${p.count} orders`}
            >
              <div
                className="w-full rounded-t-[3px] transition-[height] duration-500 hover:opacity-100"
                style={{
                  height: `${h}%`,
                  background: 'linear-gradient(180deg, var(--tk-live), var(--tk-live-dim))',
                  opacity: 0.82,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 tk-label">
        <span>{fmtDay(points[0].date)}</span>
        <span>{fmtDay(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('7d');
  const { data: volumeData, isLoading } = useVolumeHistory(period);
  const { data: stats } = useStats();
  const { history, change24h } = useRateHistory('XMR', 'BTC', '7d');

  // Volume spine for the Tick (memoised → scrub re-renders don't rebuild canvas).
  const vol = useMemo(() => (volumeData?.points || []).map((p) => Math.round(p.volume)), [volumeData]);
  const volBase = vol.length ? vol[vol.length - 1] : undefined;
  const volDrift = useMemo(() => {
    if (vol.length < 2 || !vol[0]) return 0.05;
    const t = (vol[vol.length - 1] - vol[0]) / vol[0];
    return Math.max(-0.35, Math.min(0.35, t * 0.5));
  }, [vol]);

  const rate = useMemo(() => history.slice(-60).map((p) => p.rate), [history]);
  const rateBase = rate.length ? rate[rate.length - 1] : undefined;

  const [scrub, setScrub] = useState<{ v: number; future: boolean } | null>(null);
  const onScrub = useCallback(
    (v: number, future: boolean) =>
      setScrub((prev) => (prev && prev.v === v && prev.future === future ? prev : { v, future })),
    []
  );

  const win = useMemo(() => {
    if (!vol.length) return null;
    const total = vol.reduce((a, b) => a + b, 0);
    return { total, peak: Math.max(...vol), avg: total / vol.length, days: vol.length };
  }, [vol]);

  const up = (change24h ?? 0) >= 0;
  const chains = stats?.supported_chains ?? RING.length;

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-4 sm:p-6 pb-24 md:pb-6 max-w-6xl">
        <Reveal>
          <div className="mb-4">
            <h1 className="text-2xl font-bold text-ink-0 tracking-tight">Analytics</h1>
            <p className="text-sm text-ink-3 mt-1">Bridge performance across time and space.</p>
          </div>
          <TrustStrip
            items={[
              { label: 'live', value: `${chains} chains`, dot: stats ? 'var(--tk-ok)' : 'var(--tk-stale)' },
              { label: 'window', value: period },
              { label: 'as of', value: 'now' },
              { label: 'source', value: 'CoinGecko + Kraken' },
            ]}
          />
        </Reveal>

        <div className="mt-5">
          <StatsCards />
        </div>

        {/* window selector */}
        <Reveal>
          <div className="mt-5 flex items-center gap-2 flex-wrap">
            <span className="tk-label mr-1">window</span>
            {periods.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  'px-3.5 py-1.5 text-xs font-mono font-medium rounded-lg transition-colors',
                  period === p.key ? 'bg-live-500 text-[#00141a]' : 'bg-surface-elevated text-ink-3 hover:text-ink-0'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Reveal>

        {/* Volume — temporal cone */}
        <Reveal>
          <div className="tk-panel mt-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="tk-panel__title" style={{ margin: 0 }}>Volume · temporal cone</span>
                <span className="tk-label">navigable time</span>
              </div>
              {scrub && (
                <span className="tk-tick__readout">
                  {scrub.future ? 'projection' : 'actual'} <b>{usd(scrub.v)}</b>
                </span>
              )}
            </div>
            {volBase != null ? (
              <Tick past={vol} base={volBase} drift={volDrift} volatility={1} height={190} onScrub={onScrub} />
            ) : (
              <div className="h-[190px] flex items-center justify-center text-ink-4 text-sm tk-num">
                {isLoading ? 'loading…' : 'no data'}
              </div>
            )}
            {win && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                {[
                  { k: `${period} total`, v: usd(win.total) },
                  { k: 'peak day', v: usd(win.peak) },
                  { k: 'daily avg', v: usd(win.avg) },
                  { k: 'data points', v: String(win.days) },
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
          </div>
        </Reveal>

        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          {/* Rate cone */}
          <Reveal>
            <div className="tk-panel h-full">
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-3">
                  <span className="tk-panel__title" style={{ margin: 0 }}>XMR / BTC · rate</span>
                  <span className="tk-label">navigable time</span>
                </div>
                <Chip tone={up ? 'ok' : 'critical'}>
                  {up ? '▲' : '▼'} {Math.abs(change24h ?? 0).toFixed(2)}% 24h
                </Chip>
              </div>
              {rateBase != null ? (
                <Tick past={rate} base={rateBase} drift={(change24h ?? 0) / 100} volatility={0.8} height={190} />
              ) : (
                <div className="h-[190px] flex items-center justify-center text-ink-4 text-sm tk-num">
                  loading rate history…
                </div>
              )}
            </div>
          </Reveal>

          {/* Network */}
          <Reveal delay={0.05}>
            <div className="tk-panel h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="tk-panel__title" style={{ margin: 0 }}>Liquidity network</span>
                <span className="tk-label">navigable space</span>
              </div>
              <LivingMap nodes={MAP_NODES} edges={MAP_EDGES} height={300} />
            </div>
          </Reveal>
        </div>

        {/* Daily flow — real per-day volume */}
        <Reveal>
          <div className="tk-panel mt-4">
            <div className="flex items-center justify-between mb-4">
              <span className="tk-panel__title" style={{ margin: 0 }}>Daily flow</span>
              <span className="tk-label">{period} · {win?.days ?? 0} points</span>
            </div>
            <DailyBars points={volumeData?.points || []} />
          </div>
        </Reveal>
      </div>
    </div>
  );
}
