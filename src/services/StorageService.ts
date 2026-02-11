/* =====================================================
   StorageService — Persistent storage with versioning
   ===================================================== */

import CONFIG from '../config.ts';
import type { HistoryItem, UserSettings } from '../types.ts';

class StorageService {
    private _cache: Map<string, any> = new Map();

    /**
     * Get a value from storage
     */
    get<T>(key: string, fallback: T): T {
        if (this._cache.has(key)) {
            return this._cache.get(key) as T;
        }

        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;

            const parsed = JSON.parse(raw) as T;
            this._cache.set(key, parsed);
            return parsed;
        } catch (err) {
            console.warn(`[Storage] Failed to read "${key}":`, err);
            return fallback;
        }
    }

    /**
     * Set a value in storage
     */
    set(key: string, value: any): void {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            this._cache.set(key, value);
        } catch (err: any) {
            console.error(`[Storage] Failed to write "${key}":`, err);
            if (err?.name === 'QuotaExceededError') {
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
     */
    remove(key: string): void {
        localStorage.removeItem(key);
        this._cache.delete(key);
    }

    /**
     * Load transaction history
     */
    getHistory(): HistoryItem[] {
        return this.get<HistoryItem[]>(CONFIG.STORAGE.HISTORY, []);
    }

    /**
     * Save transaction to history
     */
    addToHistory(tx: HistoryItem): HistoryItem[] {
        const history = this.getHistory();
        history.unshift(tx);
        const trimmed = history.slice(0, CONFIG.UI.MAX_HISTORY);
        this.set(CONFIG.STORAGE.HISTORY, trimmed);
        return trimmed;
    }

    /**
     * Update a transaction in history
     */
    updateHistoryItem(txId: string, updates: Partial<HistoryItem>): HistoryItem[] {
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
     */
    getSettings(): UserSettings {
        return this.get<UserSettings>(CONFIG.STORAGE.SETTINGS, {
            slippage: CONFIG.DEFAULT_SLIPPAGE,
            lastDirection: 'xmr-ton',
            notifications: true,
        });
    }

    /**
     * Save user settings (partial merge)
     */
    saveSettings(settings: Partial<UserSettings>): UserSettings {
        const current = this.getSettings();
        const merged = { ...current, ...settings };
        this.set(CONFIG.STORAGE.SETTINGS, merged);
        return merged;
    }

    /**
     * Prune old data when storage is full
     */
    private _pruneOldData(): void {
        const history = this.getHistory();
        if (history.length > 10) {
            this.set(CONFIG.STORAGE.HISTORY, history.slice(0, 10));
        }
    }

    /**
     * Clear all bridge-related storage
     */
    clearAll(): void {
        Object.values(CONFIG.STORAGE).forEach((key) => {
            localStorage.removeItem(key);
        });
        this._cache.clear();
    }
}

export const storageService = new StorageService();
export default storageService;
