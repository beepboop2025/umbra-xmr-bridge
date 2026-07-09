'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useOrders } from '@/hooks/useOrders';
import { useOrderStore } from '@/stores/order-store';
import { CHAINS } from '@/lib/chains';
import { formatTime } from '@/lib/utils';
import type { OrderStatus, OrderSummary } from '@/lib/api-client';
import { ChainIcon } from '@/components/bridge/ChainSelector';
import { Chip } from '@/components/tikto/primitives';

type Tone = 'ok' | 'watch' | 'warning' | 'critical' | 'stale';

// Status → Tiktó tone. Colour never rides alone: every chip carries its label too.
const STATUS: Record<OrderStatus, { tone: Tone; label: string; active?: boolean }> = {
  pending: { tone: 'stale', label: 'pending' },
  awaiting_deposit: { tone: 'warning', label: 'awaiting deposit', active: true },
  confirming: { tone: 'watch', label: 'confirming', active: true },
  exchanging: { tone: 'watch', label: 'exchanging', active: true },
  sending: { tone: 'watch', label: 'sending', active: true },
  completed: { tone: 'ok', label: 'completed' },
  expired: { tone: 'critical', label: 'expired' },
  failed: { tone: 'critical', label: 'failed' },
  refunded: { tone: 'warning', label: 'refunded' },
};

const TONE_VAR: Record<Tone, string> = {
  ok: 'var(--tk-ok)',
  watch: 'var(--tk-watch)',
  warning: 'var(--tk-warning)',
  critical: 'var(--tk-critical)',
  stale: 'var(--tk-line-3)',
};

interface OrdersTableProps {
  limit?: number;
  showPagination?: boolean;
  showFilters?: boolean;
  compact?: boolean;
}

export function OrdersTable({ limit = 20, showPagination = true, compact = false }: OrdersTableProps) {
  const router = useRouter();
  const orderStore = useOrderStore();
  const { orders, page, pages, isLoading } = useOrders(orderStore.currentPage, limit);

  if (isLoading && orders.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: Math.min(limit, 6) }).map((_, i) => (
          <div key={i} className="shimmer rounded-[11px]" style={{ height: 52, opacity: 0.55 }} />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return <div className="text-center text-ink-3 text-sm py-10 tk-num">No orders found</div>;
  }

  return (
    <div>
      {/* column header */}
      <div className="hidden sm:flex items-center gap-3 px-4 pb-2 tk-label">
        <span className="w-[92px] shrink-0">Order</span>
        <span className="flex-1 min-w-0">Route</span>
        <span className="w-[150px] shrink-0 text-right">Amount</span>
        <span className="w-[132px] shrink-0">Status</span>
        {!compact && <span className="w-[64px] shrink-0 text-right">Time</span>}
      </div>

      <div className="flex flex-col gap-1.5">
        {orders.map((o: OrderSummary) => {
          const s = STATUS[o.status] ?? STATUS.pending;
          const src = CHAINS[o.source_chain];
          const dst = CHAINS[o.dest_chain];
          return (
            <button
              key={o.order_id}
              onClick={() => router.push(`/dashboard/orders/${o.order_id}`)}
              className="group relative flex items-center gap-3 w-full text-left rounded-[11px] pl-4 pr-3 py-2.5 bg-surface-card [border:1px_solid_var(--tk-line-2)] hover:[border-color:var(--tk-line-3)] transition-colors"
            >
              <span
                className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                style={{ background: TONE_VAR[s.tone] }}
              />

              {/* Order id */}
              <span className="w-[92px] shrink-0 font-mono text-xs text-live-500 truncate">
                {o.order_id.length > 13 ? `${o.order_id.slice(0, 11)}…` : o.order_id}
              </span>

              {/* Route */}
              <span className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                {src && <ChainIcon chain={src} size={16} />}
                <span className="text-[11px] text-ink-2 font-mono">{o.source_chain}</span>
                <ArrowRight size={11} className="text-ink-4 shrink-0" />
                {dst && <ChainIcon chain={dst} size={16} />}
                <span className="text-[11px] text-ink-2 font-mono">{o.dest_chain}</span>
              </span>

              {/* Amount */}
              <span className="hidden sm:block w-[150px] shrink-0 text-right tk-num text-xs leading-tight">
                <span className="text-ink-0">
                  {(Number(o.amount) || 0).toFixed(4)} {src?.symbol ?? ''}
                </span>
                <span className="block text-ink-4">
                  → {(Number(o.receive_amount) || 0).toFixed(4)} {dst?.symbol ?? ''}
                </span>
              </span>

              {/* Status */}
              <span className="w-[132px] shrink-0 flex justify-end sm:justify-start">
                <Chip tone={s.tone}>
                  {s.active && <span aria-hidden>●</span>} {s.label}
                </Chip>
              </span>

              {/* Time */}
              {!compact && (
                <span className="hidden md:block w-[64px] shrink-0 text-right text-[11px] text-ink-3 font-mono">
                  {formatTime(o.created_at)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {showPagination && pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-xs font-mono text-ink-3">
          <span>
            page <b className="text-ink-1">{page}</b> / {pages}
          </span>
          <div className="flex gap-2">
            <button
              className="tk-btn"
              disabled={page <= 1}
              onClick={() => orderStore.setPage(Math.max(1, page - 1))}
              style={page <= 1 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              Prev
            </button>
            <button
              className="tk-btn"
              disabled={page >= pages}
              onClick={() => orderStore.setPage(Math.min(pages, page + 1))}
              style={page >= pages ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrdersTable;
