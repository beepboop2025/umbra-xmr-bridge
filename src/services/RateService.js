/* =====================================================
   RateService — Exchange rate management with caching
   ===================================================== */

import CONFIG from '../config.js';
import { eventBus, EVENTS } from './EventBus.js';

class RateService {
    constructor() {
        this._rates = {
            'xmr-ton': 52.35,
            'ton-xmr': 1 / 52.35,
        };
        this._lastUpdated = Date.now();
        this._refreshTimer = null;
        this._isOnline = navigator.onLine;
        this._priceHistory = [];  // For sparkline chart

        // Monitor network status
        window.addEventListener('online', () => this._setOnline(true));
        window.addEventListener('offline', () => this._setOnline(false));
    }

    /**
     * Start periodic rate refresh
     */
    startPolling() {
        this._refreshRates();
        this._refreshTimer = setInterval(
            () => this._refreshRates(),
            CONFIG.RATE_REFRESH_INTERVAL,
        );
    }

    /**
     * Stop periodic rate refresh
     */
    stopPolling() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    /**
     * Get current rate for a direction
     * @param {string} direction - 'xmr-ton' or 'ton-xmr'
     * @returns {number}
     */
    getRate(direction) {
        return this._rates[direction] || 0;
    }

    /**
     * Get rate metadata
     * @returns {Object}
     */
    getRateInfo() {
        const age = Date.now() - this._lastUpdated;
        return {
            rates: { ...this._rates },
            lastUpdated: this._lastUpdated,
            age,
            isStale: age > CONFIG.RATE_STALE_THRESHOLD,
            isOnline: this._isOnline,
        };
    }

    /**
     * Calculate conversion with fee
     * @param {number} amount
     * @param {string} direction
     * @param {number} slippage - percentage
     * @returns {Object}
     */
    calculateConversion(amount, direction, slippage = CONFIG.DEFAULT_SLIPPAGE) {
        const rate = this._rates[direction];
        if (!rate || !amount || amount <= 0) {
            return { toAmount: 0, fee: 0, minReceived: 0, effectiveRate: 0 };
        }

        const fee = amount * CONFIG.BRIDGE_FEE_PERCENT;
        const netAmount = amount - fee;
        const toAmount = netAmount * rate;
        const slippageFactor = 1 - slippage / 100;
        const minReceived = toAmount * slippageFactor;

        return {
            toAmount: parseFloat(toAmount.toFixed(CONFIG.UI.MAX_DECIMAL_DISPLAY)),
            fee: parseFloat(fee.toFixed(CONFIG.UI.MAX_DECIMAL_DISPLAY)),
            minReceived: parseFloat(minReceived.toFixed(CONFIG.UI.MAX_DECIMAL_DISPLAY)),
            effectiveRate: parseFloat((toAmount / amount).toFixed(CONFIG.UI.MAX_DECIMAL_DISPLAY)),
        };
    }

    /**
     * Get price history for sparkline
     * @returns {number[]}
     */
    getPriceHistory() {
        return [...this._priceHistory];
    }

    /**
     * Fetch rates from API (currently mocked)
     */
    async _refreshRates() {
        try {
            // TODO: Replace with real API call
            // const response = await fetch(`${CONFIG.API.BASE_URL}${CONFIG.API.ENDPOINTS.RATE}`);
            // const data = await response.json();

            // Simulated realistic fluctuation (±0.3%), clamped within ±5% of base rate
            const BASE_RATE = 52.35;
            const MAX_DRIFT = 0.05;
            const fluctuation = 1 + (Math.random() - 0.5) * 0.006;
            let newRate = this._rates['xmr-ton'] * fluctuation;
            const lowerBound = BASE_RATE * (1 - MAX_DRIFT);
            const upperBound = BASE_RATE * (1 + MAX_DRIFT);
            newRate = Math.max(lowerBound, Math.min(upperBound, newRate));
            this._rates['xmr-ton'] = newRate;
            this._rates['ton-xmr'] = 1 / this._rates['xmr-ton'];

            this._lastUpdated = Date.now();

            // Track price history (keep last 30 data points)
            this._priceHistory.push(this._rates['xmr-ton']);
            if (this._priceHistory.length > 30) {
                this._priceHistory.shift();
            }

            eventBus.emit(EVENTS.RATE_UPDATED, {
                rates: { ...this._rates },
                lastUpdated: this._lastUpdated,
                priceHistory: this.getPriceHistory(),
            });

        } catch (err) {
            console.error('[RateService] Failed to refresh rates:', err);
            // Check if rate is stale
            if (Date.now() - this._lastUpdated > CONFIG.RATE_STALE_THRESHOLD) {
                eventBus.emit(EVENTS.RATE_STALE);
            }
        }
    }

    _setOnline(isOnline) {
        this._isOnline = isOnline;
        eventBus.emit(EVENTS.NETWORK_STATUS, { isOnline });

        if (isOnline && !this._refreshTimer) {
            this.startPolling();
        }
    }
}

export const rateService = new RateService();
export default rateService;
