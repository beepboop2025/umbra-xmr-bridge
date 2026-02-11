import { create } from 'zustand';

interface RatePoint {
  timestamp: number;
  rate: number;
}

interface RateState {
  rates: Record<string, number>;
  history: Record<string, RatePoint[]>;
  change24h: Record<string, number>;
  lastUpdated: number;

  setRate: (pair: string, rate: number) => void;
  setRates: (rates: Record<string, number>) => void;
  setHistory: (pair: string, points: RatePoint[], change24h: number) => void;
  getRate: (source: string, dest: string) => number;
  getHistory: (source: string, dest: string) => RatePoint[];
  getChange24h: (source: string, dest: string) => number;
}

export const useRateStore = create<RateState>((set, get) => ({
  rates: {},
  history: {},
  change24h: {},
  lastUpdated: 0,

  setRate: (pair, rate) =>
    set((state) => ({
      rates: { ...state.rates, [pair]: rate },
      lastUpdated: Date.now(),
    })),

  setRates: (rates) =>
    set({ rates, lastUpdated: Date.now() }),

  setHistory: (pair, points, change24h) =>
    set((state) => ({
      history: { ...state.history, [pair]: points },
      change24h: { ...state.change24h, [pair]: change24h },
    })),

  getRate: (source, dest) => {
    const pair = `${source}_${dest}`;
    return get().rates[pair] || 0;
  },

  getHistory: (source, dest) => {
    const pair = `${source}_${dest}`;
    return get().history[pair] || [];
  },

  getChange24h: (source, dest) => {
    const pair = `${source}_${dest}`;
    return get().change24h[pair] || 0;
  },
}));
