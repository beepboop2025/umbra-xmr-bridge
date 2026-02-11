'use client';

import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { Table, Pagination, type Column } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/Badge';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useOrders } from '@/hooks/useOrders';
import { useOrderStore } from '@/stores/order-store';
import { CHAINS } from '@/lib/chains';
import { formatTime, truncateHash } from '@/lib/utils';
import type { OrderSummary } from '@/lib/api-client';
import { ChainIcon } from '@/components/bridge/ChainSelector';

interface OrdersTableProps {
  limit?: number;
  showPagination?: boolean;
  showFilters?: boolean;
  compact?: boolean;
}

export function OrdersTable({
  limit = 20,
  showPagination = true,
  showFilters = false,
  compact = false,
}: OrdersTableProps) {
  const router = useRouter();
  const orderStore = useOrderStore();
  const { orders, total, page, pages, isLoading } = useOrders(
    orderStore.currentPage,
    limit
  );

  const columns: Column<OrderSummary>[] = [
    {
      key: 'order_id',
      header: 'Order',
      sortable: true,
      render: (row) => (
        <span className="text-sm font-mono text-xmr-400">{row.order_id}</span>
      ),
    },
    {
      key: 'pair',
      header: 'Pair',
      render: (row) => {
        const srcChain = CHAINS[row.source_chain];
        const dstChain = CHAINS[row.dest_chain];
        return (
          <div className="flex items-center gap-2">
            {srcChain && <ChainIcon chain={srcChain} size={18} />}
            <span className="text-xs text-gray-400">{row.source_chain}</span>
            <span className="text-gray-600">&rarr;</span>
            {dstChain && <ChainIcon chain={dstChain} size={18} />}
            <span className="text-xs text-gray-400">{row.dest_chain}</span>
          </div>
        );
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      align: 'right',
      render: (row) => (
        <div className="text-right">
          <p className="text-sm text-white font-mono">
            {(Number(row.amount) || 0).toFixed(4)} {CHAINS[row.source_chain]?.symbol}
          </p>
          <p className="text-xs text-gray-500 font-mono">
            &rarr; {(Number(row.receive_amount) || 0).toFixed(4)} {CHAINS[row.dest_chain]?.symbol}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'created_at',
      header: 'Time',
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className="text-sm text-gray-400">{formatTime(row.created_at)}</span>
      ),
    },
  ];

  if (isLoading && orders.length === 0) {
    return <SkeletonTable rows={limit > 10 ? 10 : limit} cols={5} />;
  }

  return (
    <div>
      <Table
        data={orders}
        columns={columns}
        compact={compact}
        onRowClick={(row) => router.push(`/dashboard/orders/${row.order_id}`)}
        emptyMessage="No orders found"
      />
      {showPagination && (
        <Pagination
          currentPage={page}
          totalPages={pages}
          onPageChange={orderStore.setPage}
        />
      )}
    </div>
  );
}

export default OrdersTable;
