'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TxDetail } from '@/components/explorer/TxDetail';
import { useOrder } from '@/hooks/useOrders';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';

export default function ExplorerDetailPage() {
  const params = useParams();
  const orderId = params.id as string;
  const { order, isLoading } = useOrder(orderId);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-8">
      <div className="mb-6">
        <Link href="/explorer">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
            Back to Explorer
          </Button>
        </Link>
      </div>

      {isLoading && !order ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : order ? (
        <TxDetail order={order} />
      ) : (
        <div className="text-center py-16">
          <p className="text-lg text-gray-400">Transaction not found</p>
          <p className="text-sm text-gray-600 mt-2">
            The transaction <code className="text-xmr-400">{orderId}</code> could not be found.
          </p>
          <Link href="/explorer" className="mt-4 inline-block">
            <Button variant="secondary">Back to Explorer</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
