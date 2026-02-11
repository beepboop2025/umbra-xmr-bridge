/* =====================================================
   Bridge Configuration — Centralized Config Module
   ===================================================== */

import type { AppConfig } from './types.ts';

export const CONFIG: AppConfig = {
    // App metadata
    APP_NAME: 'XMR ↔ TON Bridge',
    APP_VERSION: '2.0.0',

    // Bridge parameters
    BRIDGE_FEE_PERCENT: 0.003,        // 0.3%
    SLIPPAGE_OPTIONS: [0.5, 1.0, 2.0], // %
    DEFAULT_SLIPPAGE: 1.0,             // %
    RATE_REFRESH_INTERVAL: 8000,       // ms
    RATE_STALE_THRESHOLD: 30000,       // ms — warn if rate is older

    // Chain configs
    CHAINS: {
        XMR: {
            id: 'xmr',
            name: 'Monero',
            symbol: 'XMR',
            icon: '/monero.svg',
            decimals: 12,
            confirmations: 10,
            avgBlockTime: 120,
            explorerUrl: 'https://xmrchain.net/tx/',
            addressRegex: /^[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93,}$/,
            addressLength: 95,
            color: '#FF6600',
        },
        TON: {
            id: 'ton',
            name: 'TON',
            symbol: 'TON',
            icon: '/ton.svg',
            decimals: 9,
            confirmations: 1,
            avgBlockTime: 5,
            explorerUrl: 'https://tonviewer.com/transaction/',
            addressRegex: /^(EQ|UQ|0:)[A-Za-z0-9_-]{46,48}$/,
            addressLength: 48,
            color: '#0098EA',
        },
    },

    // Bridge directions
    DIRECTIONS: {
        'xmr-ton': {
            from: 'XMR',
            to: 'TON',
            minAmount: 0.01,
            maxAmount: 100,
            estimatedTime: 15 * 60,
            networkFeeLabel: '~0.0001 XMR',
        },
        'ton-xmr': {
            from: 'TON',
            to: 'XMR',
            minAmount: 0.5,
            maxAmount: 5000,
            estimatedTime: 25 * 60,
            networkFeeLabel: '~0.05 TON',
        },
    },

    // UI constants
    UI: {
        MAX_HISTORY: 50,
        TOAST_DURATION: 3000,
        ANIMATION_DURATION: 300,
        DEBOUNCE_MS: 300,
        MAX_DECIMAL_DISPLAY: 6,
    },

    // API endpoints (for future backend integration)
    API: {
        BASE_URL: (import.meta as any).env?.VITE_API_URL || 'https://api.xmr-ton-bridge.io',
        ENDPOINTS: {
            RATE: '/v1/rate',
            ORDER: '/v1/order',
            STATUS: '/v1/order/:id/status',
            HISTORY: '/v1/orders',
        },
        TIMEOUT: 15000,
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000,
    },

    // Storage keys
    STORAGE: {
        HISTORY: 'xmr_ton_bridge_history_v2',
        SETTINGS: 'xmr_ton_bridge_settings',
        LAST_DIRECTION: 'xmr_ton_bridge_direction',
    },
};

export default CONFIG;
