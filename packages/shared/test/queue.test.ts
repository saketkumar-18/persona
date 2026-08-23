import { describe, expect, it } from 'vitest';
import { FifoQueue, MatchQueue } from '../src/queue';

describe('FifoQueue', () => {
  it('preserves FIFO order', () => {
    const q = new FifoQueue<string>();
    q.push('a', 'k1');
    q.push('b', 'k2');
    q.push('c', 'k3');
    expect(q.take()?.value).toBe('a');
    expect(q.take()?.value).toBe('b');
    expect(q.size).toBe(1);
  });

  it('removes by key', () => {
    const q = new FifoQueue<string>();
    q.push('a', 'k1');
    q.push('b', 'k2');
    expect(q.remove('k1')).toBe(true);
    expect(q.remove('nope')).toBe(false);
    expect(q.take()?.value).toBe('b');
  });
});

describe('MatchQueue', () => {
  it('takeCompatible returns an oldest compatible partner', () => {
    const q = new MatchQueue<{ id: string }>();
    q.push({ id: 'p1' }, 'p1');
    q.push({ id: 'p2' }, 'p2');

    const entry = q.takeCompatible({ id: 'me' });
    expect(entry?.value.id).toBe('p1');
  });

  it('skips partners I blocked', () => {
    const q = new MatchQueue<{ id: string }>();
    q.push({ id: 'blocked-person' }, 'e1');
    q.push({ id: 'ok-person' }, 'e2');
    q.block('me', 'blocked-person');

    const entry = q.takeCompatible({ id: 'me' });
    expect(entry?.value.id).toBe('ok-person');
  });

  it('never returns myself', () => {
    const q = new MatchQueue<{ id: string }>();
    q.push({ id: 'me' }, 'e1');
    expect(q.takeCompatible({ id: 'me' })).toBeUndefined();
  });

  it('blockPair mutates both directions', () => {
    const q = new MatchQueue<{ id: string }>();
    q.blockPair('a', 'b');
    expect(q.isBlocked('a', 'b')).toBe(true);
    expect(q.isBlocked('b', 'a')).toBe(true);
  });

  it('takeExpired surfaces stale entries only past maxWaitMs', () => {
    let now = 1_000;
    const q = new MatchQueue<{ id: string }>(() => now);
    q.push({ id: 'old' }, 'e1');
    expect(q.takeExpired(500)).toBeUndefined();
    now = 2_000;
    expect(q.takeExpired(500)?.value.id).toBe('old');
  });
});
