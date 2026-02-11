/* =====================================================
   StorageService — Persistent storage with versioning
   ===================================================== */

import CONFIG from '../config.js';

class StorageService {
    constructor() {
        this._cache = new Map();
    }

    /**
     * Get a value from storage
     * @param {string} key
     * @param {*} fallback
     * @returns {*}
     */
    get(key, fallback = null) {
        // Check cache first
        if (this._cache.has(key)) {
            return this._cache.get(key);
        }

        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;

            const parsed = JSON.parse(raw);
            this._cache.set(key, parsed);
            return parsed;
        } catch (err) {
            console.warn(`[Storage] Failed to read "${key}":`, err);
            return fallback;
        }
    }

    /**
     * Set a value in storage
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            this._cache.set(key, value);
        } catch (err) {
            console.error(`[Storage] Failed to write "${key}":`, err);
            // Handle quota exceeded
            if (err.name === 'QuotaExceededError') {
                this._pruneOldData();
                try {
                    localStorage.setItem(key, JSON.stringify(value));
                    this._cache.set(key, value);
                } catch {
                    console.error('[Storage] Still unable to write after pruning');
                }
            }
        }
    }

    /**
     * Remove a value from storage
     * @param {string} key
     */
    remove(key) {
        localStorage.removeItem(key);
        this._cache.delete(key);
    }

    /**
     * Load transaction history
     * @returns {Array}
     */
    getHistory() {
        return this.get(CONFIG.STORAGE.HISTORY, []);
    }

    /**
     * Save transaction to history
     * @param {Object} tx
     */
    addToHistory(tx) {
        const history = this.getHistory();
        history.unshift(tx);
        const trimmed = history.slice(0, CONFIG.UI.MAX_HISTORY);
        this.set(CONFIG.STORAGE.HISTORY, trimmed);
        return trimmed;
    }

    /**
     * Update a transaction in history
     * @param {string} txId
     * @param {Object} updates
     */
    updateHistoryItem(txId, updates) {
        const history = this.getHistory();
        const idx = history.findIndex((tx) => tx.id === txId);
        if (idx >= 0) {
            history[idx] = { ...history[idx], ...updates };
            this.set(CONFIG.STORAGE.HISTORY, history);
        }
        return history;
    }

    /**
     * Load user settings
     * @returns {Object}
     */
    getSettings() {
        return this.get(CONFIG.STORAGE.SETTINGS, {
            slippage: CONFIG.DEFAULT_SLIPPAGE,
            lastDirection: 'xmr-ton',
            notifications: true,
        });
    }

    /**
     * Save user settings
     * @param {Object} settings
     */
    saveSettings(settings) {
        const current = this.getSettings();
        const merged = { ...current, ...settings };
        this.set(CONFIG.STORAGE.SETTINGS, merged);
        return merged;
    }

    /**
     * Prune old data when storage is full
     */
    _pruneOldData() {
        const history = this.getHistory();
        if (history.length > 10) {
            this.set(CONFIG.STORAGE.HISTORY, history.slice(0, 10));
        }
    }

    /**
     * Clear all bridge-related storage
     */
    clearAll() {
        Object.values(CONFIG.STORAGE).forEach((key) => {
            localStorage.removeItem(key);
        });
        this._cache.clear();
    }
}

export const storageService = new StorageService();
export default storageService;
