import { create } from 'zustand';
import type { SavedAddress } from '@/lib/api-client';

interface WalletState {
  tonAddress: string | null;
  tonBalance: number;
  isConnected: boolean;
  isConnecting: boolean;
  savedAddresses: SavedAddress[];

  setTonWallet: (address: string | null, balance?: number) => void;
  setConnecting: (connecting: boolean) => void;
  disconnect: () => void;
  setSavedAddresses: (addresses: SavedAddress[]) => void;
  addSavedAddress: (address: SavedAddress) => void;
  removeSavedAddress: (id: string) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  tonAddress: null,
  tonBalance: 0,
  isConnected: false,
  isConnecting: false,
  savedAddresses: [],

  setTonWallet: (address, balance = 0) =>
    set({
      tonAddress: address,
      tonBalance: balance,
      isConnected: !!address,
      isConnecting: false,
    }),

  setConnecting: (isConnecting) => set({ isConnecting }),

  disconnect: () =>
    set({
      tonAddress: null,
      tonBalance: 0,
      isConnected: false,
      isConnecting: false,
    }),

  setSavedAddresses: (savedAddresses) => set({ savedAddresses }),

  addSavedAddress: (address) =>
    set((state) => ({
      savedAddresses: [...state.savedAddresses, address],
    })),

  removeSavedAddress: (id) =>
    set((state) => ({
      savedAddresses: state.savedAddresses.filter((a) => a.id !== id),
    })),
}));
