'use client';

import Link from 'next/link';
import { BridgeForm } from '@/components/bridge/BridgeForm';
import { PriceChart } from '@/components/charts/PriceChart';
import { TxList } from '@/components/explorer/TxList';
import { useRecentTransactions } from '@/hooks/useApi';
import { useBridgeStore } from '@/stores/bridge-store';
import { TrustStrip } from '@/components/tikto/primitives';
import { Reveal } from '@/components/tikto/motion';
import { SUPPORTED_PAIRS } from '@/lib/chains';

export default function BridgePage() {
  const { sourceChain, destChain } = useBridgeStore();
  const { data: recentTxs, isLoading: txsLoading } = useRecentTransactions(8);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 pb-24 md:pb-8">
      {/* Trust strip — auditability always visible */}
      <Reveal>
        <TrustStrip
          items={[
            { label: 'live', value: `${SUPPORTED_PAIRS.length} pairs`, dot: 'var(--tk-ok)' },
            { label: 'as of', value: 'now' },
            { label: 'custody', value: 'MPC 2-of-3' },
            { label: 'receipts', value: 'ed25519 + ml-dsa' },
            { label: 'quote lock', value: '30 min' },
            { label: <Link href="/verify" style={{ color: 'var(--tk-live)' }}>verify a receipt →</Link> },
          ]}
        />
      </Reveal>

      {/* Page title */}
      <Reveal delay={0.05} className="mt-7">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-0">Bridge</h1>
        <p className="text-ink-2 mt-1.5 text-sm sm:text-[15px] max-w-2xl">
          Configure a Monero swap route, review the quoted amount, and retain the signed receipt produced for recorded order events.
        </p>
      </Reveal>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-7">
        {/* Left: the swap decision card */}
        <Reveal delay={0.1} className="lg:col-span-5 flex justify-center lg:justify-start">
          <BridgeForm />
        </Reveal>

        {/* Right: rate history + recent flow */}
        <div className="lg:col-span-7 space-y-6">
          <Reveal delay={0.15}>
            <PriceChart source={sourceChain} dest={destChain} />
          </Reveal>
          <Reveal delay={0.2}>
            <TxList
              transactions={recentTxs?.transactions || []}
              isLoading={txsLoading}
              title="Recent bridge transactions"
            />
          </Reveal>
        </div>
      </div>
    </div>
  );
}
