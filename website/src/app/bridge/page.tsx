'use client';

import { BridgeForm } from '@/components/bridge/BridgeForm';
import { PriceChart } from '@/components/charts/PriceChart';
import { TxList } from '@/components/explorer/TxList';
import { useRecentTransactions } from '@/hooks/useApi';
import { useBridgeStore } from '@/stores/bridge-store';

export default function BridgePage() {
  const { sourceChain, destChain } = useBridgeStore();
  const { data: recentTxs, isLoading: txsLoading } = useRecentTransactions(8);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Bridge Form */}
        <div className="lg:col-span-5 flex justify-center lg:justify-start">
          <BridgeForm />
        </div>

        {/* Right: Chart & Recent */}
        <div className="lg:col-span-7 space-y-6">
          <PriceChart source={sourceChain} dest={destChain} />

          <TxList
            transactions={recentTxs?.transactions || []}
            isLoading={txsLoading}
            title="Recent Bridge Transactions"
          />
        </div>
      </div>
    </div>
  );
}
