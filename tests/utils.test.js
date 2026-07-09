import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sleep,
  generateId,
  generateMockAddress,
  debounce,
  throttle,
  formatTime,
  timeAgo,
  formatNumber,
  truncateAddress,
  sanitize,
} from '../src/utils.js';

describe('formatTime', () => {
  it('renders sub-minute durations in whole seconds, rounding up', () => {
    expect(formatTime(0)).toBe('0s');
    expect(formatTime(1.1)).toBe('2s');
    expect(formatTime(59)).toBe('59s');
  });

  it('switches to minutes at the 60s boundary', () => {
    expect(formatTime(60)).toBe('~1 min');
    expect(formatTime(90)).toBe('~2 min'); // ceil(1.5)
    expect(formatTime(3599)).toBe('~60 min');
  });

  it('switches to hours at the 3600s boundary with one decimal', () => {
    expect(formatTime(3600)).toBe('~1.0 hr');
    expect(formatTime(5400)).toBe('~1.5 hr');
    expect(formatTime(9000)).toBe('~2.5 hr');
  });
});

describe('formatNumber', () => {
  it('returns the em-dash placeholder for nullish / NaN input', () => {
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber('not-a-number')).toBe('—');
  });

  it('uses 2 decimals for magnitudes >= 1000', () => {
    expect(formatNumber(1234.56789)).toBe('1234.57');
    expect(formatNumber(-2000)).toBe('-2000.00');
  });

  it('uses 4 decimals for magnitudes in [1, 1000)', () => {
    expect(formatNumber(52.353535)).toBe('52.3535');
    expect(formatNumber(1)).toBe('1.0000');
  });

  it('uses up to maxDecimals for small magnitudes', () => {
    expect(formatNumber(0.00012345)).toBe('0.000123');
    expect(formatNumber(0.5, 2)).toBe('0.50');
  });

  it('parses numeric strings before formatting', () => {
    expect(formatNumber('52.35')).toBe('52.3500');
  });
});

describe('truncateAddress', () => {
  it('truncates long addresses keeping head and tail', () => {
    const addr = 'EQ' + 'a'.repeat(44) + 'XYZ123';
    const out = truncateAddress(addr);
    expect(out.startsWith(addr.slice(0, 8))).toBe(true);
    expect(out.endsWith(addr.slice(-6))).toBe(true);
    expect(out).toContain('...');
  });

  it('honours custom head/tail lengths', () => {
    const addr = '0x' + 'f'.repeat(40);
    expect(truncateAddress(addr, 4, 4)).toBe('0xff...ffff');
  });

  it('leaves short addresses untouched (no ellipsis added)', () => {
    expect(truncateAddress('short')).toBe('short');
    // exactly at the boundary length: start+end+3
    expect(truncateAddress('a'.repeat(8 + 6 + 3))).toBe('a'.repeat(17));
  });

  it('returns falsy input unchanged', () => {
    expect(truncateAddress('')).toBe('');
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const now = () => Date.now();

  it('says "Just now" within the last minute', () => {
    expect(timeAgo(now() - 30 * 1000)).toBe('Just now');
  });

  it('reports minutes, hours and days at each boundary', () => {
    expect(timeAgo(now() - 5 * 60 * 1000)).toBe('5m ago');
    expect(timeAgo(now() - 3 * 3600 * 1000)).toBe('3h ago');
    expect(timeAgo(now() - 2 * 86400 * 1000)).toBe('2d ago');
  });

  it('falls back to a locale date past one week', () => {
    const out = timeAgo(now() - 10 * 86400 * 1000);
    expect(out).not.toMatch(/ago|Just now/);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('generateId', () => {
  it('prefixes the id and produces unique values', () => {
    const a = generateId('br');
    const b = generateId('br');
    expect(a.startsWith('br_')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('defaults the prefix to "id"', () => {
    expect(generateId().startsWith('id_')).toBe(true);
  });
});

describe('generateMockAddress', () => {
  it('builds a Monero-style 95-char address for xmr-ton', () => {
    const addr = generateMockAddress('xmr-ton');
    expect(addr[0]).toBe('4');
    expect(addr.length).toBe(95);
  });

  it('builds a TON-style EQ-prefixed address otherwise', () => {
    const addr = generateMockAddress('ton-xmr');
    expect(addr.startsWith('EQ')).toBe(true);
    expect(addr.length).toBe(48);
  });
});

describe('sanitize', () => {
  it('escapes HTML special characters to prevent XSS injection', () => {
    const out = sanitize('<script>alert("x")</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('passes through plain text unchanged', () => {
    expect(sanitize('hello world')).toBe('hello world');
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('invokes only once after the trailing delay across rapid calls', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(); d(); d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('forwards the most recent arguments', () => {
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d('a');
    d('b');
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledWith('b');
  });
});

describe('throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs immediately then suppresses calls until the window elapses', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);
    t(); // fires (leading edge)
    t(); // suppressed
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    t(); // window elapsed -> fires again
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('sleep', () => {
  it('rejects with an AbortError when the signal aborts', async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    const p = sleep(1000, ctrl.signal);
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    ctrl.abort();
    await assertion;
    vi.useRealTimers();
  });

  it('resolves after the delay when not aborted', async () => {
    vi.useFakeTimers();
    const p = sleep(500);
    vi.advanceTimersByTime(500);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
