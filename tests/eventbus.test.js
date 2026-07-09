import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBus, EVENTS } from '../src/services/EventBus.js';

describe('EventBus', () => {
  beforeEach(() => eventBus.clear());

  it('delivers emitted payloads to subscribers', () => {
    const cb = vi.fn();
    eventBus.on('x', cb);
    eventBus.emit('x', 1, 'two', { three: 3 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(1, 'two', { three: 3 });
  });

  it('fans out to every subscriber of an event', () => {
    const a = vi.fn();
    const b = vi.fn();
    eventBus.on('e', a);
    eventBus.on('e', b);
    eventBus.emit('e');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('on() returns an unsubscribe function that stops delivery', () => {
    const cb = vi.fn();
    const off = eventBus.on('e', cb);
    off();
    eventBus.emit('e');
    expect(cb).not.toHaveBeenCalled();
  });

  it('off() removes only the targeted listener', () => {
    const a = vi.fn();
    const b = vi.fn();
    eventBus.on('e', a);
    eventBus.on('e', b);
    eventBus.off('e', a);
    eventBus.emit('e');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('dedupes the same callback registered twice (Set semantics)', () => {
    const cb = vi.fn();
    eventBus.on('e', cb);
    eventBus.on('e', cb);
    eventBus.emit('e');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('once() fires exactly one time then auto-unsubscribes', () => {
    const cb = vi.fn();
    eventBus.once('e', cb);
    eventBus.emit('e', 'first');
    eventBus.emit('e', 'second');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('first');
  });

  it('isolates listener errors so siblings still run', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = vi.fn(() => { throw new Error('boom'); });
    const ok = vi.fn();
    eventBus.on('e', boom);
    eventBus.on('e', ok);
    expect(() => eventBus.emit('e')).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('emitting an event with no listeners is a no-op', () => {
    expect(() => eventBus.emit('nobody-home', 42)).not.toThrow();
  });

  it('clear() wipes all subscriptions', () => {
    const cb = vi.fn();
    eventBus.on('a', cb);
    eventBus.on('b', cb);
    eventBus.clear();
    eventBus.emit('a');
    eventBus.emit('b');
    expect(cb).not.toHaveBeenCalled();
  });

  it('exposes a stable, namespaced EVENTS contract', () => {
    expect(EVENTS.ORDER_CREATED).toBe('order:created');
    expect(EVENTS.RATE_UPDATED).toBe('rate:updated');
    expect(EVENTS.NETWORK_STATUS).toBe('network:status');
    // every value should be a non-empty colon-namespaced string
    for (const v of Object.values(EVENTS)) {
      expect(typeof v).toBe('string');
      expect(v).toMatch(/^[a-z]+:[a-z:]+$/);
    }
  });
});
