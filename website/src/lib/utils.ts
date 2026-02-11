import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return (Number(value) || 0).toFixed(decimals);
}

export function formatCurrency(value: number, currency = 'USD'): string {
  if (!Number.isFinite(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCrypto(value: number, symbol: string, decimals = 8): string {
  if (!Number.isFinite(value)) return `0 ${symbol}`;
  return `${(Number(value) || 0).toFixed(decimals)} ${symbol}`;
}

export function formatTime(timestamp: number | string | Date): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Invalid date';
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function formatDate(timestamp: number | string | Date): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function truncateAddress(address: string, start = 6, end = 4): string {
  if (!address) return '';
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

export function truncateHash(hash: string, length = 8): string {
  if (!hash) return '';
  if (hash.length <= length * 2 + 3) return hash;
  return `${hash.slice(0, length)}...${hash.slice(-length)}`;
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  return Promise.resolve();
}

export function getExplorerUrl(chain: string, txHash: string): string {
  const explorers: Record<string, string> = {
    XMR: `https://xmrchain.net/tx/${txHash}`,
    BTC: `https://mempool.space/tx/${txHash}`,
    ETH: `https://etherscan.io/tx/${txHash}`,
    TON: `https://tonviewer.com/transaction/${txHash}`,
    SOL: `https://solscan.io/tx/${txHash}`,
    ARB: `https://arbiscan.io/tx/${txHash}`,
    BASE: `https://basescan.org/tx/${txHash}`,
    USDC: `https://etherscan.io/tx/${txHash}`,
    USDT: `https://etherscan.io/tx/${txHash}`,
  };
  return explorers[chain] || `#`;
}

export function generateOrderId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
  };
  return debounced as T & { cancel: () => void };
}
