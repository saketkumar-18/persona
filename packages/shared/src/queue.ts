/**
 * FIFO matching queue — a pure in-memory structure used server-side.
 * Kept pure + testable so unit tests can assert on queue behavior without
 * Redis or Nest dependencies.
 */

export interface PendingEntry<E> {
  key: string;
  value: E;
  enqueuedAt: number;
}

export class FifoQueue<E> {
  protected entries: PendingEntry<E>[] = [];

  protected clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }

  get size(): number {
    return this.entries.length;
  }

  push(value: E, key = String(this.entries.length + 1)): PendingEntry<E> {
    const pending: PendingEntry<E> = { key, value, enqueuedAt: this.clock() };
    this.entries.push(pending);
    return pending;
  }

  take(): PendingEntry<E> | undefined {
    return this.entries.shift();
  }

  peek(): PendingEntry<E> | undefined {
    return this.entries[0];
  }

  remove(key: string): boolean {
    const idx = this.entries.findIndex((e) => e.key === key);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  clear(): void {
    this.entries = [];
  }

  toArray(): readonly PendingEntry<E>[] {
    return [...this.entries];
  }
}

/**
 * A queue that skips entries whose key sits in the `blockedKeys` set. Used
 * during matching so a user never pairs with someone they blocked.
 */
export class MatchQueue<E extends { id: string }> extends FifoQueue<E> {
  protected blockedKeys = new Map<string, Set<string>>();

  /** Mark `a` as blocked for `b` (and optionally vice versa). */
  blockPair(a: string, b: string, mutual = true): void {
    this.block(a, b);
    if (mutual) this.block(b, a);
  }

  block(actor: string, target: string): void {
    let set = this.blockedKeys.get(actor);
    if (!set) {
      set = new Set();
      this.blockedKeys.set(actor, set);
    }
    set.add(target);
  }

  isBlocked(actor: string, target: string): boolean {
    return this.blockedKeys.get(actor)?.has(target) ?? false;
  }

  clearBlocksFor(id: string): void {
    this.blockedKeys.delete(id);
  }

  /** Remove an expired partner from the queue (returns the removed entry). */
  takeExpired(maxWaitMs: number): PendingEntry<E> | undefined {
    return this.entries.find((e) => this.clock() - e.enqueuedAt > maxWaitMs);
  }

  /**
   * Find and remove the first compatible partner for `me`, skipping anyone
   * currently blocked by me. FIFO order is preserved.
   */
  takeCompatible(me: E, blockedIds: Iterable<string> = []): PendingEntry<E> | undefined {
    const blocked = new Set(blockedIds);
    blocked.add(me.id);
    const idx = this.entries.findIndex((e) => !blocked.has(e.value.id) && !this.isBlocked(me.id, e.value.id));
    if (idx === -1) return undefined;
    const [entry] = this.entries.splice(idx, 1);
    return entry;
  }
}
