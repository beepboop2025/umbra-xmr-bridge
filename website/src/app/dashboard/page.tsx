'use client';

import Link from 'next/link';
import { ArrowRight, Activity } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { VolumeChart } from '@/components/dashboard/VolumeChart';
import { OrdersTable } from '@/components/dashboard/OrdersTable';
import { LivingMap, type MapNode, type MapEdge } from '@/components/tikto/LivingMap';
import { Reveal } from '@/components/tikto/motion';
import { TrustStrip } from '@/components/tikto/primitives';
import { useStats } from '@/hooks/useApi';

// XMR hub + counterparty ring — the bridge as a navigable topology.
const RING = ['BTC', 'ETH', 'TON', 'SOL', 'ARB', 'BASE', 'USDC', 'USDT'];
const MAP_NODES: MapNode[] = [
  { x: 0.5, y: 0.5, r: 9, label: 'XMR' },
  ...RING.map((s, i) => {
    const a = (i / RING.length) * Math.PI * 2 - Math.PI / 2;
    return { x: 0.5 + Math.cos(a) * 0.4, y: 0.5 + Math.sin(a) * 0.42, r: 5, label: s } as MapNode;
  }),
];
const MAP_EDGES: MapEdge[] = RING.map((_, i) => [0, i + 1, 0.4 + (i % 3) * 0.2] as MapEdge);

export default function DashboardPage() {
  const { data: stats } = useStats();
  const chains = stats?.supported_chains ?? RING.length;
  const avg = stats?.avg_completion_time;

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-4 sm:p-6 pb-24 md:pb-6 max-w-6xl">
        <Reveal>
          <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-ink-0 tracking-tight">Operator cockpit</h1>
              <p className="text-sm text-ink-3 mt-1">Live bridge activity — one glance, one decision.</p>
            </div>
            <Link href="/bridge" className="tk-btn tk-btn--live">
              New swap <ArrowRight size={15} />
            </Link>
          </div>

          <TrustStrip
            items={[
              { label: 'live', value: `${chains} chains`, dot: stats ? 'var(--tk-ok)' : 'var(--tk-stale)' },
              { label: 'as of', value: 'now' },
              { label: 'custody', value: 'MPC 2-of-3' },
              { label: 'avg settle', value: avg != null ? `~${Math.round(avg)}m` : '——' },
              { label: 'receipts', value: 'ed25519 + ml-dsa' },
            ]}
          />
        </Reveal>

        <div className="mt-5">
          <StatsCards />
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mt-4">
          <Reveal>
            <VolumeChart />
          </Reveal>
          <Reveal delay={0.05}>
            <div className="tk-panel h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="tk-panel__title" style={{ margin: 0 }}>Liquidity network</span>
                <span className="tk-label">navigable space</span>
              </div>
              <LivingMap nodes={MAP_NODES} edges={MAP_EDGES} height={320} />
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.05}>
          <div className="tk-panel mt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity size={15} className="text-live-500" />
                <span className="tk-panel__title" style={{ margin: 0 }}>Recent orders</span>
              </div>
              <Link
                href="/dashboard/orders"
                className="text-xs font-mono text-live-500 inline-flex items-center gap-1 hover:gap-1.5 transition-all"
              >
                view all <ArrowRight size={13} />
              </Link>
            </div>
            <OrdersTable limit={6} showPagination={false} compact />
          </div>
        </Reveal>
      </div>
    </div>
  );
}
