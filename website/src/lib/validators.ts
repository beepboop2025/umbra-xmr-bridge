import { CHAINS, type Chain } from './chains';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateAddress(chainId: string, address: string): ValidationResult {
  if (!address || address.trim().length === 0) {
    return { valid: false, error: 'Address is required' };
  }

  const chain = CHAINS[chainId];
  if (!chain) {
    return { valid: false, error: `Unknown chain: ${chainId}` };
  }

  const trimmed = address.trim();

  if (!chain.addressRegex.test(trimmed)) {
    return { valid: false, error: `Invalid ${chain.name} address format` };
  }

  return { valid: true };
}

export function validateAmount(
  chainId: string,
  amount: string | number
): ValidationResult {
  const chain = CHAINS[chainId];
  if (!chain) {
    return { valid: false, error: `Unknown chain: ${chainId}` };
  }

  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (!Number.isFinite(num) || num <= 0) {
    return { valid: false, error: 'Amount must be a positive number' };
  }

  if (num < chain.minAmount) {
    return { valid: false, error: `Minimum amount is ${chain.minAmount} ${chain.symbol}` };
  }

  if (num > chain.maxAmount) {
    return { valid: false, error: `Maximum amount is ${chain.maxAmount} ${chain.symbol}` };
  }

  return { valid: true };
}

export function validateBridgeRequest(params: {
  sourceChain: string;
  destChain: string;
  amount: string;
  address: string;
}): ValidationResult {
  const { sourceChain, destChain, amount, address } = params;

  if (sourceChain !== 'XMR' && destChain !== 'XMR') {
    return { valid: false, error: 'XMR must be on one side of the bridge' };
  }

  if (sourceChain === destChain) {
    return { valid: false, error: 'Source and destination cannot be the same' };
  }

  const amountResult = validateAmount(sourceChain, amount);
  if (!amountResult.valid) return amountResult;

  const destChainForAddress = destChain;
  const addressResult = validateAddress(destChainForAddress, address);
  if (!addressResult.valid) return addressResult;

  return { valid: true };
}

export function isValidTxHash(chain: string, hash: string): boolean {
  if (!hash) return false;
  switch (chain) {
    case 'XMR':
      return /^[a-fA-F0-9]{64}$/.test(hash);
    case 'BTC':
      return /^[a-fA-F0-9]{64}$/.test(hash);
    case 'ETH':
    case 'ARB':
    case 'BASE':
    case 'USDC':
    case 'USDT':
      return /^0x[a-fA-F0-9]{64}$/.test(hash);
    case 'TON':
      return hash.length >= 40;
    case 'SOL':
      return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(hash);
    default:
      return false;
  }
}
