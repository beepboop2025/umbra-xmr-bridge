'use client';

import { useCallback, useEffect } from 'react';
import { useWalletStore } from '@/stores/wallet-store';
import { useUIStore } from '@/stores/ui-store';

export function useWallet() {
  const walletStore = useWalletStore();
  const addToast = useUIStore((s) => s.addToast);

  const connectTon = useCallback(async () => {
    walletStore.setConnecting(true);
    try {
      // TonConnect integration handled via TonConnectButton component
      // This is for programmatic access
      addToast({
        type: 'info',
        title: 'Connecting',
        message: 'Please approve the connection in your wallet.',
      });
    } catch (err) {
      walletStore.setConnecting(false);
      addToast({
        type: 'error',
        title: 'Connection Failed',
        message: err instanceof Error ? err.message : 'Failed to connect wallet',
      });
    }
  }, [walletStore, addToast]);

  const disconnect = useCallback(() => {
    walletStore.disconnect();
    addToast({
      type: 'info',
      title: 'Disconnected',
      message: 'Wallet disconnected successfully.',
    });
  }, [walletStore, addToast]);

  return {
    tonAddress: walletStore.tonAddress,
    tonBalance: walletStore.tonBalance,
    isConnected: walletStore.isConnected,
    isConnecting: walletStore.isConnecting,
    savedAddresses: walletStore.savedAddresses,
    connectTon,
    disconnect,
    setTonWallet: walletStore.setTonWallet,
    setSavedAddresses: walletStore.setSavedAddresses,
    addSavedAddress: walletStore.addSavedAddress,
    removeSavedAddress: walletStore.removeSavedAddress,
  };
}
