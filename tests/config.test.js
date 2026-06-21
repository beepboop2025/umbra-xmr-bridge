import { describe, it, expect } from 'vitest';
import CONFIG from '../src/config.js';

const test = (chain, addr) => CONFIG.CHAINS[chain].addressRegex.test(addr);

describe('CONFIG chain address regexes', () => {
  it('accepts a canonical Monero address and rejects malformed ones', () => {
    const valid = '4' + 'A'.repeat(94); // [48] + 94 base58-ish chars
    expect(test('XMR', valid)).toBe(true);
    expect(test('XMR', '5' + 'A'.repeat(94))).toBe(false); // bad prefix
    expect(test('XMR', '4' + 'A'.repeat(50))).toBe(false); // too short
    expect(test('XMR', '40' + 'A'.repeat(93))).toBe(false); // contains 0 (not base58)
  });

  it('accepts EVM (ETH/ARB/BASE/USDC/USDT) 0x-prefixed 40-hex addresses', () => {
    const good = '0x' + 'aF09'.repeat(10); // 40 hex chars
    for (const c of ['ETH', 'ARB', 'BASE', 'USDC', 'USDT']) {
      expect(test(c, good)).toBe(true);
    }
    expect(test('ETH', '0x' + 'a'.repeat(39))).toBe(false); // 39 chars
    expect(test('ETH', '0x' + 'g'.repeat(40))).toBe(false); // non-hex
    expect(test('ETH', 'a'.repeat(40))).toBe(false); // missing 0x
  });

  it('accepts Bitcoin bech32 and legacy formats, rejects junk', () => {
    expect(test('BTC', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
    expect(test('BTC', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true); // legacy P2PKH
    expect(test('BTC', '0x' + 'a'.repeat(40))).toBe(false);
    expect(test('BTC', 'bc1' + 'l'.repeat(1))).toBe(false); // too short
  });

  it('accepts TON EQ/UQ/0: prefixed addresses', () => {
    expect(test('TON', 'EQ' + 'A'.repeat(46))).toBe(true);
    expect(test('TON', 'UQ' + 'B'.repeat(46))).toBe(true);
    expect(test('TON', 'XX' + 'B'.repeat(46))).toBe(false); // bad prefix
  });

  it('accepts a Solana base58 address within the 32-44 length window', () => {
    expect(test('SOL', '1'.repeat(44))).toBe(true);
    expect(test('SOL', '1'.repeat(31))).toBe(false); // too short
    expect(test('SOL', '0' + '1'.repeat(43))).toBe(false); // 0 not in base58 alphabet
  });
});

describe('CONFIG direction invariants', () => {
  it('every direction names chains that exist in CONFIG.CHAINS', () => {
    for (const [id, d] of Object.entries(CONFIG.DIRECTIONS)) {
      expect(CONFIG.CHAINS[d.from], `from of ${id}`).toBeDefined();
      expect(CONFIG.CHAINS[d.to], `to of ${id}`).toBeDefined();
    }
  });

  it('every direction has min < max and positive bounds', () => {
    for (const [id, d] of Object.entries(CONFIG.DIRECTIONS)) {
      expect(d.minAmount, `${id} min`).toBeGreaterThan(0);
      expect(d.maxAmount, `${id} max`).toBeGreaterThan(d.minAmount);
      expect(d.estimatedTime, `${id} time`).toBeGreaterThan(0);
    }
  });

  it('XMR is exactly one side of every supported direction', () => {
    for (const [id, d] of Object.entries(CONFIG.DIRECTIONS)) {
      const involvesXmr = d.from === 'XMR' || d.to === 'XMR';
      expect(involvesXmr, `${id} should involve XMR`).toBe(true);
    }
  });

  it('every DEST_CHAINS entry has a matching xmr-> direction and chain config', () => {
    for (const dest of CONFIG.DEST_CHAINS) {
      expect(CONFIG.CHAINS[dest], `chain ${dest}`).toBeDefined();
      expect(CONFIG.DIRECTIONS[`xmr-${dest.toLowerCase()}`], `xmr-${dest.toLowerCase()}`).toBeDefined();
    }
  });

  it('exposes sane global bridge economics', () => {
    expect(CONFIG.BRIDGE_FEE_PERCENT).toBeGreaterThan(0);
    expect(CONFIG.BRIDGE_FEE_PERCENT).toBeLessThan(0.05); // < 5%
    expect(CONFIG.SLIPPAGE_OPTIONS).toContain(CONFIG.DEFAULT_SLIPPAGE);
    expect(CONFIG.UI.MAX_DECIMAL_DISPLAY).toBeGreaterThan(0);
  });
});
