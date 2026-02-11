import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

interface UIState {
  sidebarOpen: boolean;
  mobileNavOpen: boolean;
  activeModal: string | null;
  modalData: unknown;
  toasts: Toast[];

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  setMobileNavOpen: (open: boolean) => void;
  openModal: (modal: string, data?: unknown) => void;
  closeModal: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

let toastCounter = 0;

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  mobileNavOpen: false,
  activeModal: null,
  modalData: null,
  toasts: [],

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  toggleMobileNav: () =>
    set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),

  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),

  openModal: (activeModal, modalData = null) =>
    set({ activeModal, modalData }),

  closeModal: () =>
    set({ activeModal: null, modalData: null }),

  addToast: (toast) => {
    const id = `toast_${++toastCounter}_${Date.now()}`;
    const newToast: Toast = { ...toast, id };
    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));

    const duration = toast.duration || 5000;
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, duration);
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearToasts: () => set({ toasts: [] }),
}));
