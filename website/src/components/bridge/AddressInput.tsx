'use client';

import { useState } from 'react';
import { Clipboard, Check } from 'lucide-react';
import { CHAINS } from '@/lib/chains';
import { validateAddress } from '@/lib/validators';
import { cn } from '@/lib/utils';

interface AddressInputProps {
  label: string;
  chain: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
}

export function AddressInput({
  label,
  chain,
  value,
  onChange,
  error: externalError,
  required = true,
}: AddressInputProps) {
  const [touched, setTouched] = useState(false);
  const [pasted, setPasted] = useState(false);
  const chainData = CHAINS[chain];

  const validation = touched && value ? validateAddress(chain, value) : null;
  const error = externalError || (validation && !validation.valid ? validation.error : undefined);
  const valid = touched && value && validation?.valid;

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      onChange(text.trim());
      setPasted(true);
      setTimeout(() => setPasted(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="tk-label">
          {label}
          {required && <span className="text-critical ml-1">*</span>}
        </span>
        {valid && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono" style={{ color: 'var(--tk-ok)' }}>
            <Check size={11} /> valid
          </span>
        )}
      </div>
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-3 rounded-[11px] bg-surface-elevated border transition-colors focus-within:border-live-500/60',
          error ? 'border-critical/60' : valid ? 'border-ok/50' : 'border-surface-border'
        )}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={chainData?.addressPlaceholder || 'Enter address'}
          className="flex-1 min-w-0 bg-transparent text-sm text-ink-0 font-mono placeholder:text-ink-4 focus:outline-none"
        />
        <button
          onClick={handlePaste}
          className="shrink-0 p-1.5 rounded-lg text-ink-3 hover:text-ink-0 hover:bg-surface-card transition-colors"
          title="Paste from clipboard"
        >
          {pasted ? <Check size={14} style={{ color: 'var(--tk-ok)' }} /> : <Clipboard size={14} />}
        </button>
      </div>
      {error ? (
        <p className="text-[11px] text-critical">{error}</p>
      ) : (
        chainData && (
          <p className="text-[11px] font-mono text-ink-4">
            {chainData.name} address{chainData.network && ` · ${chainData.network}`} — funds are irreversible once sent
          </p>
        )
      )}
    </div>
  );
}

export default AddressInput;
