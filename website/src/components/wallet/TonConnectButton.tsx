'use client';

import { useState } from 'react';
import { Wallet, LogOut, Copy, Check, ExternalLink } from 'lucide-react';
import { truncateAddress, copyToClipboard } from '@/lib/utils';
import { useWallet } from '@/hooks/useWallet';
import { Button } from '@/components/ui/Button';

export function TonConnectButton() {
  const { isConnected, tonAddress, tonBalance, connectTon, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const handleCopy = async () => {
    if (tonAddress) {
      await copyToClipboard(tonAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isConnected) {
    return (
      <Button
        variant="outline"
        size="sm"
        icon={<Wallet size={14} />}
        onClick={connectTon}
      >
        Connect Wallet
      </Button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated border border-surface-border hover:border-ton-500/30 transition-colors"
      >
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-ton-400 to-ton-600 flex items-center justify-center">
          <Wallet size={10} className="text-white" />
        </div>
        <span className="text-sm text-gray-300 font-mono">
          {truncateAddress(tonAddress || '', 4, 4)}
        </span>
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-surface-border bg-surface-card shadow-xl z-50">
            <div className="p-4 border-b border-surface-border">
              <p className="text-xs text-gray-500 mb-1">Connected Wallet</p>
              <p className="text-sm text-white font-mono break-all">{tonAddress}</p>
            </div>
            <div className="p-4 border-b border-surface-border">
              <p className="text-xs text-gray-500 mb-1">Balance</p>
              <p className="text-lg font-semibold text-white">
                {(Number(tonBalance) || 0).toFixed(2)} <span className="text-ton-400">TON</span>
              </p>
            </div>
            <div className="p-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-surface-elevated transition-colors"
              >
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy Address'}
              </button>
              <a
                href={`https://tonviewer.com/${tonAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-surface-elevated transition-colors"
              >
                <ExternalLink size={14} />
                View on Explorer
              </a>
              <button
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              >
                <LogOut size={14} />
                Disconnect
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default TonConnectButton;
