'use client';

import { useState } from 'react';
import { Search, Filter, MoreVertical, Eye, RefreshCw, Ban, CheckCircle } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardHeader } from '@/components/ui/Card';
import { Table, Pagination, type Column } from '@/components/ui/Table';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CHAINS } from '@/lib/chains';
import { ChainIcon } from '@/components/bridge/ChainSelector';
import { formatTime, formatCurrency, truncateAddress } from '@/lib/utils';
import { useOrders } from '@/hooks/useOrders';
import type { OrderSummary } from '@/lib/api-client';

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'awaiting_deposit', label: 'Awaiting' },
  { value: 'confirming', label: 'Confirming' },
  { value: 'exchanging', label: 'Exchanging' },
  { value: 'sending', label: 'Sending' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

export default function AdminOrdersPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const { orders, total, pages, isLoading, refresh } = useOrders(currentPage, 25);

  const columns: Column<OrderSummary>[] = [
    {
      key: 'order_id',
      header: 'Order ID',
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
          <div className="flex items-center gap-1.5">
            {srcChain && <ChainIcon chain={srcChain} size={16} />}
            <span className="text-xs text-gray-500">&rarr;</span>
            {dstChain && <ChainIcon chain={dstChain} size={16} />}
            <span className="text-xs text-gray-400 ml-1">
              {row.source_chain}/{row.dest_chain}
            </span>
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
        <span className="text-sm font-mono text-white">
          {(Number(row.amount) || 0).toFixed(4)} {CHAINS[row.source_chain]?.symbol}
        </span>
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
      header: 'Created',
      sortable: true,
      render: (row) => (
        <span className="text-xs text-gray-400">{formatTime(row.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '80px',
      align: 'right',
      render: (row) => (
        <div className="flex items-center gap-1 justify-end">
          <button className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-surface-elevated transition-colors">
            <Eye size={14} />
          </button>
          <button className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-surface-elevated transition-colors">
            <MoreVertical size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-6 pb-24 md:pb-6 max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Order Management</h1>
            <p className="text-sm text-gray-400 mt-1">
              {total} total orders
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={refresh}
            loading={isLoading}
          >
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search orders..."
                icon={<Search size={16} />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-40">
              <Select
                options={statusOptions}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Pending', count: orders.filter((o) => o.status === 'pending').length, color: 'text-gray-400' },
            { label: 'In Progress', count: orders.filter((o) => ['confirming', 'exchanging', 'sending'].includes(o.status)).length, color: 'text-blue-400' },
            { label: 'Completed', count: orders.filter((o) => o.status === 'completed').length, color: 'text-green-400' },
            { label: 'Failed', count: orders.filter((o) => ['failed', 'expired'].includes(o.status)).length, color: 'text-red-400' },
          ].map((stat) => (
            <div key={stat.label} className="p-3 rounded-lg bg-surface-card border border-surface-border">
              <p className="text-xs text-gray-500">{stat.label}</p>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Orders Table */}
        <Card padding="none">
          <Table
            data={orders}
            columns={columns}
            emptyMessage="No orders match your criteria"
          />
          <div className="p-4 border-t border-surface-border">
            <Pagination
              currentPage={currentPage}
              totalPages={pages}
              onPageChange={setCurrentPage}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
