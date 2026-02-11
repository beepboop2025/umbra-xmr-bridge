'use client';

import { useState } from 'react';
import { Search, Filter, RefreshCw } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { OrdersTable } from '@/components/dashboard/OrdersTable';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useOrderStore } from '@/stores/order-store';

const statusOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'awaiting_deposit', label: 'Awaiting Deposit' },
  { value: 'confirming', label: 'Confirming' },
  { value: 'exchanging', label: 'Exchanging' },
  { value: 'sending', label: 'Sending' },
  { value: 'completed', label: 'Completed' },
  { value: 'expired', label: 'Expired' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
];

const chainOptions = [
  { value: 'all', label: 'All Chains' },
  { value: 'BTC', label: 'Bitcoin' },
  { value: 'ETH', label: 'Ethereum' },
  { value: 'TON', label: 'TON' },
  { value: 'SOL', label: 'Solana' },
  { value: 'ARB', label: 'Arbitrum' },
  { value: 'BASE', label: 'Base' },
  { value: 'USDC', label: 'USDC' },
  { value: 'USDT', label: 'USDT' },
];

export default function OrdersPage() {
  const orderStore = useOrderStore();
  const [searchInput, setSearchInput] = useState('');

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-6 pb-24 md:pb-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Orders</h1>
          <p className="text-sm text-gray-400 mt-1">
            View and manage all your bridge orders ({orderStore.totalOrders} total)
          </p>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search by order ID or address..."
                icon={<Search size={16} />}
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  orderStore.setFilter({ search: e.target.value });
                }}
              />
            </div>
            <div className="flex gap-3">
              <div className="w-40">
                <Select
                  options={statusOptions}
                  value={orderStore.filter.status}
                  onChange={(e) =>
                    orderStore.setFilter({ status: e.target.value as any })
                  }
                  selectSize="md"
                />
              </div>
              <div className="w-36">
                <Select
                  options={chainOptions}
                  value={orderStore.filter.chain}
                  onChange={(e) =>
                    orderStore.setFilter({ chain: e.target.value })
                  }
                  selectSize="md"
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Orders Table */}
        <Card padding="none">
          <OrdersTable limit={20} showPagination />
        </Card>
      </div>
    </div>
  );
}
