import { create } from 'zustand';

export type BridgeDirection = 'xmr_to_other' | 'other_to_xmr';

interface BridgeState {
  direction: BridgeDirection;
  sourceChain: string;
  destChain: string;
  sourceAmount: string;
  destAmount: string;
  destAddress: string;
  refundAddress: string;
  rate: number;
  feePercent: number;
  networkFee: number;
  estimatedTime: number;
  isLoading: boolean;
  error: string | null;

  setDirection: (direction: BridgeDirection) => void;
  flipDirection: () => void;
  setSourceChain: (chain: string) => void;
  setDestChain: (chain: string) => void;
  setSourceAmount: (amount: string) => void;
  setDestAmount: (amount: string) => void;
  setDestAddress: (address: string) => void;
  setRefundAddress: (address: string) => void;
  setRate: (rate: number, feePercent: number, networkFee: number, estimatedTime: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  direction: 'xmr_to_other' as BridgeDirection,
  sourceChain: 'XMR',
  destChain: 'TON',
  sourceAmount: '',
  destAmount: '',
  destAddress: '',
  refundAddress: '',
  rate: 0,
  feePercent: 0.5,
  networkFee: 0,
  estimatedTime: 0,
  isLoading: false,
  error: null,
};

export const useBridgeStore = create<BridgeState>((set, get) => ({
  ...initialState,

  setDirection: (direction) => {
    const state = get();
    if (direction === 'xmr_to_other') {
      set({
        direction,
        sourceChain: 'XMR',
        destChain: state.destChain === 'XMR' ? 'TON' : state.destChain,
      });
    } else {
      set({
        direction,
        destChain: 'XMR',
        sourceChain: state.sourceChain === 'XMR' ? 'TON' : state.sourceChain,
      });
    }
  },

  flipDirection: () => {
    const state = get();
    const newDirection: BridgeDirection =
      state.direction === 'xmr_to_other' ? 'other_to_xmr' : 'xmr_to_other';
    set({
      direction: newDirection,
      sourceChain: state.destChain,
      destChain: state.sourceChain,
      sourceAmount: state.destAmount,
      destAmount: state.sourceAmount,
      destAddress: '',
      refundAddress: '',
    });
  },

  setSourceChain: (chain) => {
    const state = get();
    if (chain === 'XMR') {
      set({ sourceChain: chain, direction: 'xmr_to_other' });
    } else if (state.destChain === chain) {
      set({ sourceChain: chain, destChain: state.sourceChain });
    } else {
      set({ sourceChain: chain });
    }
  },

  setDestChain: (chain) => {
    const state = get();
    if (chain === 'XMR') {
      set({ destChain: chain, direction: 'other_to_xmr' });
    } else if (state.sourceChain === chain) {
      set({ destChain: chain, sourceChain: state.destChain });
    } else {
      set({ destChain: chain });
    }
  },

  setSourceAmount: (amount) => {
    const numAmount = parseFloat(amount) || 0;
    const state = get();
    const fee = numAmount * (state.feePercent / 100);
    const destAmount = state.rate > 0 ? (numAmount - fee) * state.rate - state.networkFee : 0;
    set({
      sourceAmount: amount,
      destAmount: destAmount > 0 ? destAmount.toFixed(8) : '',
    });
  },

  setDestAmount: (amount) => set({ destAmount: amount }),

  setDestAddress: (address) => set({ destAddress: address }),

  setRefundAddress: (address) => set({ refundAddress: address }),

  setRate: (rate, feePercent, networkFee, estimatedTime) => {
    const state = get();
    const numAmount = parseFloat(state.sourceAmount) || 0;
    const fee = numAmount * (feePercent / 100);
    const destAmount = rate > 0 ? (numAmount - fee) * rate - networkFee : 0;
    set({
      rate,
      feePercent,
      networkFee,
      estimatedTime,
      destAmount: destAmount > 0 ? destAmount.toFixed(8) : '',
    });
  },

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));
