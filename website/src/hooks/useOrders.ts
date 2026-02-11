'use client';

import { useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { useOrderStore } from '@/stores/order-store';
import apiClient, { type OrderDetail, type OrderSummary } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';

function generateMockOrders(count: number): OrderSummary[] {
  const chains = ['BTC', 'ETH', 'TON', 'SOL', 'ARB', 'BASE', 'USDC', 'USDT'];
  const statuses = ['completed', 'completed', 'completed', 'exchanging', 'confirming', 'pending', 'expired'] as const;
  const orders: OrderSummary[] = [];

  for (let i = 0; i < count; i++) {
    const isXmrSource = Math.random() > 0.4;
    const otherChain = chains[Math.floor(Math.random() * chains.length)];
    const amount = 0.1 + Math.random() * 10;
    const status = statuses[Math.floor(Math.random() * statuses.length)];

    orders.push({
      order_id: `ord_${1000 + i}`,
      source_chain: isXmrSource ? 'XMR' : otherChain,
      dest_chain: isXmrSource ? otherChain : 'XMR',
      amount: Number(amount.toFixed(4)),
      receive_amount: Number((amount * 0.97).toFixed(4)),
      status,
      created_at: new Date(Date.now() - i * 3600000).toISOString(),
      source_tx: status !== 'pending' ? `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}` : undefined,
      dest_tx: status === 'completed' ? `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}` : undefined,
    });
  }
  return orders;
}

export function useOrders(page = 1, limit = 20) {
  const orderStore = useOrderStore();
  const addToast = useUIStore((s) => s.addToast);

  const { data, error, isLoading, mutate } = useSWR(
    `orders_${page}_${limit}_${orderStore.filter.status}_${orderStore.filter.chain}`,
    async () => {
      try {
        return await apiClient.getOrders({
          page,
          limit,
          status: orderStore.filter.status !== 'all' ? orderStore.filter.status : undefined,
          chain: orderStore.filter.chain !== 'all' ? orderStore.filter.chain : undefined,
        });
      } catch {
        const mockOrders = generateMockOrders(limit);
        return {
          orders: mockOrders,
          total: 150,
          page: 1,
          pages: 8,
        };
      }
    },
    {
      refreshInterval: 15000,
      revalidateOnFocus: false,
    }
  );

  useEffect(() => {
    if (data) {
      orderStore.setOrders(data.orders, data.total, data.page, data.pages);
    }
  }, [data]);

  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    orders: data?.orders || orderStore.orders,
    total: data?.total || orderStore.totalOrders,
    page: data?.page || orderStore.currentPage,
    pages: data?.pages || orderStore.totalPages,
    isLoading,
    error,
    refresh,
  };
}

export function useOrder(orderId: string | null) {
  const orderStore = useOrderStore();

  const { data, error, isLoading, mutate } = useSWR(
    orderId ? `order_${orderId}` : null,
    async () => {
      try {
        return await apiClient.getOrder(orderId!);
      } catch {
        // Mock order detail
        const chains = ['BTC', 'ETH', 'TON', 'SOL'];
        const destChain = chains[Math.floor(Math.random() * chains.length)];
        return {
          order_id: orderId!,
          source_chain: 'XMR',
          dest_chain: destChain,
          amount: 2.5,
          receive_amount: 2.43,
          status: 'completed' as const,
          created_at: new Date(Date.now() - 3600000).toISOString(),
          deposit_address: '4' + Array(94).fill(0).map(() => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 58)]).join(''),
          dest_address: '0x' + Array(40).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
          rate: 0.0485,
          fee: 0.0125,
          fee_percent: 0.5,
          network_fee: 0.0003,
          expires_at: new Date(Date.now() + 1800000).toISOString(),
          completed_at: new Date(Date.now() - 1800000).toISOString(),
          source_tx: Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
          dest_tx: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
          timeline: [
            { event: 'Order Created', timestamp: new Date(Date.now() - 3600000).toISOString() },
            { event: 'Deposit Detected', timestamp: new Date(Date.now() - 3300000).toISOString(), tx_hash: Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('') },
            { event: 'Deposit Confirmed (10/10)', timestamp: new Date(Date.now() - 2700000).toISOString() },
            { event: 'Exchange Completed', timestamp: new Date(Date.now() - 2400000).toISOString() },
            { event: 'Payout Sent', timestamp: new Date(Date.now() - 2100000).toISOString(), tx_hash: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('') },
            { event: 'Completed', timestamp: new Date(Date.now() - 1800000).toISOString() },
          ],
        } as OrderDetail;
      }
    },
    {
      refreshInterval: 10000,
      revalidateOnFocus: false,
    }
  );

  useEffect(() => {
    if (data) {
      orderStore.setActiveOrder(data);
    }
  }, [data]);

  return {
    order: data || orderStore.activeOrder,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useCreateOrder() {
  const orderStore = useOrderStore();
  const addToast = useUIStore((s) => s.addToast);

  const createOrder = useCallback(
    async (params: {
      source_chain: string;
      dest_chain: string;
      amount: number;
      dest_address: string;
      refund_address?: string;
    }) => {
      try {
        const result = await apiClient.createOrder(params);
        orderStore.addOrder({
          order_id: result.order_id,
          source_chain: params.source_chain,
          dest_chain: params.dest_chain,
          amount: params.amount,
          receive_amount: result.receive_amount,
          status: 'awaiting_deposit',
          created_at: new Date().toISOString(),
        });
        addToast({
          type: 'success',
          title: 'Order Created',
          message: `Order ${result.order_id} created. Send ${result.deposit_amount} ${params.source_chain} to the deposit address.`,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create order';
        addToast({
          type: 'error',
          title: 'Order Failed',
          message,
        });
        throw err;
      }
    },
    [orderStore, addToast]
  );

  return { createOrder };
}
