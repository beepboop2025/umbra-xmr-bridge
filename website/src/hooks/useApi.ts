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
    // No mock fallback — show real /api/stats (or a loading em-dash), never fake numbers.
  });
}

export function useVolumeHistory(period = '7d') {
  return useApi<{
    points: Array<{ date: string; volume: number; count: number }>;
  }>(`/api/stats/volume?period=${period}`, {
    refreshInterval: 60000,
    // No mock fallback — an empty chart is honest, fake volume is not.
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
    // No mock fallback — the explorer streams real transactions or shows an empty state.
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
    // No fallbackData — admin pages must show real data or an error state,
    // never fake "healthy" status that masks actual failures.
  });
}

export { apiClient };
