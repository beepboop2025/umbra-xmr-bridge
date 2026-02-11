/* =====================================================
   Utility Functions
   ===================================================== */

import type { DirectionId } from './types.ts';

/**
 * Sleep with abort support
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            });
        }
    });
}

/**
 * Generate unique ID with prefix
 */
export function generateId(prefix: string = 'id'): string {
    const random = Math.random().toString(36).substring(2, 10);
    const time = Date.now().toString(36).slice(-4);
    return `${prefix}_${random}${time}`;
}

/**
 * Generate a mock blockchain address
 */
export function generateMockAddress(direction: DirectionId): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const random = (len: number): string =>
        Array.from({ length: len }, () =>
            chars[Math.floor(Math.random() * chars.length)]
        ).join('');

    if (direction === 'xmr-ton') {
        return '4' + random(94);
    }
    return 'EQ' + random(46);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    ms: number,
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout>;
    return function (this: any, ...args: Parameters<T>) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    ms: number,
): (...args: Parameters<T>) => void {
    let lastCall = 0;
    return function (this: any, ...args: Parameters<T>) {
        const now = Date.now();
        if (now - lastCall >= ms) {
            lastCall = now;
            fn.apply(this, args);
        }
    };
}

/**
 * Format time in seconds to human readable
 */
export function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
    return `~${(seconds / 3600).toFixed(1)} hr`;
}

/**
 * Format time ago from timestamp
 */
export function timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

/**
 * Format number with smart decimal places
 */
export function formatNumber(num: number | string | undefined | null, maxDecimals: number = 6): string {
    if (num === undefined || num === null) return '—';
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(n)) return '—';

    if (Math.abs(n) >= 1000) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(4);
    return n.toFixed(maxDecimals);
}

/**
 * Truncate address for display
 */
export function truncateAddress(addr: string, startChars: number = 8, endChars: number = 6): string {
    if (!addr || addr.length <= startChars + endChars + 3) return addr;
    return `${addr.slice(0, startChars)}...${addr.slice(-endChars)}`;
}

/**
 * Copy text to clipboard with fallback
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    }
}

/**
 * Sanitize HTML to prevent XSS
 */
export function sanitize(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Create DOM element with attributes / children
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, any> = {},
    ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
        if (key === 'class' || key === 'className') {
            el.className = val;
        } else if (key === 'style' && typeof val === 'object') {
            Object.assign(el.style, val);
        } else if (key.startsWith('on') && typeof val === 'function') {
            el.addEventListener(key.substring(2).toLowerCase(), val);
        } else if (key === 'dataset' && typeof val === 'object') {
            Object.assign(el.dataset, val);
        } else if (key === 'innerHTML') {
            el.innerHTML = val;
        } else {
            el.setAttribute(key, val);
        }
    }
    for (const child of children) {
        if (typeof child === 'string') {
            el.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            el.appendChild(child);
        }
    }
    return el;
}

/**
 * Draw a sparkline on a canvas
 */
export function drawSparkline(canvas: HTMLCanvasElement | null, data: number[], color: string = '#FF6600'): void {
    if (!canvas || !data || data.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;

    ctx.clearRect(0, 0, w, h);

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    data.forEach((val, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((val - min) / range) * (h * 0.8) - h * 0.1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw fill gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + '30');
    gradient.addColorStop(1, color + '00');

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
}
