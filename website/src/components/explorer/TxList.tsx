'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { CHAINS } from '@/lib/chains';
import { ChainIcon } from '@/components/bridge/ChainSelector';
import { StatusBadge } from '@/components/ui/Badge';
import { formatTime, truncateAddress } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

interface Transaction {
  order_id: string;
  source_chain: string;
  dest_chain: string;
  amount: number;
  receive_amount: number;
  status: string;
  created_at: string;
}

interface TxListProps {
  transactions: Transaction[];
  isLoading?: boolean;
  title?: string;
  showAll?: boolean;
}

export function TxList({ transactions, isLoading, title = 'Recent Transactions', showAll = false }: TxListProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <Card>
        <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-lg bg-surface-elevated">
              <Skeleton className="w-8 h-8" rounded="full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card padding="none">
      <div className="p-5 pb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {!showAll && transactions.length > 0 && (
          <button
            onClick={() => router.push('/explorer')}
            className="text-xs text-xmr-400 hover:text-xmr-300 transition-colors"
          >
            View All
          </button>
        )}
      </div>

      <div className="divide-y divide-surface-border/50">
        {transactions.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No transactions yet</p>
        ) : (
          transactions.map((tx) => {
            const srcChain = CHAINS[tx.source_chain];
            const dstChain = CHAINS[tx.dest_chain];

            return (
              <div
                key={tx.order_id}
                onClick={() => router.push(`/explorer/${tx.order_id}`)}
                className="flex items-center gap-4 px-5 py-3 hover:bg-surface-elevated cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  {srcChain && <ChainIcon chain={srcChain} size={20} />}
                  <ArrowRight size={12} className="text-gray-600" />
                  {dstChain && <ChainIcon chain={dstChain} size={20} />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-gray-300 truncate">
                      {tx.order_id}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{formatTime(tx.created_at)}</p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-mono text-white">
                    {(Number(tx.amount) || 0).toFixed(4)} {srcChain?.symbol}
                  </p>
                  <p className="text-xs font-mono text-gray-500">
                    &rarr; {(Number(tx.receive_amount) || 0).toFixed(4)} {dstChain?.symbol}
                  </p>
                </div>

                <StatusBadge status={tx.status as any} />
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

export default TxList;
