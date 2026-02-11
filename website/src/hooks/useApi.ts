import useSWR, { type SWRConfiguration } from 'swr';
import apiClient from '@/lib/api-client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function fetcher<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${API_BASE}${url}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || error.message || `HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function useApi<T>(
  endpoint: string | null,
  config?: SWRConfiguration<T>
) {
  return useSWR<T>(
    endpoint,
    (url: string) => fetcher<T>(url),
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 5000,
      ...config,
    }
  );
}

export function useStats() {
  return useApi<{
    total_volume_usd: number;
    volume_24h_usd: number;
    active_orders: number;
    completed_orders: number;
    total_orders: number;
    avg_completion_time: number;
    supported_chains: number;
  }>('/api/stats', {
    refreshInterval: 30000,
    fallbackData: {
      total_volume_usd: 12450000,
      volume_24h_usd: 890000,
      active_orders: 42,
      completed_orders: 15230,
      total_orders: 15480,
      avg_completion_time: 12,
      supported_chains: 8,
    },
  });
}

export function useVolumeHistory(period = '7d') {
  return useApi<{
    points: Array<{ date: string; volume: number; count: number }>;
  }>(`/api/stats/volume?period=${period}`, {
    refreshInterval: 60000,
    fallbackData: {
      points: generateMockVolumeData(period),
    },
  });
}

export function useRecentTransactions(limit = 20) {
  return useApi<{
    transactions: Array<{
      order_id: string;
      source_chain: string;
      dest_chain: string;
      amount: number;
      receive_amount: number;
      status: string;
      created_at: string;
    }>;
  }>(`/api/explorer/recent?limit=${limit}`, {
    refreshInterval: 15000,
    fallbackData: {
      transactions: generateMockTransactions(limit),
    },
  });
}

export function useSystemHealth() {
  return useApi<{
    status: string;
    uptime: number;
    pending_orders: number;
    wallet_balances: Record<string, number>;
    services: Record<string, { status: string; latency: number }>;
  }>('/api/admin/health', {
    refreshInterval: 10000,
    fallbackData: {
      status: 'healthy',
      uptime: 864000,
      pending_orders: 5,
      wallet_balances: {
        XMR: 125.5,
        BTC: 2.34,
        ETH: 45.67,
        TON: 12500,
        SOL: 890,
      },
      services: {
        monero_rpc: { status: 'healthy', latency: 45 },
        bitcoin_rpc: { status: 'healthy', latency: 120 },
        ethereum_rpc: { status: 'healthy', latency: 85 },
        ton_rpc: { status: 'healthy', latency: 30 },
        database: { status: 'healthy', latency: 5 },
        redis: { status: 'healthy', latency: 2 },
      },
    },
  });
}

// Mock data generators for fallback
function generateMockVolumeData(period: string) {
  const days = period === '24h' ? 24 : period === '7d' ? 7 : period === '30d' ? 30 : 7;
  const points = [];
  const now = Date.now();

  for (let i = days; i >= 0; i--) {
    const date = new Date(now - i * (period === '24h' ? 3600000 : 86400000));
    points.push({
      date: date.toISOString().split('T')[0],
      volume: 80000 + Math.random() * 120000,
      count: Math.floor(20 + Math.random() * 80),
    });
  }
  return points;
}

function generateMockTransactions(limit: number) {
  const chains = ['BTC', 'ETH', 'TON', 'SOL', 'ARB', 'BASE', 'USDC', 'USDT'];
  const statuses = ['completed', 'completed', 'completed', 'exchanging', 'confirming', 'sending'];
  const transactions = [];

  for (let i = 0; i < limit; i++) {
    const isXmrSource = Math.random() > 0.4;
    const otherChain = chains[Math.floor(Math.random() * chains.length)];
    const amount = 0.1 + Math.random() * 10;

    transactions.push({
      order_id: `ord_${Date.now()}_${i}`,
      source_chain: isXmrSource ? 'XMR' : otherChain,
      dest_chain: isXmrSource ? otherChain : 'XMR',
      amount: Number(amount.toFixed(4)),
      receive_amount: Number((amount * (0.95 + Math.random() * 0.04)).toFixed(4)),
      status: statuses[Math.floor(Math.random() * statuses.length)],
      created_at: new Date(Date.now() - i * 300000 - Math.random() * 600000).toISOString(),
    });
  }
  return transactions;
}

export { apiClient };
