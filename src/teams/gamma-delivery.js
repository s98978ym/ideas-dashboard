/**
 * TEAM γ — Delivery & Output（配信・出力チーム）
 *
 * ミッション: 処理結果を正しい形式・最適な性能でユーザーに届ける
 *
 * 対策するミス:
 *   M5 — API設計の一貫性崩壊 (API Gateway Agent)
 *   M7 — SEO対応の後回し (SEO/Meta Agent)
 *   M8 — キャッシュ戦略の不在 (Cache Strategy Agent)
 */
import { BaseAgent } from '../core/base-agent.js';

// ─────────────────────────────────────────────────
// Cache Strategy Agent — M8 を根絶
// 3層キャッシュ: L1 Memory → L2 Storage → L3 Origin
// ─────────────────────────────────────────────────
export class CacheStrategyAgent extends BaseAgent {
  constructor(eventBus, opts = {}) {
    super('cache-strategy', 'gamma-delivery', eventBus);

    this._l1 = new Map();                     // L1: インメモリ
    this._l1MaxSize = opts.l1MaxSize ?? 1000;
    this._l1DefaultTtl = opts.l1DefaultTtl ?? 5 * 60 * 1000; // 5分
    this._l2Adapter = opts.l2Adapter ?? null;  // L2: Redis等
    this._stats = { hits: 0, misses: 0, evictions: 0 };
  }

  async init() {
    await super.init();
    this.bus.on('cache:get', (payload) => this.get(payload));
    this.bus.on('cache:set', (payload) => this.set(payload));
    this.bus.on('cache:invalidate', (payload) => this.invalidate(payload));
    this.bus.on('cache:invalidate-by-tag', (payload) => this.invalidateByTag(payload));
  }

  async get({ key }) {
    // L1 チェック
    const l1Entry = this._l1.get(key);
    if (l1Entry && l1Entry.expiresAt > Date.now()) {
      this._stats.hits++;
      return { value: l1Entry.value, source: 'L1', hit: true };
    }

    // L1 期限切れを削除
    if (l1Entry) this._l1.delete(key);

    // L2 チェック
    if (this._l2Adapter) {
      const l2Value = await this._l2Adapter.get(key);
      if (l2Value !== null && l2Value !== undefined) {
        // L1にプロモート
        this._setL1(key, l2Value, this._l1DefaultTtl, []);
        this._stats.hits++;
        return { value: l2Value, source: 'L2', hit: true };
      }
    }

    this._stats.misses++;
    return { value: null, source: null, hit: false };
  }

  async set({ key, value, ttlMs, tags = [] }) {
    const ttl = ttlMs ?? this._l1DefaultTtl;

    // L1 に保存
    this._setL1(key, value, ttl, tags);

    // L2 に保存
    if (this._l2Adapter) {
      await this._l2Adapter.set(key, value, ttl);
    }

    return { stored: true, key };
  }

  /** キー指定で無効化 */
  async invalidate({ key }) {
    this._l1.delete(key);
    if (this._l2Adapter?.delete) {
      await this._l2Adapter.delete(key);
    }
    this._stats.evictions++;
  }

  /** タグベース一括無効化 — コンテンツ更新時に関連キャッシュをまとめてパージ */
  async invalidateByTag({ tag }) {
    let count = 0;
    for (const [key, entry] of this._l1.entries()) {
      if (entry.tags?.includes(tag)) {
        this._l1.delete(key);
        count++;
      }
    }
    if (this._l2Adapter?.deleteByTag) {
      count += await this._l2Adapter.deleteByTag(tag);
    }
    this._stats.evictions += count;
    this._log(`invalidated ${count} entries by tag: ${tag}`);
    return { invalidatedCount: count };
  }

  getStats() {
    const total = this._stats.hits + this._stats.misses;
    return {
      ...this._stats,
      hitRate: total > 0 ? (this._stats.hits / total * 100).toFixed(1) + '%' : '0%',
      l1Size: this._l1.size,
    };
  }

  _setL1(key, value, ttl, tags) {
    // LRU: サイズ上限超過時に最古のエントリを削除
    if (this._l1.size >= this._l1MaxSize) {
      const oldest = this._l1.keys().next().value;
      this._l1.delete(oldest);
      this._stats.evictions++;
    }

    this._l1.set(key, {
      value,
      tags,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    });
  }
}

// ─────────────────────────────────────────────────
// API Gateway Agent — M5 (API一貫性崩壊) を防止
// ─────────────────────────────────────────────────
export class ApiGatewayAgent extends BaseAgent {
  constructor(eventBus) {
    super('api-gateway', 'gamma-delivery', eventBus);
    this._rateLimits = new Map(); // clientId → { count, resetAt }
    this._defaultRateLimit = { maxRequests: 100, windowMs: 60000 };
  }

  async init() {
    await super.init();
    this.bus.on('api:request', (payload) => this.handleRequest(payload));
  }

  async handleRequest({ method, path, body, clientId, headers }) {
    // レート制限チェック
    const rateCheck = this._checkRateLimit(clientId);
    if (!rateCheck.allowed) {
      return {
        status: 429,
        body: {
          error: 'RATE_LIMIT_EXCEEDED',
          message: `レート制限に達しました。${rateCheck.retryAfterMs}ms 後に再試行してください。`,
          retryAfterMs: rateCheck.retryAfterMs,
        },
      };
    }

    // 統一レスポンスエンベロープ
    try {
      const result = await this.bus.request(`api:handle:${method}:${path}`, {
        body,
        headers,
        clientId,
      });

      return {
        status: 200,
        body: {
          success: true,
          data: result,
          meta: { timestamp: new Date().toISOString(), path, method },
        },
      };
    } catch (err) {
      return {
        status: err.statusCode || 500,
        body: {
          success: false,
          error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
          meta: { timestamp: new Date().toISOString(), path, method },
        },
      };
    }
  }

  _checkRateLimit(clientId) {
    if (!clientId) return { allowed: true };

    const now = Date.now();
    let bucket = this._rateLimits.get(clientId);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this._defaultRateLimit.windowMs };
      this._rateLimits.set(clientId, bucket);
    }

    bucket.count++;

    if (bucket.count > this._defaultRateLimit.maxRequests) {
      return { allowed: false, retryAfterMs: bucket.resetAt - now };
    }
    return { allowed: true, remaining: this._defaultRateLimit.maxRequests - bucket.count };
  }
}
