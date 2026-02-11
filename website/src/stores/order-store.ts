import { create } from 'zustand';
import type { OrderDetail, OrderSummary, OrderStatus } from '@/lib/api-client';

interface OrderState {
  activeOrder: OrderDetail | null;
  orders: OrderSummary[];
  totalOrders: number;
  currentPage: number;
  totalPages: number;
  filter: {
    status: OrderStatus | 'all';
    chain: string;
    search: string;
  };
  isLoading: boolean;

  setActiveOrder: (order: OrderDetail | null) => void;
  setOrders: (orders: OrderSummary[], total: number, page: number, pages: number) => void;
  addOrder: (order: OrderSummary) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  setFilter: (filter: Partial<OrderState['filter']>) => void;
  setPage: (page: number) => void;
  setLoading: (loading: boolean) => void;
  clearActiveOrder: () => void;
}

export const useOrderStore = create<OrderState>((set) => ({
  activeOrder: null,
  orders: [],
  totalOrders: 0,
  currentPage: 1,
  totalPages: 1,
  filter: {
    status: 'all',
    chain: 'all',
    search: '',
  },
  isLoading: false,

  setActiveOrder: (order) => set({ activeOrder: order }),

  setOrders: (orders, totalOrders, currentPage, totalPages) =>
    set({ orders, totalOrders, currentPage, totalPages }),

  addOrder: (order) =>
    set((state) => ({
      orders: [order, ...state.orders],
      totalOrders: state.totalOrders + 1,
    })),

  updateOrderStatus: (orderId, status) =>
    set((state) => ({
      orders: state.orders.map((o) =>
        o.order_id === orderId ? { ...o, status } : o
      ),
      activeOrder:
        state.activeOrder?.order_id === orderId
          ? { ...state.activeOrder, status }
          : state.activeOrder,
    })),

  setFilter: (filter) =>
    set((state) => ({
      filter: { ...state.filter, ...filter },
      currentPage: 1,
    })),

  setPage: (page) => set({ currentPage: page }),

  setLoading: (isLoading) => set({ isLoading }),

  clearActiveOrder: () => set({ activeOrder: null }),
}));
