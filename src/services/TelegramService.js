/* =====================================================
   TelegramService — Telegram WebApp SDK wrapper
   ===================================================== */

class TelegramService {
    constructor() {
        this._tg = window.Telegram?.WebApp;
        this._initialized = false;
        this._backButtonCallback = null;
    }

    /**
     * Initialize Telegram WebApp
     */
    init() {
        if (!this._tg) {
            console.log('[Telegram] Running in standalone mode');
            return false;
        }

        this._tg.ready();
        this._tg.expand();

        // Apply theme
        document.body.classList.add('tg-theme');

        // Set colors
        this._safeCall('setHeaderColor', '#0A0E17');
        this._safeCall('setBackgroundColor', '#0A0E17');
        this._safeCall('enableClosingConfirmation');

        this._initialized = true;

        console.log('[Telegram] Initialized', {
            version: this._tg.version,
            platform: this._tg.platform,
            theme: this._tg.colorScheme,
        });

        return true;
    }

    /**
     * Check if running inside Telegram
     * @returns {boolean}
     */
    get isAvailable() {
        return !!this._tg;
    }

    /**
     * Get the Telegram WebApp instance
     * @returns {Object|null}
     */
    get instance() {
        return this._tg;
    }

    /**
     * Get Telegram user data
     * @returns {Object|null}
     */
    getUser() {
        return this._tg?.initDataUnsafe?.user || null;
    }

    /**
     * Get theme parameters
     * @returns {Object}
     */
    getTheme() {
        if (!this._tg) return { colorScheme: 'dark' };
        return {
            colorScheme: this._tg.colorScheme || 'dark',
            themeParams: this._tg.themeParams || {},
        };
    }

    /**
     * Show the Telegram main button
     * @param {string} text
     * @param {Function} callback
     */
    showMainButton(text, callback) {
        if (!this._tg?.MainButton) return;
        this._tg.MainButton.setText(text);
        this._tg.MainButton.show();
        this._tg.MainButton.onClick(callback);
    }

    /**
     * Hide the main button
     */
    hideMainButton() {
        if (!this._tg?.MainButton) return;
        this._tg.MainButton.hide();
    }

    /**
     * Show back button
     * @param {Function} callback
     */
    showBackButton(callback) {
        if (!this._tg?.BackButton) return;
        if (this._backButtonCallback) {
            this._tg.BackButton.offClick(this._backButtonCallback);
        }
        this._backButtonCallback = callback;
        this._tg.BackButton.show();
        this._tg.BackButton.onClick(callback);
    }

    /**
     * Hide back button
     */
    hideBackButton() {
        if (!this._tg?.BackButton) return;
        if (this._backButtonCallback) {
            this._tg.BackButton.offClick(this._backButtonCallback);
            this._backButtonCallback = null;
        }
        this._tg.BackButton.hide();
    }

    /**
     * Haptic feedback
     * @param {'light'|'medium'|'heavy'|'rigid'|'soft'} style
     */
    hapticImpact(style = 'medium') {
        this._tg?.HapticFeedback?.impactOccurred?.(style);
    }

    /**
     * Haptic notification
     * @param {'error'|'success'|'warning'} type
     */
    hapticNotification(type = 'success') {
        this._tg?.HapticFeedback?.notificationOccurred?.(type);
    }

    /**
     * Haptic selection changed
     */
    hapticSelection() {
        this._tg?.HapticFeedback?.selectionChanged?.();
    }

    /**
     * Show popup
     * @param {Object} params
     * @returns {Promise<string>}
     */
    showPopup({ title, message, buttons }) {
        return new Promise((resolve) => {
            if (!this._tg?.showPopup) {
                // Fallback to native confirm
                const result = window.confirm(`${title}\n\n${message}`);
                resolve(result ? 'confirm' : 'cancel');
                return;
            }

            this._tg.showPopup(
                {
                    title,
                    message,
                    buttons: buttons || [
                        { id: 'cancel', type: 'cancel' },
                        { id: 'confirm', type: 'destructive', text: 'Confirm' },
                    ],
                },
                (buttonId) => resolve(buttonId),
            );
        });
    }

    /**
     * Show alert
     * @param {string} message
     * @returns {Promise}
     */
    showAlert(message) {
        return new Promise((resolve) => {
            if (this._tg?.showAlert) {
                this._tg.showAlert(message, resolve);
            } else {
                window.alert(message);
                resolve();
            }
        });
    }

    /**
     * Close the mini app
     */
    close() {
        this._tg?.close?.();
    }

    /**
     * Send data to Telegram bot
     * @param {*} data
     */
    sendData(data) {
        this._tg?.sendData?.(JSON.stringify(data));
    }

    /**
     * Open external link
     * @param {string} url
     */
    openLink(url) {
        if (this._tg?.openLink) {
            this._tg.openLink(url);
        } else {
            window.open(url, '_blank');
        }
    }

    /**
     * Safe method call wrapper
     */
    _safeCall(method, ...args) {
        try {
            if (typeof this._tg[method] === 'function') {
                this._tg[method](...args);
            }
        } catch (err) {
            console.warn(`[Telegram] Failed to call ${method}:`, err);
        }
    }
}

export const telegramService = new TelegramService();
export default telegramService;
