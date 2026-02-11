'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { ChevronDown, Search } from 'lucide-react';
import { CHAINS, COUNTERPARTY_CHAINS, type Chain } from '@/lib/chains';
import { cn } from '@/lib/utils';

interface ChainSelectorProps {
  selectedChain: string;
  onSelect: (chainId: string) => void;
  excludeChain?: string;
  xmrOnly?: boolean;
  label?: string;
}

function ChainIcon({ chain, size = 24 }: { chain: Chain; size?: number }) {
  if (chain.icon) {
    return (
      <Image
        src={chain.icon}
        alt={chain.name}
        width={size}
        height={size}
        className="rounded-full"
      />
    );
  }

  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold"
      style={{
        width: size,
        height: size,
        backgroundColor: chain.color,
        fontSize: size * 0.4,
      }}
    >
      {chain.symbol.charAt(0)}
    </div>
  );
}

export function ChainSelector({
  selectedChain,
  onSelect,
  excludeChain,
  xmrOnly = false,
  label,
}: ChainSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = CHAINS[selectedChain];
  const chains = xmrOnly
    ? [CHAINS.XMR]
    : COUNTERPARTY_CHAINS.filter(
        (c) => c.id !== excludeChain && (search === '' || c.name.toLowerCase().includes(search.toLowerCase()) || c.symbol.toLowerCase().includes(search.toLowerCase()))
      );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (xmrOnly && selected) {
    return (
      <div className="flex flex-col gap-1.5">
        {label && <label className="text-sm font-medium text-gray-300">{label}</label>}
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface-elevated border border-surface-border">
          <ChainIcon chain={selected} />
          <div>
            <p className="text-sm font-medium text-white">{selected.name}</p>
            <p className="text-xs text-gray-500">{selected.symbol}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" ref={dropdownRef}>
      {label && <label className="text-sm font-medium text-gray-300">{label}</label>}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-surface-elevated border transition-colors',
          isOpen ? 'border-xmr-500/50' : 'border-surface-border hover:border-surface-hover'
        )}
      >
        <div className="flex items-center gap-3">
          {selected && <ChainIcon chain={selected} />}
          <div className="text-left">
            <p className="text-sm font-medium text-white">{selected?.name || 'Select chain'}</p>
            {selected?.network && (
              <p className="text-xs text-gray-500">{selected.network}</p>
            )}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={cn('text-gray-500 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full max-h-80 overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-2xl">
          <div className="p-2 border-b border-surface-border">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search chains..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface-elevated border border-surface-border text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-xmr-500/50"
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-60 p-1">
            {chains.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No chains found</p>
            ) : (
              chains.map((chain) => (
                <button
                  key={chain.id}
                  onClick={() => {
                    onSelect(chain.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors',
                    chain.id === selectedChain
                      ? 'bg-xmr-500/10 text-xmr-400'
                      : 'text-white hover:bg-surface-elevated'
                  )}
                >
                  <ChainIcon chain={chain} size={28} />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{chain.name}</p>
                    <p className="text-xs text-gray-500">
                      {chain.symbol}
                      {chain.network && ` on ${chain.network}`}
                    </p>
                  </div>
                  {chain.type === 'stablecoin' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-medium">
                      Stable
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { ChainIcon };
export default ChainSelector;
