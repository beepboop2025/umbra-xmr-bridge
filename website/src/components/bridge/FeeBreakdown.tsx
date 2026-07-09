'use client';

import { CHAINS } from '@/lib/chains';
import { Provenance } from '@/components/tikto/primitives';
import { cn } from '@/lib/utils';

interface FeeBreakdownProps {
  sourceChain: string;
  destChain: string;
  sourceAmount: number;
  destAmount: number;
  rate: number;
  feePercent: number;
  networkFee: number;
  estimatedTime: number;
  className?: string;
}

export function FeeBreakdown({
  sourceChain,
  destChain,
  sourceAmount,
  destAmount,
  rate,
  feePercent,
  networkFee,
  estimatedTime,
  className,
}: FeeBreakdownProps) {
  const srcChain = CHAINS[sourceChain];
  const dstChain = CHAINS[destChain];

  if (!sourceAmount || !rate) return null;

  const feeAmount = sourceAmount * (feePercent / 100);
  const dp = dstChain?.type === 'stablecoin' ? 2 : 6;
  const minReceived = (Number(destAmount) || 0).toFixed(dp);

  const rows = [
    { k: 'you send', v: `${sourceAmount} ${srcChain?.symbol}` },
    { k: 'exchange rate', v: `1 ${srcChain?.symbol} = ${(Number(rate) || 0).toFixed(8)} ${dstChain?.symbol}` },
    { k: `bridge fee · ${feePercent}%`, v: `− ${(Number(feeAmount) || 0).toFixed(6)} ${srcChain?.symbol}` },
    { k: 'network fee', v: `− ${(Number(networkFee) || 0).toFixed(6)} ${dstChain?.symbol}` },
  ];

  return (
    <div className={cn('rounded-[11px] bg-surface-base border border-surface-border p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="tk-label">You receive · minimum</div>
          <div className="mt-1.5">
            <Provenance rows={rows}>
              <span className="tk-num text-base font-bold text-ink-0">
                {minReceived} {dstChain?.symbol}
              </span>
            </Provenance>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="tk-label">settles in</div>
          <div className="tk-num text-sm font-semibold text-ink-1 mt-1.5">~{estimatedTime} min</div>
        </div>
      </div>
      <p className="text-[11px] font-mono text-ink-4 mt-2.5">
        pull the figure for its derivation · slippage-protected, guaranteed minimum
      </p>
    </div>
  );
}

export default FeeBreakdown;
