'use client';

import { useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { useRateStore } from '@/stores/rate-store';
import { useBridgeStore } from '@/stores/bridge-store';
import apiClient from '@/lib/api-client';

const MOCK_RATES: Record<string, number> = {
  XMR_BTC: 0.00285,
  XMR_ETH: 0.0485,
  XMR_TON: 28.5,
  XMR_SOL: 0.82,
  XMR_ARB: 0.0485,
  XMR_BASE: 0.0485,
  XMR_USDC: 162.5,
  XMR_USDT: 162.3,
  BTC_XMR: 350.87,
  ETH_XMR: 20.62,
  TON_XMR: 0.0351,
  SOL_XMR: 1.22,
  ARB_XMR: 20.62,
  BASE_XMR: 20.62,
  USDC_XMR: 0.00616,
  USDT_XMR: 0.00616,
};

function getMockRate(source: string, dest: string): number {
  const pair = `${source}_${dest}`;
  return MOCK_RATES[pair] || 1;
}

async function fetchRate(source: string, dest: string, amount?: number) {
  try {
    const data = await apiClient.getRate(source, dest, amount);
    return data;
  } catch {
    const rate = getMockRate(source, dest);
    return {
      rate,
      source,
      dest,
      min_amount: 0.01,
      max_amount: 100,
      fee_percent: 0.5,
      network_fee: 0.0001,
      estimated_time: 12,
    };
  }
}

export function useRate(source?: string, dest?: string) {
  const bridgeStore = useBridgeStore();
  const rateStore = useRateStore();

  const srcChain = source || bridgeStore.sourceChain;
  const dstChain = dest || bridgeStore.destChain;
  const pair = `${srcChain}_${dstChain}`;

  const { data, error, isLoading, mutate } = useSWR(
    srcChain && dstChain && srcChain !== dstChain ? `rate_${pair}` : null,
    () => fetchRate(srcChain, dstChain),
    {
      refreshInterval: 30000,
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  );

  useEffect(() => {
    if (data) {
      rateStore.setRate(pair, data.rate);
      bridgeStore.setRate(
        data.rate,
        data.fee_percent,
        data.network_fee,
        data.estimated_time
      );
    }
  }, [data, pair]);

  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    rate: data?.rate || rateStore.getRate(srcChain, dstChain),
    feePercent: data?.fee_percent || 0.5,
    networkFee: data?.network_fee || 0,
    estimatedTime: data?.estimated_time || 12,
    minAmount: data?.min_amount || 0.01,
    maxAmount: data?.max_amount || 100,
    isLoading,
    error,
    refresh,
  };
}

export function useRateHistory(source?: string, dest?: string, period = '24h') {
  const bridgeStore = useBridgeStore();
  const rateStore = useRateStore();

  const srcChain = source || bridgeStore.sourceChain;
  const dstChain = dest || bridgeStore.destChain;
  const pair = `${srcChain}_${dstChain}`;

  const { data, error, isLoading } = useSWR(
    srcChain && dstChain ? `rate_history_${pair}_${period}` : null,
    async () => {
      try {
        return await apiClient.getRateHistory(srcChain, dstChain, period);
      } catch {
        // Generate mock history
        const points = [];
        const baseRate = getMockRate(srcChain, dstChain);
        const count = period === '24h' ? 24 : period === '7d' ? 168 : 720;
        const interval = period === '24h' ? 3600000 : 3600000;
        const now = Date.now();

        for (let i = count; i >= 0; i--) {
          points.push({
            timestamp: now - i * interval,
            rate: baseRate * (0.97 + Math.random() * 0.06),
          });
        }

        return {
          points,
          change_24h: -1.2 + Math.random() * 4,
        };
      }
    },
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    }
  );

  useEffect(() => {
    if (data) {
      rateStore.setHistory(pair, data.points, data.change_24h);
    }
  }, [data, pair]);

  return {
    history: data?.points || rateStore.getHistory(srcChain, dstChain),
    change24h: data?.change_24h || rateStore.getChange24h(srcChain, dstChain),
    isLoading,
    error,
  };
}
