'use client';

import { useState } from 'react';
import { Plus, Trash2, Wallet, Copy, Check, ExternalLink } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { WalletInfo } from '@/components/wallet/WalletInfo';
import { useWallet } from '@/hooks/useWallet';
import { COUNTERPARTY_CHAINS, CHAINS } from '@/lib/chains';
import { truncateAddress, copyToClipboard } from '@/lib/utils';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

const chainOptions = [
  { value: 'XMR', label: 'Monero (XMR)' },
  ...COUNTERPARTY_CHAINS.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.symbol})`,
  })),
];

// Mock saved addresses
const mockAddresses = [
  { id: '1', chain: 'BTC', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', label: 'My Hardware Wallet', created_at: '2024-01-15' },
  { id: '2', chain: 'ETH', address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', label: 'MetaMask Main', created_at: '2024-01-20' },
  { id: '3', chain: 'TON', address: 'EQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', label: 'Tonkeeper', created_at: '2024-02-01' },
  { id: '4', chain: 'XMR', address: '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skQNBYBGDnRmDv', label: 'Monero GUI', created_at: '2024-02-05' },
];

export default function WalletsPage() {
  const { savedAddresses } = useWallet();
  const addToast = useUIStore((s) => s.addToast);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAddress, setNewAddress] = useState({ chain: 'BTC', address: '', label: '' });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const addresses = savedAddresses.length > 0 ? savedAddresses : mockAddresses;

  const handleCopy = async (address: string, id: string) => {
    await copyToClipboard(address);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAddAddress = () => {
    if (!newAddress.address || !newAddress.label) {
      addToast({ type: 'error', title: 'Missing fields', message: 'Please fill in all fields.' });
      return;
    }
    addToast({ type: 'success', title: 'Address Saved', message: `${newAddress.label} has been saved.` });
    setShowAddModal(false);
    setNewAddress({ chain: 'BTC', address: '', label: '' });
  };

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 p-6 pb-24 md:pb-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Wallets & Addresses</h1>
            <p className="text-sm text-gray-400 mt-1">Manage your connected wallets and saved addresses</p>
          </div>
          <Button icon={<Plus size={16} />} onClick={() => setShowAddModal(true)}>
            Add Address
          </Button>
        </div>

        {/* Connected Wallet */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Connected Wallet
          </h2>
          <WalletInfo />
        </div>

        {/* Saved Addresses */}
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Saved Addresses ({addresses.length})
          </h2>
          <div className="space-y-3">
            {addresses.map((addr) => {
              const chain = CHAINS[addr.chain];
              return (
                <Card key={addr.id} hoverable>
                  <div className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: `${chain?.color || '#888'}20` }}
                    >
                      <span style={{ color: chain?.color }}>{addr.chain}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{addr.label}</p>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-elevated text-gray-400">
                          {addr.chain}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-gray-500 truncate mt-0.5">
                        {addr.address}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleCopy(addr.address, addr.id)}
                        className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-surface-elevated transition-colors"
                      >
                        {copiedId === addr.id ? (
                          <Check size={14} className="text-green-400" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      <button className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Add Address Modal */}
        <Modal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="Add Saved Address"
        >
          <div className="space-y-4">
            <Select
              label="Chain"
              options={chainOptions}
              value={newAddress.chain}
              onChange={(e) => setNewAddress({ ...newAddress, chain: e.target.value })}
            />
            <Input
              label="Label"
              placeholder="e.g., My Hardware Wallet"
              value={newAddress.label}
              onChange={(e) => setNewAddress({ ...newAddress, label: e.target.value })}
            />
            <Input
              label="Address"
              placeholder={CHAINS[newAddress.chain]?.addressPlaceholder || 'Enter address'}
              value={newAddress.address}
              onChange={(e) => setNewAddress({ ...newAddress, address: e.target.value })}
              className="font-mono text-xs"
            />
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" fullWidth onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button fullWidth onClick={handleAddAddress}>
                Save Address
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
}
