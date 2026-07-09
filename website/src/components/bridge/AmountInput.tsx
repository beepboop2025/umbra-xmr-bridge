'use client';

import { CHAINS } from '@/lib/chains';
import { ChainIcon } from './ChainSelector';
import { cn } from '@/lib/utils';

interface AmountInputProps {
  label?: string;
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
  const showMax = maxAmount !== undefined && !readOnly;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow only valid numeric input
    if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
      onChange?.(raw);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {(label || showMax) && (
        <div className="flex items-center justify-between">
          {label ? <span className="tk-label">{label}</span> : <span />}
          {showMax && (
            <button
              onClick={() => onChange?.(String(maxAmount))}
              className="text-[11px] font-mono text-live-500 hover:text-live-400 transition-colors"
            >
              max {maxAmount} {chainData?.symbol}
            </button>
          )}
        </div>
      )}
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-[11px] border transition-colors',
          readOnly
            ? 'bg-surface-base border-surface-border'
            : 'bg-surface-elevated border-surface-border focus-within:border-live-500/60',
          error && 'border-critical/60'
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
            'tk-num flex-1 min-w-0 bg-transparent text-2xl font-bold text-ink-0 placeholder:text-ink-4 focus:outline-none',
            readOnly && 'text-ink-2'
          )}
        />
        {chainData && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-card border border-surface-border shrink-0">
            <ChainIcon chain={chainData} size={20} />
            <span className="text-sm font-semibold text-ink-1">{chainData.symbol}</span>
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-critical">{error}</p>}
    </div>
  );
}

export default AmountInput;
