import { describe, it, expect, afterEach } from 'vitest';
import { rateService } from '../src/services/RateService.js';
import CONFIG from '../src/config.js';

// rateService is the real shipped singleton. We stop its polling timer (started
// elsewhere only via startPolling) is irrelevant here — the constructor does not
// auto-start polling, so calculateConversion is fully deterministic against the
// seeded base rate of 52.35 (xmr-ton) and its reciprocal (ton-xmr).

afterEach(() => rateService.stopPolling());

const FEE = CONFIG.BRIDGE_FEE_PERCENT; // 0.003
const DP = CONFIG.UI.MAX_DECIMAL_DISPLAY; // 6
const round = (n) => parseFloat(n.toFixed(DP));

describe('RateService.calculateConversion', () => {
  it('applies the bridge fee before converting at the rate', () => {
    const amount = 10;
    const rate = rateService.getRate('xmr-ton');
    const c = rateService.calculateConversion(amount, 'xmr-ton', 1.0);

    const expectedFee = round(amount * FEE);
    const expectedToAmount = round((amount - amount * FEE) * rate);

    expect(c.fee).toBe(expectedFee);
    expect(c.toAmount).toBe(expectedToAmount);
  });

  it('computes minReceived by applying the slippage factor to toAmount', () => {
    const c = rateService.calculateConversion(10, 'xmr-ton', 2.0);
    // minReceived = toAmount * (1 - slippage/100); allow rounding tolerance
    expect(c.minReceived).toBeCloseTo(c.toAmount * 0.98, 4);
    expect(c.minReceived).toBeLessThan(c.toAmount);
  });

  it('tighter slippage yields a higher guaranteed minReceived', () => {
    const tight = rateService.calculateConversion(10, 'xmr-ton', 0.5);
    const loose = rateService.calculateConversion(10, 'xmr-ton', 2.0);
    expect(tight.minReceived).toBeGreaterThan(loose.minReceived);
    // toAmount itself is slippage-independent
    expect(tight.toAmount).toBe(loose.toAmount);
  });

  it('effectiveRate reflects the fee drag (below the raw rate)', () => {
    const rawRate = rateService.getRate('xmr-ton');
    const c = rateService.calculateConversion(10, 'xmr-ton', 1.0);
    expect(c.effectiveRate).toBeLessThan(rawRate);
    // effective rate ~= rawRate * (1 - fee)
    expect(c.effectiveRate).toBeCloseTo(rawRate * (1 - FEE), 3);
  });

  it('reverse direction uses the reciprocal rate', () => {
    const fwd = rateService.getRate('xmr-ton');
    const rev = rateService.getRate('ton-xmr');
    expect(rev).toBeCloseTo(1 / fwd, 6);
  });

  it('returns an all-zero quote for non-positive amounts', () => {
    for (const bad of [0, -5, NaN]) {
      const c = rateService.calculateConversion(bad, 'xmr-ton', 1.0);
      expect(c).toEqual({ toAmount: 0, fee: 0, minReceived: 0, effectiveRate: 0 });
    }
  });

  it('returns an all-zero quote for an unknown direction', () => {
    const c = rateService.calculateConversion(10, 'doge-xmr', 1.0);
    expect(c).toEqual({ toAmount: 0, fee: 0, minReceived: 0, effectiveRate: 0 });
  });

  it('defaults slippage to CONFIG.DEFAULT_SLIPPAGE when omitted', () => {
    const explicit = rateService.calculateConversion(10, 'xmr-ton', CONFIG.DEFAULT_SLIPPAGE);
    const implicit = rateService.calculateConversion(10, 'xmr-ton');
    expect(implicit.minReceived).toBe(explicit.minReceived);
  });

  it('getRateInfo reports freshness and online flags', () => {
    const info = rateService.getRateInfo();
    expect(info.rates['xmr-ton']).toBeGreaterThan(0);
    expect(typeof info.isStale).toBe('boolean');
    expect(typeof info.isOnline).toBe('boolean');
    expect(info.age).toBeGreaterThanOrEqual(0);
  });

  it('getPriceHistory returns a defensive copy (mutation-safe)', () => {
    const a = rateService.getPriceHistory();
    a.push(999);
    expect(rateService.getPriceHistory()).not.toContain(999);
  });
});
