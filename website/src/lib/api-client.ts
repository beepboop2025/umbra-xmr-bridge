import type {
  Canary,
  CheckpointEnvelope,
  Checkpoint,
  ProofKey,
  ProofStatus,
  ReceiptBundle,
} from '@/lib/proof';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Anonymous per-browser id for saved-address scoping (no accounts on a no-KYC
 * bridge). Generated once and kept in localStorage; sent as X-Client-Id.
 */
function getClientId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let id = window.localStorage.getItem('umbra_client_id');
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem('umbra_client_id', id);
    }
    return id;
  } catch {
    return null;
  }
}

interface ApiError {
  message: string;
  status: number;
}

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const clientId = getClientId();
    if (clientId) {
      headers['X-Client-Id'] = clientId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          message: errorData.detail || errorData.message || `HTTP ${response.status}`,
          status: response.status,
        } as ApiError;
      }

      return response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw { message: 'Request timeout', status: 408 } as ApiError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Rate endpoints
  async getRate(source: string, dest: string, amount?: number) {
    const params = new URLSearchParams({ source, dest });
    if (amount) params.set('amount', String(amount));
    return this.request<{
      rate: number;
      source: string;
      dest: string;
      min_amount: number;
      max_amount: number;
      fee_percent: number;
      network_fee: number;
      estimated_time: number;
    }>(`/api/rate?${params}`);
  }

  async getRateHistory(source: string, dest: string, period = '24h') {
    return this.request<{
      points: Array<{ timestamp: number; rate: number }>;
      change_24h: number;
    }>(`/api/rate/history?source=${source}&dest=${dest}&period=${period}`);
  }

  // Order endpoints
  async createOrder(params: {
    source_chain: string;
    dest_chain: string;
    amount: number;
    dest_address: string;
    refund_address?: string;
  }) {
    return this.request<{
      order_id: string;
      deposit_address: string;
      deposit_amount: number;
      receive_amount: number;
      rate: number;
      fee: number;
      expires_at: string;
      status: string;
    }>('/api/order', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getOrder(orderId: string) {
    return this.request<OrderDetail>(`/api/order/${orderId}`);
  }

  async getOrders(params?: {
    page?: number;
    limit?: number;
    status?: string;
    chain?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.chain) searchParams.set('chain', params.chain);
    // The backend speaks {data, total, limit, offset} with direction/from_amount/
    // to_amount — normalize to the OrderSummary contract the UI renders.
    const raw = await this.request<{
      data: Array<{
        order_id: string;
        direction: string;
        from_amount: string;
        to_amount: string;
        status: OrderStatus;
        created_at: string;
      }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/api/orders?${searchParams}`);
    const limit = raw.limit || params?.limit || 20;
    const orders: OrderSummary[] = (raw.data ?? []).map((o) => {
      const [source_chain = '', dest_chain = ''] = o.direction.split('_TO_');
      return {
        order_id: o.order_id,
        source_chain,
        dest_chain,
        amount: Number(o.from_amount) || 0,
        receive_amount: Number(o.to_amount) || 0,
        status: o.status,
        created_at: o.created_at,
      };
    });
    return {
      orders,
      total: raw.total,
      page: Math.floor((raw.offset || 0) / limit) + 1,
      pages: Math.max(1, Math.ceil((raw.total || 0) / limit)),
    };
  }

  // Stats endpoints
  async getStats() {
    return this.request<{
      total_volume_usd: number;
      volume_24h_usd: number;
      active_orders: number;
      completed_orders: number;
      total_orders: number;
      avg_completion_time: number;
      supported_chains: number;
    }>('/api/stats');
  }

  async getVolumeHistory(period = '7d') {
    return this.request<{
      points: Array<{ date: string; volume: number; count: number }>;
    }>(`/api/stats/volume?period=${period}`);
  }

  // Explorer endpoints
  async getRecentTransactions(limit = 20) {
    return this.request<{
      transactions: OrderSummary[];
    }>(`/api/explorer/recent?limit=${limit}`);
  }

  async searchTransaction(query: string) {
    return this.request<{
      results: OrderSummary[];
    }>(`/api/explorer/search?q=${encodeURIComponent(query)}`);
  }

  // Admin endpoints
  async getSystemHealth() {
    return this.request<{
      status: string;
      uptime: number;
      pending_orders: number;
      wallet_balances: Record<string, number>;
      services: Record<string, { status: string; latency: number }>;
    }>('/api/admin/health');
  }

  async getAuditLog(params?: { page?: number; limit?: number; action?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.action) searchParams.set('action', params.action);
    return this.request<{
      entries: AuditEntry[];
      total: number;
    }>(`/api/admin/audit?${searchParams}`);
  }

  async getAdminOrders(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.status) searchParams.set('status', params.status);
    return this.request<{
      orders: OrderDetail[];
      total: number;
    }>(`/api/admin/orders?${searchParams}`);
  }

  // Proof Layer endpoints
  async getProofKey() {
    return this.request<ProofKey>('/v1/proof/key');
  }

  async getProofReceipts(orderId: string) {
    return this.request<ReceiptBundle>(
      `/v1/proof/receipt/${encodeURIComponent(orderId)}`
    );
  }

  async getLatestCheckpoint() {
    return this.request<CheckpointEnvelope>('/v1/proof/checkpoint/latest');
  }

  async getCheckpoints(limit = 20) {
    return this.request<Checkpoint[]>(`/v1/proof/checkpoints?limit=${limit}`);
  }

  async getProofStatus() {
    return this.request<ProofStatus>('/v1/proof/status');
  }

  async getCanary() {
    return this.request<Canary>('/v1/proof/canary');
  }

  // Wallet endpoints
  async getSavedAddresses() {
    return this.request<{
      addresses: SavedAddress[];
    }>('/api/wallet/addresses');
  }

  async saveAddress(params: { chain: string; address: string; label: string }) {
    return this.request<SavedAddress>('/api/wallet/addresses', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async deleteAddress(id: string) {
    return this.request<void>(`/api/wallet/addresses/${id}`, {
      method: 'DELETE',
    });
  }
}

// Types
export interface OrderSummary {
  order_id: string;
  source_chain: string;
  dest_chain: string;
  amount: number;
  receive_amount: number;
  status: OrderStatus;
  created_at: string;
  source_tx?: string;
  dest_tx?: string;
}

export interface OrderDetail extends OrderSummary {
  deposit_address: string;
  dest_address: string;
  refund_address?: string;
  rate: number;
  fee: number;
  fee_percent: number;
  network_fee: number;
  expires_at: string;
  completed_at?: string;
  timeline: OrderEvent[];
}

export interface OrderEvent {
  event: string;
  timestamp: string;
  details?: string;
  tx_hash?: string;
}

export type OrderStatus =
  | 'pending'
  | 'awaiting_deposit'
  | 'confirming'
  | 'exchanging'
  | 'sending'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'refunded';

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target?: string;
  details: string;
  timestamp: string;
  ip?: string;
}

export interface SavedAddress {
  id: string;
  chain: string;
  address: string;
  label: string;
  created_at: string;
}

export const apiClient = new ApiClient(API_BASE);
export default apiClient;
