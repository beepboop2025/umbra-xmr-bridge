'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TxDetail } from '@/components/explorer/TxDetail';
import { useOrder } from '@/hooks/useOrders';

export default function ExplorerDetailPage() {
  const params = useParams();
  const orderId = params.id as string;
  const { order, isLoading } = useOrder(orderId);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 pb-24 md:pb-8">
      <Link
        href="/explorer"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-3 transition-colors hover:text-ink-1"
      >
        <ArrowLeft size={14} /> Back to explorer
      </Link>

      {isLoading && !order ? (
        <div className="tk-card">
          <div className="shimmer mb-4 h-7 w-40 rounded-lg" />
          <div className="shimmer mb-3 h-14 w-56 rounded-lg" />
          <div className="shimmer h-24 w-full rounded-lg" />
        </div>
      ) : order ? (
        <TxDetail order={order} />
      ) : (
        <div className="tk-card py-14 text-center">
          <p className="text-lg font-semibold text-ink-1">Order not found</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
            No order matches <code className="font-mono text-live-500">{orderId}</code> in the public
            ledger. It may be mistyped, or not yet indexed.
          </p>
          <Link href="/explorer" className="tk-btn mt-5 inline-flex">
            Back to explorer
          </Link>
        </div>
      )}
    </div>
  );
}
