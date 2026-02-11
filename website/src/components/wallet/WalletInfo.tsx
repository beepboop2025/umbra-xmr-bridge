'use client';

import { Wallet, ExternalLink } from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import { truncateAddress } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function WalletInfo() {
  const { isConnected, tonAddress, tonBalance, connectTon, disconnect } = useWallet();

  if (!isConnected) {
    return (
      <Card className="text-center py-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-ton-500/10 flex items-center justify-center">
          <Wallet size={32} className="text-ton-400" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">Connect Your Wallet</h3>
        <p className="text-sm text-gray-400 mb-4 max-w-sm mx-auto">
          Connect your TON wallet to manage your bridge orders and saved addresses.
        </p>
        <Button onClick={connectTon} icon={<Wallet size={16} />}>
          Connect TON Wallet
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-ton-400 to-ton-600 flex items-center justify-center">
            <Wallet size={20} className="text-white" />
          </div>
          <div>
            <p className="text-sm text-gray-400">TON Wallet</p>
            <p className="text-sm font-mono text-white">
              {truncateAddress(tonAddress || '', 8, 6)}
            </p>
          </div>
        </div>
        <a
          href={`https://tonviewer.com/${tonAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-surface-elevated transition-colors"
        >
          <ExternalLink size={16} />
        </a>
      </div>

      <div className="p-3 rounded-lg bg-surface-elevated">
        <p className="text-xs text-gray-500 mb-1">Balance</p>
        <p className="text-2xl font-bold text-white">
          {(Number(tonBalance) || 0).toFixed(2)} <span className="text-ton-400 text-lg">TON</span>
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="sm" fullWidth onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    </Card>
  );
}

export default WalletInfo;
