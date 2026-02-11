'use client';

import { Info, Clock, Percent, Coins } from 'lucide-react';
import { CHAINS } from '@/lib/chains';
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
  const feeAmount = sourceAmount * (feePercent / 100);

  if (!sourceAmount || !rate) return null;

  return (
    <div className={cn('rounded-lg bg-surface-base border border-surface-border p-4 space-y-3', className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
        <Info size={14} className="text-gray-500" />
        Fee Breakdown
      </div>

      <div className="space-y-2">
        <Row
          label="Exchange Rate"
          value={`1 ${srcChain?.symbol} = ${(Number(rate) || 0).toFixed(8)} ${dstChain?.symbol}`}
          icon={<Coins size={12} />}
        />
        <Row
          label="Bridge Fee"
          value={`${feePercent}% (${(Number(feeAmount) || 0).toFixed(6)} ${srcChain?.symbol})`}
          icon={<Percent size={12} />}
        />
        <Row
          label="Network Fee"
          value={`${(Number(networkFee) || 0).toFixed(6)} ${dstChain?.symbol}`}
          icon={<Coins size={12} />}
        />
        <Row
          label="Estimated Time"
          value={`~${estimatedTime} minutes`}
          icon={<Clock size={12} />}
        />
      </div>

      <div className="pt-2 border-t border-surface-border">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-300">You Receive</span>
          <span className="text-lg font-bold text-white">
            {(Number(destAmount) || 0).toFixed(8)} {dstChain?.symbol}
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-gray-500">
        {icon}
        {label}
      </span>
      <span className="text-gray-300 font-mono">{value}</span>
    </div>
  );
}

export default FeeBreakdown;
