/* =====================================================
   Utility Functions
   ===================================================== */

/**
 * Sleep with abort support
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise}
 */
export function sleep(ms, signal) {
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
 * @param {string} prefix
 * @returns {string}
 */
export function generateId(prefix = 'id') {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const random = Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
    const time = Date.now().toString(36).slice(-4);
    return `${prefix}_${random}${time}`;
}

/**
 * Generate a mock blockchain address
 * @param {string} direction
 * @returns {string}
 */
export function generateMockAddress(direction) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const random = (len) => {
        const bytes = new Uint8Array(len);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, b => chars[b % chars.length]).join('');
    };

    if (direction === 'xmr-ton') {
        return '4' + random(94);
    }
    return 'EQ' + random(46);
}

/**
 * Debounce function
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
export function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

/**
 * Throttle function
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
export function throttle(fn, ms) {
    let lastCall = 0;
    return function (...args) {
        const now = Date.now();
        if (now - lastCall >= ms) {
            lastCall = now;
            fn.apply(this, args);
        }
    };
}

/**
 * Format time in seconds to human readable
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
    return `~${(seconds / 3600).toFixed(1)} hr`;
}

/**
 * Format time ago from timestamp
 * @param {number} timestamp
 * @returns {string}
 */
export function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

/**
 * Format number with smart decimal places
 * @param {number} num
 * @param {number} maxDecimals
 * @returns {string}
 */
export function formatNumber(num, maxDecimals = 6) {
    if (!num && num !== 0) return '—';
    const n = parseFloat(num);
    if (isNaN(n)) return '—';

    // Use fewer decimals for large numbers
    if (Math.abs(n) >= 1000) return n.toFixed(2);
    if (Math.abs(n) >= 1) return n.toFixed(4);
    return n.toFixed(maxDecimals);
}

/**
 * Truncate address for display
 * @param {string} addr
 * @param {number} startChars
 * @param {number} endChars
 * @returns {string}
 */
export function truncateAddress(addr, startChars = 8, endChars = 6) {
    if (!addr || addr.length <= startChars + endChars + 3) return addr;
    return `${addr.slice(0, startChars)}...${addr.slice(-endChars)}`;
}

/**
 * Copy text to clipboard with fallback
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
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
 * @param {string} str
 * @returns {string}
 */
export function sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Create DOM element with attributes / children
 * @param {string} tag
 * @param {Object} attrs
 * @param  {...(string|Node)} children
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs = {}, ...children) {
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
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} data
 * @param {string} color
 */
export function drawSparkline(canvas, data, color = '#FF6600') {
    if (!canvas || !data || data.length < 2) return;

    const ctx = canvas.getContext('2d');
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
    const lastX = w;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + '30');
    gradient.addColorStop(1, color + '00');

    ctx.lineTo(lastX, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
}
