'use client';

import { useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { useOrderStore } from '@/stores/order-store';
import apiClient, { type OrderDetail, type OrderSummary } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';

export function useOrders(page = 1, limit = 20) {
  const orderStore = useOrderStore();
  const addToast = useUIStore((s) => s.addToast);

  const { data, error, isLoading, mutate } = useSWR(
    `orders_${page}_${limit}_${orderStore.filter.status}_${orderStore.filter.chain}`,
    () => apiClient.getOrders({
      page,
      limit,
      status: orderStore.filter.status !== 'all' ? orderStore.filter.status : undefined,
      chain: orderStore.filter.chain !== 'all' ? orderStore.filter.chain : undefined,
    }),
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
    () => apiClient.getOrder(orderId!),
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
      } catch (err: any) {
        const message = err?.message || (err instanceof Error ? err.message : 'Failed to create order');
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
