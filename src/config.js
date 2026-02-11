/* =====================================================
   Bridge Configuration — Multi-Chain Centralized Config
   ===================================================== */

export const CONFIG = {
    // App metadata
    APP_NAME: 'XMR Bridge',
    APP_VERSION: '3.0.0',

    // Bridge parameters
    BRIDGE_FEE_PERCENT: 0.003,        // 0.3%
    FAST_LANE_FEE: 0.001,            // +0.1% for priority
    SLIPPAGE_OPTIONS: [0.5, 1.0, 2.0], // %
    DEFAULT_SLIPPAGE: 1.0,             // %
    RATE_REFRESH_INTERVAL: 8000,       // ms
    RATE_STALE_THRESHOLD: 30000,       // ms — warn if rate is older

    // Chain configs — XMR is always one side
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
            addressRegex: /^[48][1-9A-HJ-NP-Za-km-z]{94}$/,
            addressLength: 95,
            color: '#FF6600',
            priority: 0,
        },
        BTC: {
            id: 'btc',
            name: 'Bitcoin',
            symbol: 'BTC',
            icon: '/bitcoin.svg',
            decimals: 8,
            confirmations: 3,
            avgBlockTime: 600,
            explorerUrl: 'https://mempool.space/tx/',
            addressRegex: /^(bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
            addressLength: 34,
            color: '#F7931A',
            priority: 0,
        },
        ETH: {
            id: 'eth',
            name: 'Ethereum',
            symbol: 'ETH',
            icon: '/ethereum.svg',
            decimals: 18,
            confirmations: 12,
            avgBlockTime: 12,
            explorerUrl: 'https://etherscan.io/tx/',
            addressRegex: /^0x[a-fA-F0-9]{40}$/,
            addressLength: 42,
            color: '#627EEA',
            priority: 0,
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
            priority: 0,
        },
        SOL: {
            id: 'sol',
            name: 'Solana',
            symbol: 'SOL',
            icon: '/solana.svg',
            decimals: 9,
            confirmations: 1,
            avgBlockTime: 0.4,
            explorerUrl: 'https://solscan.io/tx/',
            addressRegex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
            addressLength: 44,
            color: '#9945FF',
            priority: 1,
        },
        ARB: {
            id: 'arb',
            name: 'Arbitrum',
            symbol: 'ETH',
            icon: '/arbitrum.svg',
            decimals: 18,
            confirmations: 1,
            avgBlockTime: 0.25,
            explorerUrl: 'https://arbiscan.io/tx/',
            addressRegex: /^0x[a-fA-F0-9]{40}$/,
            addressLength: 42,
            color: '#28A0F0',
            priority: 1,
        },
        BASE: {
            id: 'base',
            name: 'Base',
            symbol: 'ETH',
            icon: '/base.svg',
            decimals: 18,
            confirmations: 1,
            avgBlockTime: 2,
            explorerUrl: 'https://basescan.org/tx/',
            addressRegex: /^0x[a-fA-F0-9]{40}$/,
            addressLength: 42,
            color: '#0052FF',
            priority: 1,
        },
        // Stablecoin targets (routed via EVM chains)
        USDC: {
            id: 'usdc',
            name: 'USDC',
            symbol: 'USDC',
            icon: '/usdc.svg',
            decimals: 6,
            confirmations: 1,
            avgBlockTime: 0.25,
            explorerUrl: 'https://arbiscan.io/tx/',
            addressRegex: /^0x[a-fA-F0-9]{40}$/,
            addressLength: 42,
            color: '#2775CA',
            isToken: true,
            defaultChain: 'ARB',
            priority: 0,
        },
        USDT: {
            id: 'usdt',
            name: 'USDT',
            symbol: 'USDT',
            icon: '/usdt.svg',
            decimals: 6,
            confirmations: 1,
            avgBlockTime: 0.25,
            explorerUrl: 'https://arbiscan.io/tx/',
            addressRegex: /^0x[a-fA-F0-9]{40}$/,
            addressLength: 42,
            color: '#26A17B',
            isToken: true,
            defaultChain: 'ARB',
            priority: 0,
        },
    },

    // Bridge directions — XMR ↔ everything
    DIRECTIONS: {
        'xmr-btc': { from: 'XMR', to: 'BTC', minAmount: 0.01, maxAmount: 100, estimatedTime: 25 * 60, networkFeeLabel: '~0.0001 XMR' },
        'btc-xmr': { from: 'BTC', to: 'XMR', minAmount: 0.0005, maxAmount: 5, estimatedTime: 30 * 60, networkFeeLabel: '~0.00005 BTC' },
        'xmr-eth': { from: 'XMR', to: 'ETH', minAmount: 0.01, maxAmount: 100, estimatedTime: 15 * 60, networkFeeLabel: '~0.0001 XMR' },
        'eth-xmr': { from: 'ETH', to: 'XMR', minAmount: 0.005, maxAmount: 50, estimatedTime: 15 * 60, networkFeeLabel: '~0.001 ETH' },
        'xmr-ton': { from: 'XMR', to: 'TON', minAmount: 0.01, maxAmount: 100, estimatedTime: 15 * 60, networkFeeLabel: '~0.0001 XMR' },
        'ton-xmr': { from: 'TON', to: 'XMR', minAmount: 0.5, maxAmount: 5000, estimatedTime: 25 * 60, networkFeeLabel: '~0.05 TON' },
        'xmr-sol': { from: 'XMR', to: 'SOL', minAmount: 0.01, maxAmount: 100, estimatedTime: 15 * 60, networkFeeLabel: '~0.0001 XMR' },
        'sol-xmr': { from: 'SOL', to: 'XMR', minAmount: 0.1, maxAmount: 2000, estimatedTime: 25 * 60, networkFeeLabel: '~0.001 SOL' },
        'xmr-arb': { from: 'XMR', to: 'ARB', minAmount: 0.01, maxAmount: 100, estimatedTime: 10 * 60, networkFeeLabel: '~0.0001 XMR' },
        'arb-xmr': { from: 'ARB', to: 'XMR', minAmount: 0.005, maxAmount: 50, estimatedTime: 25 * 60, networkFeeLabel: '~0.0001 ETH' },
        'xmr-base': { from: 'XMR', to: 'BASE', minAmount: 0.01, maxAmount: 100, estimatedTime: 10 * 60, networkFeeLabel: '~0.0001 XMR' },
        'base-xmr': { from: 'BASE', to: 'XMR', minAmount: 0.005, maxAmount: 50, estimatedTime: 25 * 60, networkFeeLabel: '~0.0001 ETH' },
        'xmr-usdc': { from: 'XMR', to: 'USDC', minAmount: 0.01, maxAmount: 100, estimatedTime: 10 * 60, networkFeeLabel: '~0.0001 XMR' },
        'usdc-xmr': { from: 'USDC', to: 'XMR', minAmount: 1, maxAmount: 50000, estimatedTime: 25 * 60, networkFeeLabel: '~0.50 USDC' },
        'xmr-usdt': { from: 'XMR', to: 'USDT', minAmount: 0.01, maxAmount: 100, estimatedTime: 10 * 60, networkFeeLabel: '~0.0001 XMR' },
        'usdt-xmr': { from: 'USDT', to: 'XMR', minAmount: 1, maxAmount: 50000, estimatedTime: 25 * 60, networkFeeLabel: '~0.50 USDT' },
    },

    // Destination chain options (what XMR can bridge TO)
    DEST_CHAINS: ['BTC', 'ETH', 'TON', 'SOL', 'ARB', 'BASE', 'USDC', 'USDT'],

    // UI constants
    UI: {
        MAX_HISTORY: 50,
        TOAST_DURATION: 3000,
        ANIMATION_DURATION: 300,
        DEBOUNCE_MS: 300,
        MAX_DECIMAL_DISPLAY: 6,
    },

    // API endpoints
    API: {
        BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
        ENDPOINTS: {
            RATE: '/v1/rate',
            ORDER: '/v1/order',
            STATUS: '/v1/order/:id/status',
            HISTORY: '/v1/orders',
            CHAINS: '/v1/chains',
        },
        TIMEOUT: 15000,
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000,
    },

    // WebSocket config
    WS: {
        BASE_URL: import.meta.env.VITE_WS_URL || 'ws://localhost:8000',
    },

    // Storage keys
    STORAGE: {
        HISTORY: 'xmr_bridge_history_v3',
        SETTINGS: 'xmr_bridge_settings',
        LAST_DIRECTION: 'xmr_bridge_direction',
    },
};

export default CONFIG;
