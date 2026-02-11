/* =====================================================
   Shared Type Definitions
   ===================================================== */

// ---- Chain & Direction ----
export type ChainId = 'XMR' | 'TON';
export type DirectionId = 'xmr-ton' | 'ton-xmr';

export interface ChainConfig {
    id: string;
    name: string;
    symbol: ChainId;
    icon: string;
    decimals: number;
    confirmations: number;
    avgBlockTime: number;
    explorerUrl: string;
    addressRegex: RegExp;
    addressLength: number;
    color: string;
}

export interface DirectionConfig {
    from: ChainId;
    to: ChainId;
    minAmount: number;
    maxAmount: number;
    estimatedTime: number;
    networkFeeLabel: string;
}

// ---- Config ----
export interface AppConfig {
    APP_NAME: string;
    APP_VERSION: string;
    BRIDGE_FEE_PERCENT: number;
    SLIPPAGE_OPTIONS: number[];
    DEFAULT_SLIPPAGE: number;
    RATE_REFRESH_INTERVAL: number;
    RATE_STALE_THRESHOLD: number;
    CHAINS: Record<ChainId, ChainConfig>;
    DIRECTIONS: Record<DirectionId, DirectionConfig>;
    UI: {
        MAX_HISTORY: number;
        TOAST_DURATION: number;
        ANIMATION_DURATION: number;
        DEBOUNCE_MS: number;
        MAX_DECIMAL_DISPLAY: number;
    };
    API: {
        BASE_URL: string;
        ENDPOINTS: {
            RATE: string;
            ORDER: string;
            STATUS: string;
            HISTORY: string;
        };
        TIMEOUT: number;
        RETRY_ATTEMPTS: number;
        RETRY_DELAY: number;
    };
    STORAGE: {
        HISTORY: string;
        SETTINGS: string;
        LAST_DIRECTION: string;
    };
}

// ---- Conversion ----
export interface ConversionResult {
    toAmount: number;
    fee: number;
    minReceived: number;
    effectiveRate: number;
}

// ---- Order ----
export type OrderStatus =
    | 'awaiting_deposit'
    | 'confirming'
    | 'bridging'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'pending';

export interface BridgeOrder {
    id: string;
    direction: DirectionId;
    fromAmount: number;
    fromCurrency: ChainId;
    fromChain: string;
    toAmount: number;
    toCurrency: ChainId;
    toChain: string;
    destAddress: string;
    depositAddress: string;
    rate: number;
    fee: number;
    minReceived: number;
    slippage: number;
    status: OrderStatus;
    step: number;
    totalSteps: number;
    estimatedTime: number;
    createdAt: number;
    updatedAt: number;
    txHashes: Record<string, string>;
    confirmations: { current: number; required: number };
    error?: string;
}

export interface HistoryItem {
    id: string;
    direction: DirectionId;
    fromAmount: number;
    fromCurrency: ChainId | string;
    toAmount: number;
    toCurrency: ChainId | string;
    status: OrderStatus;
    createdAt: number;
    txHashes?: Record<string, string>;
    updatedAt?: number;
    error?: string;
}

// ---- Validation ----
export interface ValidationError {
    field: string;
    message: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

// ---- Settings ----
export interface UserSettings {
    slippage: number;
    lastDirection: DirectionId;
    notifications: boolean;
}

// ---- Display ----
export interface StepInfo {
    title: string;
    desc: string;
    icon: string;
}

export interface OrderDisplayInfo {
    steps: StepInfo[];
    currentStep: number;
    estimatedTimeRemaining: string;
    fromExplorerUrl: string | null;
    toExplorerUrl: string | null;
}

// ---- Rate ----
export interface RateUpdateData {
    rates: Record<DirectionId, number>;
    lastUpdated: number;
    priceHistory: number[];
}

export interface RateInfo {
    rates: Record<DirectionId, number>;
    lastUpdated: number;
    age: number;
    isStale: boolean;
    isOnline: boolean;
}

// ---- Telegram ----
export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}

export interface TelegramTheme {
    colorScheme: string;
    themeParams?: Record<string, string>;
}

export interface PopupParams {
    title: string;
    message: string;
    buttons?: PopupButton[];
}

export interface PopupButton {
    id: string;
    type: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
    text?: string;
}

// ---- Toast ----
export type ToastType = 'info' | 'success' | 'error' | 'warning';

// ---- Event payloads ----
export interface NetworkStatusPayload {
    isOnline: boolean;
}
