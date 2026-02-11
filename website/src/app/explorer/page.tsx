'use client';

import { useState, useCallback } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { TxList } from '@/components/explorer/TxList';
import { StatsCards } from '@/components/dashboard/StatsCards';
import { useRecentTransactions } from '@/hooks/useApi';

export default function ExplorerPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const { data, isLoading, mutate } = useRecentTransactions(30);

  const filteredTxs = (data?.transactions || []).filter((tx) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      tx.order_id.toLowerCase().includes(q) ||
      tx.source_chain.toLowerCase().includes(q) ||
      tx.dest_chain.toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Bridge Explorer</h1>
        <p className="text-gray-400 mt-2">
          Browse all bridge transactions in real-time. Full transparency, full privacy.
        </p>
      </div>

      {/* Stats */}
      <StatsCards />

      {/* Search */}
      <Card className="mt-6">
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search by order ID, chain, or transaction hash..."
              icon={<Search size={16} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            icon={<RefreshCw size={14} />}
            onClick={() => mutate()}
            loading={isLoading}
          >
            Refresh
          </Button>
        </div>
      </Card>

      {/* Transaction List */}
      <div className="mt-6">
        <TxList
          transactions={filteredTxs}
          isLoading={isLoading && !data}
          title={searchQuery ? `Results for "${searchQuery}"` : 'Recent Transactions'}
          showAll
        />
      </div>

      {/* Info */}
      <div className="mt-8 text-center text-sm text-gray-600">
        <p>
          All transactions are processed non-custodially. Monero transactions are private by default.
        </p>
        <p className="mt-1">
          Source chain deposits and destination chain payouts are verifiable on their respective explorers.
        </p>
      </div>
    </div>
  );
}
