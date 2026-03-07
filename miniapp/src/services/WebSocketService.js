/* =====================================================
   WebSocketService — Real-time updates via WebSocket
   ===================================================== */

import CONFIG from '../config.js';
import { eventBus, EVENTS } from './EventBus.js';

class WebSocketService {
    constructor() {
        this._orderWs = null;
        this._ratesWs = null;
        this._orderReconnectAttempts = 0;
        this._ratesReconnectAttempts = 0;
        this._maxReconnectDelay = 30000;
        this._orderIntentionalClose = false;
        this._ratesIntentionalClose = false;
    }

    /**
     * Connect to order updates WebSocket
     * @param {string} orderId
     */
    connectOrder(orderId) {
        this.disconnectOrder();
        this._orderIntentionalClose = false;

        const url = `${CONFIG.WS.BASE_URL}/v1/ws/order/${encodeURIComponent(orderId)}`;
        this._orderWs = new WebSocket(url);

        this._orderWs.onopen = () => {
            console.log('[WS] Order connection established');
            this._orderReconnectAttempts = 0;
        };

        this._orderWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                eventBus.emit(EVENTS.ORDER_STEP_CHANGED, data);

                if (data.status === 'completed') {
                    eventBus.emit(EVENTS.ORDER_COMPLETED, data);
                    this.disconnectOrder(); // stop reconnecting on terminal state
                } else if (data.status === 'failed') {
                    eventBus.emit(EVENTS.ORDER_FAILED, data);
                    this.disconnectOrder();
                }
            } catch (err) {
                console.error('[WS] Failed to parse order message:', err);
            }
        };

        this._orderWs.onerror = (err) => {
            console.error('[WS] Order connection error:', err);
        };

        this._orderWs.onclose = () => {
            if (!this._orderIntentionalClose) {
                console.log('[WS] Order connection closed, reconnecting...');
                this._reconnectOrder(orderId);
            }
        };
    }

    /**
     * Connect to rate updates WebSocket
     */
    connectRates() {
        this.disconnectRates();
        this._ratesIntentionalClose = false;

        const url = `${CONFIG.WS.BASE_URL}/v1/ws/rates`;
        this._ratesWs = new WebSocket(url);

        this._ratesWs.onopen = () => {
            console.log('[WS] Rates connection established');
            this._ratesReconnectAttempts = 0;
        };

        this._ratesWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                eventBus.emit(EVENTS.RATE_UPDATED, {
                    rates: { [data.direction]: data.rate },
                    lastUpdated: data.timestamp * 1000,
                    priceHistory: data.sparkline || [],
                });
            } catch (err) {
                console.error('[WS] Failed to parse rate message:', err);
            }
        };

        this._ratesWs.onerror = (err) => {
            console.error('[WS] Rates connection error:', err);
        };

        this._ratesWs.onclose = () => {
            if (!this._ratesIntentionalClose) {
                this._ratesReconnectAttempts++;
                const delay = Math.min(
                    1000 * Math.pow(2, this._ratesReconnectAttempts - 1),
                    this._maxReconnectDelay
                );
                console.log(`[WS] Reconnecting rates in ${delay}ms (attempt ${this._ratesReconnectAttempts})`);
                setTimeout(() => this.connectRates(), delay);
            }
        };
    }

    /**
     * Disconnect order WebSocket
     */
    disconnectOrder() {
        this._orderIntentionalClose = true;
        if (this._orderWs) {
            this._orderWs.close();
            this._orderWs = null;
        }
    }

    /**
     * Disconnect rates WebSocket
     */
    disconnectRates() {
        this._ratesIntentionalClose = true;
        if (this._ratesWs) {
            this._ratesWs.close();
            this._ratesWs = null;
        }
    }

    /**
     * Disconnect all WebSockets
     */
    disconnect() {
        this.disconnectOrder();
        this.disconnectRates();
    }

    /**
     * Reconnect with exponential backoff
     */
    _reconnectOrder(orderId) {
        this._orderReconnectAttempts++;
        const delay = Math.min(
            1000 * Math.pow(2, this._orderReconnectAttempts - 1),
            this._maxReconnectDelay
        );
        console.log(`[WS] Reconnecting order in ${delay}ms (attempt ${this._orderReconnectAttempts})`);
        setTimeout(() => this.connectOrder(orderId), delay);
    }
}

export const wsService = new WebSocketService();
export default wsService;
