/* =====================================================
   EventBus — Pub/Sub for decoupled component communication
   ===================================================== */

class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} unsubscribe function
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);

        // Return disposer
        return () => this.off(event, callback);
    }

    /**
     * Subscribe to an event once
     * @param {string} event
     * @param {Function} callback
     */
    once(event, callback) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            callback(...args);
        };
        this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            listeners.delete(callback);
            if (listeners.size === 0) this._listeners.delete(event);
        }
    }

    /**
     * Emit an event
     * @param {string} event
     * @param  {...any} args
     */
    emit(event, ...args) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            for (const callback of listeners) {
                try {
                    callback(...args);
                } catch (err) {
                    console.error(`[EventBus] Error in listener for "${event}":`, err);
                }
            }
        }
    }

    /**
     * Remove all listeners
     */
    clear() {
        this._listeners.clear();
    }
}

// Singleton
export const eventBus = new EventBus();

// Event constants
export const EVENTS = {
    DIRECTION_CHANGED: 'direction:changed',
    AMOUNT_CHANGED: 'amount:changed',
    RATE_UPDATED: 'rate:updated',
    RATE_STALE: 'rate:stale',
    ORDER_CREATED: 'order:created',
    ORDER_STEP_CHANGED: 'order:step',
    ORDER_COMPLETED: 'order:completed',
    ORDER_FAILED: 'order:failed',
    HISTORY_UPDATED: 'history:updated',
    SETTINGS_CHANGED: 'settings:changed',
    TOAST: 'ui:toast',
    CONFIRM_REQUEST: 'ui:confirm',
    CONFIRM_RESPONSE: 'ui:confirm:response',
    MODAL_OPEN: 'ui:modal:open',
    MODAL_CLOSE: 'ui:modal:close',
    NETWORK_STATUS: 'network:status',
};

export default eventBus;
