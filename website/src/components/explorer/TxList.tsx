'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Activity } from 'lucide-react';
import { CHAINS } from '@/lib/chains';
import { ChainIcon } from '@/components/bridge/ChainSelector';
import { Chip, Panel } from '@/components/tikto/primitives';
import { formatTime } from '@/lib/utils';

/** Tiktó status tones — colour is never the only signal (paired with a label). */
export type StatusTone = 'ok' | 'watch' | 'warning' | 'critical' | 'stale';

const STATUS_META: Record<string, { tone: StatusTone; label: string }> = {
  pending: { tone: 'stale', label: 'Pending' },
  awaiting_deposit: { tone: 'warning', label: 'Awaiting deposit' },
  confirming: { tone: 'watch', label: 'Confirming' },
  exchanging: { tone: 'watch', label: 'Exchanging' },
  sending: { tone: 'watch', label: 'Sending' },
  completed: { tone: 'ok', label: 'Completed' },
  expired: { tone: 'stale', label: 'Expired' },
  failed: { tone: 'critical', label: 'Failed' },
  refunded: { tone: 'warning', label: 'Refunded' },
};

export function statusMeta(status: string): { tone: StatusTone; label: string } {
  return STATUS_META[status] ?? { tone: 'stale', label: status.replace(/_/g, ' ') || 'Unknown' };
}

const fmtAmt = (n: number, d = 4) =>
  (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: d });

interface Transaction {
  order_id: string;
  source_chain: string;
  dest_chain: string;
  amount: number;
  receive_amount: number;
  status: string;
  created_at: string;
}

interface TxListProps {
  transactions: Transaction[];
  isLoading?: boolean;
  title?: string;
  showAll?: boolean;
}

export function TxList({ transactions, isLoading, title = 'Recent Transactions', showAll = false }: TxListProps) {
  const router = useRouter();

  const right = showAll ? (
    <Chip tone="ok">
      <span className="tk-trust__dot" style={{ color: 'var(--tk-ok)' }} /> live
    </Chip>
  ) : transactions.length > 0 ? (
    <button
      onClick={() => router.push('/explorer')}
      className="font-mono text-[11px] uppercase tracking-wider text-live-500 transition-colors hover:text-live-300"
    >
      View all &rarr;
    </button>
  ) : undefined;

  return (
    <Panel title={title} right={right}>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-[11px] border border-surface-border/70 px-3 py-3"
            >
              <div className="shimmer h-6 w-12 rounded-full" />
              <div className="shimmer h-4 flex-1 rounded" />
              <div className="shimmer h-4 w-16 rounded" />
            </div>
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="py-12 text-center">
          <div
            className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: 'var(--tk-surface-2)', border: '1px solid var(--tk-line-2)' }}
          >
            <Activity size={16} className="text-ink-4" />
          </div>
          <p className="text-sm text-ink-2">No orders in the stream yet</p>
          <p className="mt-1 text-xs text-ink-4">New bridge orders appear here the moment they settle.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {transactions.map((tx) => {
            const src = CHAINS[tx.source_chain];
            const dst = CHAINS[tx.dest_chain];
            const meta = statusMeta(tx.status);
            return (
              <button
                key={tx.order_id}
                onClick={() => router.push(`/explorer/${tx.order_id}`)}
                className="tk-stream__item group flex w-full items-center gap-3 text-left transition-colors hover:bg-surface-elevated sm:gap-4"
                style={{ borderLeftColor: `var(--tk-${meta.tone})` }}
              >
                {/* source -> dest chain glyphs (chain colour lives only in the glyph) */}
                <div className="flex shrink-0 items-center gap-1.5">
                  {src && <ChainIcon chain={src} size={22} />}
                  <ArrowRight size={12} className="text-ink-4" />
                  {dst && <ChainIcon chain={dst} size={22} />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[13px] text-ink-1 transition-colors group-hover:text-live-500">
                    {tx.order_id}
                  </div>
                  <div className="tk-num mt-0.5 text-[11px] text-ink-3">{formatTime(tx.created_at)}</div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="tk-num text-[13px] text-ink-0">
                    {fmtAmt(tx.amount)} <span className="text-ink-3">{src?.symbol}</span>
                  </div>
                  <div className="tk-num mt-0.5 text-[11px] text-ink-3">
                    &rarr; {fmtAmt(tx.receive_amount)} {dst?.symbol}
                  </div>
                </div>

                <div className="shrink-0">
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export default TxList;
