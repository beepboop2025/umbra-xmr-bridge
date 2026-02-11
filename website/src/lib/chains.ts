export interface Chain {
  id: string;
  name: string;
  symbol: string;
  color: string;
  icon: string;
  decimals: number;
  addressRegex: RegExp;
  addressPlaceholder: string;
  explorerBase: string;
  type: 'native' | 'stablecoin';
  network?: string;
  minAmount: number;
  maxAmount: number;
}

export const CHAINS: Record<string, Chain> = {
  XMR: {
    id: 'XMR',
    name: 'Monero',
    symbol: 'XMR',
    color: '#FF6600',
    icon: '/monero.svg',
    decimals: 12,
    addressRegex: /^[48][1-9A-HJ-NP-Za-km-z]{94}$/,
    addressPlaceholder: '4...',
    explorerBase: 'https://xmrchain.net',
    type: 'native',
    minAmount: 0.01,
    maxAmount: 100,
  },
  BTC: {
    id: 'BTC',
    name: 'Bitcoin',
    symbol: 'BTC',
    color: '#F7931A',
    icon: '',
    decimals: 8,
    addressRegex: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/,
    addressPlaceholder: 'bc1...',
    explorerBase: 'https://mempool.space',
    type: 'native',
    minAmount: 0.0001,
    maxAmount: 10,
  },
  ETH: {
    id: 'ETH',
    name: 'Ethereum',
    symbol: 'ETH',
    color: '#627EEA',
    icon: '',
    decimals: 18,
    addressRegex: /^0x[a-fA-F0-9]{40}$/,
    addressPlaceholder: '0x...',
    explorerBase: 'https://etherscan.io',
    type: 'native',
    minAmount: 0.001,
    maxAmount: 100,
  },
  TON: {
    id: 'TON',
    name: 'TON',
    symbol: 'TON',
    color: '#0098EA',
    icon: '/ton.svg',
    decimals: 9,
    addressRegex: /^(EQ|UQ)[a-zA-Z0-9_-]{46}$/,
    addressPlaceholder: 'EQ...',
    explorerBase: 'https://tonviewer.com',
    type: 'native',
    minAmount: 0.1,
    maxAmount: 10000,
  },
  SOL: {
    id: 'SOL',
    name: 'Solana',
    symbol: 'SOL',
    color: '#9945FF',
    icon: '',
    decimals: 9,
    addressRegex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    addressPlaceholder: 'So...',
    explorerBase: 'https://solscan.io',
    type: 'native',
    minAmount: 0.01,
    maxAmount: 1000,
  },
  ARB: {
    id: 'ARB',
    name: 'Arbitrum',
    symbol: 'ETH',
    color: '#28A0F0',
    icon: '',
    decimals: 18,
    addressRegex: /^0x[a-fA-F0-9]{40}$/,
    addressPlaceholder: '0x...',
    explorerBase: 'https://arbiscan.io',
    type: 'native',
    network: 'Arbitrum One',
    minAmount: 0.001,
    maxAmount: 100,
  },
  BASE: {
    id: 'BASE',
    name: 'Base',
    symbol: 'ETH',
    color: '#0052FF',
    icon: '',
    decimals: 18,
    addressRegex: /^0x[a-fA-F0-9]{40}$/,
    addressPlaceholder: '0x...',
    explorerBase: 'https://basescan.org',
    type: 'native',
    network: 'Base',
    minAmount: 0.001,
    maxAmount: 100,
  },
  USDC: {
    id: 'USDC',
    name: 'USD Coin',
    symbol: 'USDC',
    color: '#2775CA',
    icon: '',
    decimals: 6,
    addressRegex: /^0x[a-fA-F0-9]{40}$/,
    addressPlaceholder: '0x...',
    explorerBase: 'https://etherscan.io',
    type: 'stablecoin',
    network: 'Ethereum',
    minAmount: 1,
    maxAmount: 100000,
  },
  USDT: {
    id: 'USDT',
    name: 'Tether',
    symbol: 'USDT',
    color: '#26A17B',
    icon: '',
    decimals: 6,
    addressRegex: /^0x[a-fA-F0-9]{40}$/,
    addressPlaceholder: '0x...',
    explorerBase: 'https://etherscan.io',
    type: 'stablecoin',
    network: 'Ethereum',
    minAmount: 1,
    maxAmount: 100000,
  },
};

export const SUPPORTED_PAIRS = Object.keys(CHAINS).filter((c) => c !== 'XMR');

export function getChain(id: string): Chain {
  return CHAINS[id] || CHAINS.XMR;
}

export function getChainIcon(id: string): string {
  const chain = CHAINS[id];
  if (!chain) return '';
  return chain.icon;
}

export function getChainColor(id: string): string {
  const chain = CHAINS[id];
  if (!chain) return '#888';
  return chain.color;
}

export const CHAIN_LIST = Object.values(CHAINS);
export const COUNTERPARTY_CHAINS = CHAIN_LIST.filter((c) => c.id !== 'XMR');
