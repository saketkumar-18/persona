import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis-backed ephemeral store with an in-memory fallback.
 * All GhostLink state is temporary by design: sessions, rooms, queues and
 * metrics live only here and expire automatically. Nothing is persisted.
 */

interface MemEntry {
  value: string | string[] | Map<string, string>;
  /** epoch ms; -1 = no expiry */
  expiresAt: number;
}

function nowMs(): number {
  return Date.now();
}

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);

  private client: Redis | null = null;

  private readonly mem = new Map<string, MemEntry>();

  private sweepTimer: NodeJS.Timeout | null = null;

  private connecting: Promise<boolean> | null = null;

  ready = false;

  private startSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweepMem(), 30_000);
    this.sweepTimer.unref?.();
  }

  /** Nest lifecycle hook — ensures a store is ready even without explicit connect(). */
  async onModuleInit(): Promise<void> {
    await this.connect(process.env.REDIS_URL || null);
  }

  async connect(url: string | null): Promise<boolean> {
    if (this.ready) return this.client !== null;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect(url);
    return this.connecting;
  }

  private async doConnect(url: string | null): Promise<boolean> {
    if (!url) {
      this.logger.warn('REDIS_URL not set — using in-memory store (development only)');
      this.ready = true;
      this.startSweep();
      return false;
    }
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        connectTimeout: 5_000,
        enableReadyCheck: false,
      });
      await this.client.connect();
      this.ready = true;
      this.logger.log('Redis connected');
      return true;
    } catch (err) {
      this.logger.error(
        `Redis unavailable (${(err as Error).message}) — falling back to in-memory store`,
      );
      this.client = null;
      this.ready = true;
      this.startSweep();
      return false;
    }
  }

  get isRedis(): boolean {
    return this.client !== null;
  }

  private sweepMem(): void {
    const now = nowMs();
    for (const [k, v] of this.mem) if (v.expiresAt !== -1 && v.expiresAt <= now) this.mem.delete(k);
  }

  private memGet(key: string): MemEntry | undefined {
    const e = this.mem.get(key);
    if (e && e.expiresAt !== -1 && e.expiresAt <= nowMs()) {
      this.mem.delete(key);
      return undefined;
    }
    return e;
  }

  private async withRedis<T>(fn: (c: Redis) => Promise<T>): Promise<T | null> {
    if (!this.client) return null;
    try {
      return await fn(this.client);
    } catch {
      return null;
    }
  }

  // ----- strings -----------------------------------------------------------

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const ok = await this.withRedis((c) =>
      ttlSeconds ? c.set(key, value, 'EX', ttlSeconds) : c.set(key, value),
    );
    if (ok === null) {
      this.mem.set(key, { value, expiresAt: ttlSeconds ? nowMs() + ttlSeconds * 1000 : -1 });
    }
  }

  async get(key: string): Promise<string | null> {
    const r = await this.withRedis((c) => c.get(key));
    if (r !== null) return r;
    const e = this.memGet(key);
    return typeof e?.value === 'string' ? e.value : null;
  }

  async del(key: string): Promise<void> {
    const r = await this.withRedis((c) => c.del(key));
    if (r === null) this.mem.delete(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const r = await this.withRedis((c) => c.expire(key, ttlSeconds));
    if (r === null) {
      const e = this.memGet(key);
      if (e) e.expiresAt = nowMs() + ttlSeconds * 1000;
    }
  }

  async ttl(key: string): Promise<number> {
    const r = await this.withRedis((c) => c.ttl(key));
    if (r !== null) return r;
    const e = this.memGet(key);
    if (!e) return -2;
    if (e.expiresAt === -1) return -1;
    return Math.max(0, Math.ceil((e.expiresAt - nowMs()) / 1000));
  }

  // ----- hashes ------------------------------------------------------------

  async hset(key: string, fields: Record<string, string>): Promise<void> {
    const flat = Object.entries(fields).flatMap(([f, v]) => [f, v]);
    const r = await this.withRedis((c) => c.hset(key, ...flat));
    if (r === null) {
      const e = this.memGet(key);
      const map: Map<string, string> =
        e && e.value instanceof Map ? e.value : new Map<string, string>();
      for (const [f, v] of Object.entries(fields)) map.set(f, v);
      this.mem.set(key, { value: map, expiresAt: e?.expiresAt ?? -1 });
    }
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const r = await this.withRedis((c) => c.hgetall(key));
    if (r !== null) return Object.keys(r).length > 0 ? r : null;
    const e = this.memGet(key);
    if (!e || !(e.value instanceof Map)) return null;
    return Object.fromEntries(e.value as Map<string, string>);
  }

  // ----- lists -------------------------------------------------------------

  async rpush(key: string, ...values: string[]): Promise<void> {
    const r = await this.withRedis((c) => c.rpush(key, ...values));
    if (r === null) {
      const e = this.memGet(key);
      const list: string[] = e && Array.isArray(e.value) ? e.value : [];
      list.push(...values);
      this.mem.set(key, { value: list, expiresAt: e?.expiresAt ?? -1 });
    }
  }

  async lpop(key: string): Promise<string | null> {
    const r = await this.withRedis((c) => c.lpop(key));
    if (r !== null) return r;
    const e = this.memGet(key);
    if (!e || !Array.isArray(e.value)) return null;
    const v = (e.value as string[]).shift() ?? null;
    return v;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const r = await this.withRedis((c) => c.lrange(key, start, stop));
    if (r !== null) return r;
    const e = this.memGet(key);
    if (!e || !Array.isArray(e.value)) return [];
    return (e.value as string[]).slice(start, stop === -1 ? undefined : stop + 1);
  }

  async llen(key: string): Promise<number> {
    const r = await this.withRedis((c) => c.llen(key));
    if (r !== null) return r;
    const e = this.memGet(key);
    return e && Array.isArray(e.value) ? (e.value as string[]).length : 0;
  }

  async lrem(key: string, value: string): Promise<void> {
    const r = await this.withRedis((c) => c.lrem(key, 0, value));
    if (r === null) {
      const e = this.memGet(key);
      if (e && Array.isArray(e.value)) {
        e.value = (e.value as string[]).filter((v) => v !== value);
      }
    }
  }

  // ----- sets --------------------------------------------------------------

  async sadd(key: string, ...members: string[]): Promise<void> {
    const r = await this.withRedis((c) => c.sadd(key, ...members));
    if (r === null) {
      const e = this.memGet(key);
      const set: Set<string> = e && e.value instanceof Set ? e.value : new Set<string>();
      for (const m of members) set.add(m);
      this.mem.set(key, { value: set as unknown as MemEntry['value'], expiresAt: e?.expiresAt ?? -1 });
    }
  }

  async smembers(key: string): Promise<string[]> {
    const r = await this.withRedis((c) => c.smembers(key));
    if (r !== null) return r;
    const e = this.memGet(key);
    return e && e.value instanceof Set ? [...(e.value as Set<string>)] : [];
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    const r = await this.withRedis((c) => c.srem(key, ...members));
    if (r === null) {
      const e = this.memGet(key);
      if (e && e.value instanceof Set) for (const m of members) (e.value as Set<string>).delete(m);
    }
  }

  // ----- counters / misc ----------------------------------------------------

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const r = await this.withRedis(async (c) => {
      const v = await c.incr(key);
      if (ttlSeconds && v === 1) await c.expire(key, ttlSeconds);
      return v;
    });
    if (r !== null) return r;
    const e = this.memGet(key);
    const n = typeof e?.value === 'string' ? Number(e.value) + 1 : 1;
    this.mem.set(key, { value: String(n), expiresAt: ttlSeconds ? nowMs() + ttlSeconds * 1000 : e?.expiresAt ?? -1 });
    return n;
  }

  async dbsize(): Promise<number> {
    const r = await this.withRedis((c) => c.dbsize());
    if (r !== null) return r;
    return this.mem.size;
  }

  async pipeline(): Promise<null> {
    return null;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client = null;
      }
    }
  }
}
