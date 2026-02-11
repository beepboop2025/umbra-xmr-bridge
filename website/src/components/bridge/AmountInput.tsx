'use client';

import { CHAINS } from '@/lib/chains';
import { ChainIcon } from './ChainSelector';
import { cn } from '@/lib/utils';

interface AmountInputProps {
  label: string;
  chain: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  error?: string;
  maxAmount?: number;
}

export function AmountInput({
  label,
  chain,
  value,
  onChange,
  readOnly = false,
  error,
  maxAmount,
}: AmountInputProps) {
  const chainData = CHAINS[chain];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow only valid numeric input
    if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
      onChange?.(raw);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-300">{label}</label>
        {maxAmount !== undefined && !readOnly && (
          <button
            onClick={() => onChange?.(String(maxAmount))}
            className="text-xs text-xmr-400 hover:text-xmr-300 transition-colors"
          >
            Max: {maxAmount} {chainData?.symbol}
          </button>
        )}
      </div>
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
          readOnly ? 'bg-surface-base border-surface-border' : 'bg-surface-elevated border-surface-border focus-within:border-xmr-500/50',
          error && 'border-red-500/50'
        )}
      >
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={handleChange}
          readOnly={readOnly}
          placeholder="0.00"
          className={cn(
            'flex-1 bg-transparent text-xl font-semibold text-white placeholder:text-gray-700 focus:outline-none',
            readOnly && 'text-gray-400'
          )}
        />
        {chainData && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-card border border-surface-border">
            <ChainIcon chain={chainData} size={20} />
            <span className="text-sm font-medium text-gray-300">{chainData.symbol}</span>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export default AmountInput;
