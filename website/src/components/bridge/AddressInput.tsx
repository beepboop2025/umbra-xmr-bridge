'use client';

import { useState } from 'react';
import { Clipboard, Check, QrCode } from 'lucide-react';
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
      <label className="text-sm font-medium text-gray-300">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-3 rounded-lg bg-surface-elevated border transition-colors',
          'focus-within:border-xmr-500/50',
          error ? 'border-red-500/50' : 'border-surface-border'
        )}
      >
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={chainData?.addressPlaceholder || 'Enter address'}
          className="flex-1 bg-transparent text-sm text-white font-mono placeholder:text-gray-600 focus:outline-none min-w-0"
        />
        <button
          onClick={handlePaste}
          className="shrink-0 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-surface-card transition-colors"
          title="Paste from clipboard"
        >
          {pasted ? (
            <Check size={14} className="text-green-400" />
          ) : (
            <Clipboard size={14} />
          )}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!error && chainData && (
        <p className="text-xs text-gray-600">
          {chainData.name} address
          {chainData.network && ` (${chainData.network})`}
        </p>
      )}
    </div>
  );
}

export default AddressInput;
