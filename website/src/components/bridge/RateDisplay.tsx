'use client';

import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { CHAINS } from '@/lib/chains';
import { SparklineChart } from '@/components/charts/SparklineChart';
import { useRate, useRateHistory } from '@/hooks/useRate';
import { cn } from '@/lib/utils';

interface RateDisplayProps {
  source: string;
  dest: string;
  className?: string;
}

export function RateDisplay({ source, dest, className }: RateDisplayProps) {
  const { rate, isLoading, refresh } = useRate(source, dest);
  const { history, change24h } = useRateHistory(source, dest, '24h');

  const srcChain = CHAINS[source];
  const dstChain = CHAINS[dest];
  const isPositive = change24h >= 0;

  const sparkData = history.slice(-20).map((p) => p.rate);

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-gray-400">
            1 {srcChain?.symbol} =
          </span>
          <span className="text-lg font-bold text-white font-mono">
            {isLoading ? '...' : (Number(rate) || 0).toFixed(8)}
          </span>
          <span className="text-sm text-gray-400">{dstChain?.symbol}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {isPositive ? (
            <TrendingUp size={12} className="text-green-400" />
          ) : (
            <TrendingDown size={12} className="text-red-400" />
          )}
          <span
            className={cn(
              'text-xs font-medium',
              isPositive ? 'text-green-400' : 'text-red-400'
            )}
          >
            {isPositive ? '+' : ''}
            {change24h.toFixed(2)}% (24h)
          </span>
        </div>
      </div>

      {sparkData.length > 2 && (
        <div className="w-24">
          <SparklineChart data={sparkData} positive={isPositive} height={28} />
        </div>
      )}

      <button
        onClick={refresh}
        disabled={isLoading}
        className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-surface-elevated transition-colors disabled:opacity-50"
        title="Refresh rate"
      >
        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

export default RateDisplay;
