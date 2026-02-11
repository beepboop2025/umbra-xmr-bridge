/* =====================================================
   WebSocketService — Real-time updates via WebSocket
   ===================================================== */

import CONFIG from '../config.js';
import { eventBus, EVENTS } from './EventBus.js';

class WebSocketService {
    constructor() {
        this._orderWs = null;
        this._ratesWs = null;
        this._reconnectAttempts = 0;
        this._maxReconnectDelay = 30000;
        this._intentionalClose = false;
    }

    /**
     * Connect to order updates WebSocket
     * @param {string} orderId
     */
    connectOrder(orderId) {
        this.disconnectOrder();
        this._intentionalClose = false;

        const url = `${CONFIG.WS.BASE_URL}/v1/ws/order/${encodeURIComponent(orderId)}`;
        this._orderWs = new WebSocket(url);

        this._orderWs.onopen = () => {
            console.log('[WS] Order connection established');
            this._reconnectAttempts = 0;
        };

        this._orderWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                eventBus.emit(EVENTS.ORDER_STEP_CHANGED, data);

                if (data.status === 'completed') {
                    eventBus.emit(EVENTS.ORDER_COMPLETED, data);
                } else if (data.status === 'failed') {
                    eventBus.emit(EVENTS.ORDER_FAILED, data);
                }
            } catch (err) {
                console.error('[WS] Failed to parse order message:', err);
            }
        };

        this._orderWs.onerror = (err) => {
            console.error('[WS] Order connection error:', err);
        };

        this._orderWs.onclose = () => {
            if (!this._intentionalClose) {
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
        this._intentionalClose = false;

        const url = `${CONFIG.WS.BASE_URL}/v1/ws/rates`;
        this._ratesWs = new WebSocket(url);

        this._ratesWs.onopen = () => {
            console.log('[WS] Rates connection established');
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
            if (!this._intentionalClose) {
                setTimeout(() => this.connectRates(), 5000);
            }
        };
    }

    /**
     * Disconnect order WebSocket
     */
    disconnectOrder() {
        if (this._orderWs) {
            this._intentionalClose = true;
            this._orderWs.close();
            this._orderWs = null;
        }
    }

    /**
     * Disconnect rates WebSocket
     */
    disconnectRates() {
        if (this._ratesWs) {
            this._intentionalClose = true;
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
        this._reconnectAttempts++;
        const delay = Math.min(
            1000 * Math.pow(2, this._reconnectAttempts - 1),
            this._maxReconnectDelay
        );
        console.log(`[WS] Reconnecting order in ${delay}ms (attempt ${this._reconnectAttempts})`);
        setTimeout(() => this.connectOrder(orderId), delay);
    }
}

export const wsService = new WebSocketService();
export default wsService;
