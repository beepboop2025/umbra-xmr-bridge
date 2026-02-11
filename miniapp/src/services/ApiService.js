/* =====================================================
   ApiService — Backend API client for bridge operations
   ===================================================== */

import CONFIG from '../config.js';
import { eventBus, EVENTS } from './EventBus.js';

class ApiService {
    constructor() {
        this._baseUrl = CONFIG.API.BASE_URL;
        this._timeout = CONFIG.API.TIMEOUT;
        this._retryAttempts = CONFIG.API.RETRY_ATTEMPTS;
        this._retryDelay = CONFIG.API.RETRY_DELAY;
    }

    /**
     * Fetch current exchange rate
     * @param {string} direction - e.g. 'xmr-ton', 'xmr-btc', 'xmr-eth'
     * @returns {Promise<Object>}
     */
    async fetchRate(direction) {
        return this._fetch(`/v1/rate?direction=${encodeURIComponent(direction)}`);
    }

    /**
     * Fetch rate history for sparkline
     * @param {string} direction
     * @param {string} period - '1h', '6h', '24h', '7d'
     * @returns {Promise<Object>}
     */
    async fetchRateHistory(direction, period = '1h') {
        return this._fetch(`/v1/rate/history?direction=${encodeURIComponent(direction)}&period=${period}`);
    }

    /**
     * Create a new bridge order
     * @param {Object} params
     * @returns {Promise<Object>}
     */
    async createOrder({ direction, amount, destAddress, slippage, telegramUserId }) {
        return this._fetch('/v1/order', {
            method: 'POST',
            body: JSON.stringify({
                direction,
                amount,
                dest_address: destAddress,
                slippage,
                telegram_user_id: telegramUserId,
            }),
        });
    }

    /**
     * Get order details
     * @param {string} orderId
     * @returns {Promise<Object>}
     */
    async getOrder(orderId) {
        return this._fetch(`/v1/order/${encodeURIComponent(orderId)}`);
    }

    /**
     * List orders for a user
     * @param {string} telegramUserId
     * @param {number} limit
     * @param {number} offset
     * @returns {Promise<Array>}
     */
    async listOrders(telegramUserId, limit = 50, offset = 0) {
        const params = new URLSearchParams({ limit, offset });
        if (telegramUserId) params.set('telegram_user_id', telegramUserId);
        return this._fetch(`/v1/orders?${params}`);
    }

    /**
     * Cancel a pending order
     * @param {string} orderId
     * @returns {Promise<Object>}
     */
    async cancelOrder(orderId) {
        return this._fetch(`/v1/order/${encodeURIComponent(orderId)}/cancel`, {
            method: 'POST',
        });
    }

    /**
     * Get supported chains
     * @returns {Promise<Object>}
     */
    async getChains() {
        return this._fetch('/v1/chains');
    }

    /**
     * Shared fetch with timeout, retry, and error normalization
     * @param {string} endpoint
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async _fetch(endpoint, options = {}) {
        const url = `${this._baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
        };

        let lastError;
        for (let attempt = 0; attempt < this._retryAttempts; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this._timeout);

            try {
                const response = await fetch(url, {
                    ...options,
                    headers,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorBody = await response.json().catch(() => ({}));
                    const message = errorBody.detail || errorBody.error || `HTTP ${response.status}`;
                    throw new Error(message);
                }

                return await response.json();

            } catch (err) {
                clearTimeout(timeoutId);
                lastError = err;

                if (err.name === 'AbortError') {
                    lastError = new Error('Request timed out');
                }

                // Don't retry POST requests (non-idempotent)
                if (options.method === 'POST') break;

                // Don't retry client errors (4xx)
                if (err.message && err.message.startsWith('HTTP 4')) break;

                // Wait before retry
                if (attempt < this._retryAttempts - 1) {
                    await new Promise(r => setTimeout(r, this._retryDelay * (attempt + 1)));
                }
            }
        }

        eventBus.emit(EVENTS.API_ERROR, { endpoint, error: lastError?.message });
        throw lastError;
    }
}

export const apiService = new ApiService();
export default apiService;
