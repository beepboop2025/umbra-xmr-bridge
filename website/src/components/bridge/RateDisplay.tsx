'use client';

import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { CHAINS } from '@/lib/chains';
import { SparklineChart } from '@/components/charts/SparklineChart';
import { useRate, useRateHistory } from '@/hooks/useRate';
import { Chip } from '@/components/tikto/primitives';
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
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Chip tone="ok">● streaming</Chip>
          <span className="tk-label" style={{ color: 'var(--tk-text-4)' }}>rate · CoinGecko + Kraken</span>
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[13px] text-ink-3">1 {srcChain?.symbol} =</span>
          <span className="tk-num text-lg font-bold text-ink-0">
            {isLoading ? '——' : (Number(rate) || 0).toFixed(8)}
          </span>
          <span className="text-[13px] text-ink-3">{dstChain?.symbol}</span>
          <span
            className="inline-flex items-center gap-1 text-[11px] font-mono font-bold"
            style={{ color: isPositive ? 'var(--tk-ok)' : 'var(--tk-critical)' }}
          >
            {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {isPositive ? '+' : ''}
            {change24h.toFixed(2)}% 24h
          </span>
        </div>
      </div>

      {sparkData.length > 2 && (
        <div className="w-24 shrink-0">
          <SparklineChart data={sparkData} color={isPositive ? '#19c393' : '#ff5b52'} height={28} />
        </div>
      )}

      <button
        onClick={refresh}
        disabled={isLoading}
        className="shrink-0 p-2 rounded-lg text-ink-3 hover:text-live-500 hover:bg-surface-elevated transition-colors disabled:opacity-50"
        title="Refresh rate"
      >
        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

export default RateDisplay;
