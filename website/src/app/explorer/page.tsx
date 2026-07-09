'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, RefreshCw } from 'lucide-react';
import { TxList } from '@/components/explorer/TxList';
import { useRecentTransactions, useStats } from '@/hooks/useApi';
import { apiClient, type OrderSummary } from '@/lib/api-client';
import { TrustStrip } from '@/components/tikto/primitives';
import { Reveal } from '@/components/tikto/motion';

const compact = (n: number) =>
  `$${Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0)}`;
const count = (n: number) => Intl.NumberFormat('en').format(n || 0);

export default function ExplorerPage() {
  const [query, setQuery] = useState('');
  const { data, isLoading, mutate } = useRecentTransactions(30);
  const { data: stats } = useStats();
  const [serverResults, setServerResults] = useState<OrderSummary[]>([]);

  // Instant local filter over the live stream (order id / chain) — the original
  // explorer behaviour, preserved.
  const recent = data?.transactions ?? [];
  const q = query.trim().toLowerCase();
  const localFiltered = q
    ? recent.filter(
        (tx) =>
          tx.order_id.toLowerCase().includes(q) ||
          tx.source_chain.toLowerCase().includes(q) ||
          tx.dest_chain.toLowerCase().includes(q)
      )
    : recent;

  // Debounced server search also resolves order id / tx hash outside the recent
  // window. Fails quietly — the local stream still stands.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setServerResults([]);
      return;
    }
    let ignore = false;
    const t = setTimeout(() => {
      apiClient
        .searchTransaction(term)
        .then((r) => {
          if (!ignore) setServerResults(r.results ?? []);
        })
        .catch(() => {
          if (!ignore) setServerResults([]);
        });
    }, 350);
    return () => {
      ignore = true;
      clearTimeout(t);
    };
  }, [query]);

  const seen = new Set(localFiltered.map((t) => t.order_id));
  const serverOnly = q ? serverResults.filter((r) => !seen.has(r.order_id)) : [];
  const transactions = [...localFiltered, ...serverOnly];

  const metrics = [
    { label: 'Total volume', value: stats ? compact(stats.total_volume_usd) : '——' },
    { label: '24h volume', value: stats ? compact(stats.volume_24h_usd) : '——' },
    { label: 'Active orders', value: stats ? count(stats.active_orders) : '——' },
    { label: 'Completed', value: stats ? count(stats.completed_orders) : '——' },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 pb-24 md:pb-8">
      {/* Trust strip — auditability always visible */}
      <TrustStrip
        items={[
          { label: 'live', value: `${stats?.supported_chains ?? 8} chains`, dot: 'var(--tk-ok)' },
          { label: 'as of now' },
          { label: 'custody', value: 'non-custodial' },
          { label: 'receipts', value: 'ed25519 + ml-dsa' },
          {
            label: (
              <Link href="/verify" style={{ color: 'var(--tk-live)' }}>
                verify a receipt &rarr;
              </Link>
            ),
          },
        ]}
      />

      {/* Header */}
      <Reveal>
        <div className="mt-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-ink-0">Bridge Explorer</h1>
          <p className="mt-2 max-w-2xl text-ink-2">
            A live stream of every bridge order. Full transparency, zero deanonymisation — amounts and
            routes are public, addresses never are.
          </p>
        </div>
      </Reveal>

      {/* Metrics — tabular, calm */}
      <Reveal delay={0.05}>
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-surface-border bg-surface-border md:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="bg-surface-base px-5 py-6">
              <div className="tk-label">{m.label}</div>
              <div className="tk-num mt-1.5 text-2xl font-bold text-ink-0">{m.value}</div>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Search — command-line style */}
      <Reveal delay={0.08}>
        <div className="tk-terminal mt-6">
          <Search size={15} className="shrink-0 text-ink-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by order ID or transaction hash…"
            spellCheck={false}
            autoComplete="off"
            className="placeholder:text-ink-4"
          />
          <button
            onClick={() => mutate()}
            className="tk-btn shrink-0"
            style={{ padding: '6px 12px' }}
            aria-label="Refresh stream"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </Reveal>

      {/* Stream */}
      <Reveal delay={0.1}>
        <div className="mt-4">
          <TxList
            transactions={transactions}
            isLoading={isLoading && !data}
            title={query ? `Results for "${query}"` : 'Transaction stream'}
            showAll
          />
        </div>
      </Reveal>

      {/* Footer note */}
      <Reveal delay={0.12}>
        <div className="mt-8 text-center text-xs leading-relaxed text-ink-4">
          <p>All orders are processed non-custodially; Monero transactions are private by default.</p>
          <p className="mt-1">
            Source deposits and destination payouts are verifiable on their respective chain explorers.
          </p>
        </div>
      </Reveal>
    </div>
  );
}
