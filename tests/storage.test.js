import { describe, it, expect, beforeEach, vi } from 'vitest';
import { storageService } from '../src/services/StorageService.js';
import CONFIG from '../src/config.js';

const item = (id, over = {}) => ({
  id,
  direction: 'xmr-ton',
  fromAmount: 1,
  fromCurrency: 'XMR',
  toAmount: 52,
  toCurrency: 'TON',
  status: 'pending',
  createdAt: Date.now(),
  ...over,
});

describe('StorageService', () => {
  beforeEach(() => {
    localStorage.clear();
    storageService.clearAll(); // also drops the in-memory cache
  });

  describe('get/set', () => {
    it('round-trips a value through localStorage as JSON', () => {
      storageService.set('k', { a: 1, b: [2, 3] });
      expect(localStorage.getItem('k')).toBe(JSON.stringify({ a: 1, b: [2, 3] }));
      expect(storageService.get('k', null)).toEqual({ a: 1, b: [2, 3] });
    });

    it('returns the fallback for a missing key', () => {
      expect(storageService.get('missing', 'FALLBACK')).toBe('FALLBACK');
    });

    it('returns the fallback (not a throw) when stored JSON is corrupt', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorage.setItem('bad', '{not valid json');
      expect(storageService.get('bad', 'safe')).toBe('safe');
      warn.mockRestore();
    });

    it('serves repeat reads from the in-memory cache even if storage changes underneath', () => {
      storageService.set('c', 'v1');
      expect(storageService.get('c', null)).toBe('v1');
      // mutate raw storage behind the cache's back
      localStorage.setItem('c', JSON.stringify('v2'));
      expect(storageService.get('c', null)).toBe('v1'); // cache wins
    });

    it('remove() drops the key from both storage and cache', () => {
      storageService.set('c', 'v');
      storageService.remove('c');
      expect(localStorage.getItem('c')).toBeNull();
      expect(storageService.get('c', 'fb')).toBe('fb');
    });
  });

  describe('history', () => {
    it('prepends new transactions (newest first)', () => {
      storageService.addToHistory(item('a'));
      const h = storageService.addToHistory(item('b'));
      expect(h.map((x) => x.id)).toEqual(['b', 'a']);
    });

    it('caps history at CONFIG.UI.MAX_HISTORY entries', () => {
      for (let i = 0; i < CONFIG.UI.MAX_HISTORY + 10; i++) {
        storageService.addToHistory(item('t' + i));
      }
      const h = storageService.getHistory();
      expect(h.length).toBe(CONFIG.UI.MAX_HISTORY);
      // the most recent insert must survive at the head
      expect(h[0].id).toBe('t' + (CONFIG.UI.MAX_HISTORY + 9));
    });

    it('updateHistoryItem patches a matching record in place', () => {
      storageService.addToHistory(item('a', { status: 'pending' }));
      storageService.updateHistoryItem('a', { status: 'completed', error: undefined });
      const found = storageService.getHistory().find((x) => x.id === 'a');
      expect(found.status).toBe('completed');
    });

    it('updateHistoryItem is a no-op for an unknown id', () => {
      storageService.addToHistory(item('a'));
      const before = storageService.getHistory();
      storageService.updateHistoryItem('does-not-exist', { status: 'completed' });
      expect(storageService.getHistory()).toEqual(before);
    });
  });

  describe('settings', () => {
    it('returns defaults derived from CONFIG when nothing is stored', () => {
      const s = storageService.getSettings();
      expect(s.slippage).toBe(CONFIG.DEFAULT_SLIPPAGE);
      expect(s.notifications).toBe(true);
    });

    it('saveSettings does a partial merge over existing settings', () => {
      storageService.saveSettings({ slippage: 2.0 });
      const merged = storageService.saveSettings({ notifications: false });
      expect(merged.slippage).toBe(2.0); // preserved from first save
      expect(merged.notifications).toBe(false);
    });
  });

  describe('quota handling', () => {
    it('on QuotaExceededError it prunes history then retries the write successfully', () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      // seed >10 history entries so _pruneOldData has something to trim
      for (let i = 0; i < 25; i++) storageService.addToHistory(item('q' + i));
      const fullPayload = storageService.getHistory();

      const real = Storage.prototype.setItem;
      let throwOnce = true;
      const writes = [];
      const spy = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(function (k, v) {
          if (throwOnce) {
            throwOnce = false;
            const e = new Error('full');
            e.name = 'QuotaExceededError';
            throw e;
          }
          writes.push(JSON.parse(v).length);
          return real.call(this, k, v);
        });

      // triggers: throw -> catch -> _pruneOldData (writes 10) -> retry (writes 25)
      storageService.set(CONFIG.STORAGE.HISTORY, fullPayload);

      // the recovery path must have written the pruned snapshot (10) AND
      // then retried the original full payload (25) — proving prune+retry ran.
      expect(writes).toContain(10); // _pruneOldData snapshot
      expect(writes).toContain(25); // successful retry of original value
      expect(storageService.getHistory().length).toBe(25);

      spy.mockRestore();
      err.mockRestore();
    });
  });

  it('clearAll wipes every known storage key', () => {
    storageService.set(CONFIG.STORAGE.HISTORY, [item('a')]);
    storageService.set(CONFIG.STORAGE.SETTINGS, { slippage: 2 });
    storageService.clearAll();
    expect(localStorage.getItem(CONFIG.STORAGE.HISTORY)).toBeNull();
    expect(localStorage.getItem(CONFIG.STORAGE.SETTINGS)).toBeNull();
  });
});
