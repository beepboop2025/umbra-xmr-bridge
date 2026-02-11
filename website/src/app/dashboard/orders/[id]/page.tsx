'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { OrderStatusComponent } from '@/components/bridge/OrderStatus';
import { useOrder } from '@/hooks/useOrders';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;
  const { order, isLoading } = useOrder(orderId);

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-6 pb-24 md:pb-6 max-w-3xl">
        <div className="mb-6">
          <Link href="/dashboard/orders">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
              Back to Orders
            </Button>
          </Link>
        </div>

        {isLoading && !order ? (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : order ? (
          <OrderStatusComponent order={order} />
        ) : (
          <div className="text-center py-16">
            <p className="text-lg text-gray-400">Order not found</p>
            <p className="text-sm text-gray-600 mt-2">
              The order <code className="text-xmr-400">{orderId}</code> does not exist.
            </p>
            <Link href="/dashboard/orders" className="mt-4 inline-block">
              <Button variant="secondary">Back to Orders</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
