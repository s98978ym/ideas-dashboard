/**
 * TEAM ζ — Recovery & Rollback（復旧・ロールバックチーム）
 *
 * ミッション: 障害発生時の自動復旧と、安全なロールバックを保証する
 *
 * Blog CMS / Financial Model 共通の構造的欠陥「回復力の欠如」を根本解決する
 *
 * 対策するミス:
 *   M1 — メディアアップロード失敗時の自動復旧
 *   F8 — 計算チェーンのエラー伝播防止
 *   M3/F7 — ロールバックによる安全な復元
 */
import { BaseAgent } from '../core/base-agent.js';

// ─────────────────────────────────────────────────
// Dead Letter Agent — 失敗イベントの収集・分類・再処理
// ─────────────────────────────────────────────────
export class DeadLetterAgent extends BaseAgent {
  constructor(eventBus, opts = {}) {
    super('dead-letter', 'zeta-recovery', eventBus);
    this._queue = [];
    this._maxRetries = opts.maxRetries ?? 3;
    this._retryDelayMs = opts.retryDelayMs ?? 5000;
    this._cleanupTtlMs = opts.cleanupTtlMs ?? 24 * 60 * 60 * 1000; // 24h
    this._cleanupTimer = null;
  }

  async init() {
    await super.init();
    this.bus.on('deadletter:enqueue', (payload) => this.enqueue(payload));
    this.bus.on('deadletter:retry', (payload) => this.retryItem(payload));
    this.bus.on('deadletter:list', () => this.list());
    this.bus.on('cleanup:schedule', (payload) => this.scheduleCleanup(payload));

    // 定期クリーンアップ（1時間ごと）
    this._cleanupTimer = setInterval(() => this._autoCleanup(), 60 * 60 * 1000);
  }

  enqueue({ source, uploadId, error, state, timestamp }) {
    const item = {
      id: this._generateId(),
      source,
      uploadId,
      error,
      state,
      enqueuedAt: timestamp || Date.now(),
      retryCount: 0,
      status: 'pending',
    };
    this._queue.push(item);
    this._recordSuccess();
    this._log(`enqueued: ${item.id} from ${source} (error: ${error?.code || 'unknown'})`);
    return item;
  }

  async retryItem({ itemId }) {
    const item = this._queue.find((i) => i.id === itemId);
    if (!item) {
      throw new Error(`Dead letter item not found: ${itemId}`);
    }

    if (item.retryCount >= this._maxRetries) {
      item.status = 'exhausted';
      this._log(`item ${itemId} exhausted max retries (${this._maxRetries})`, 'warn');
      return { retried: false, reason: 'MAX_RETRIES_EXHAUSTED', item };
    }

    item.retryCount++;
    item.status = 'retrying';
    item.lastRetryAt = Date.now();

    // 元のイベントを再発行
    if (item.uploadId) {
      await this.bus.emit('media:resume', { uploadId: item.uploadId });
    }

    this._log(`retrying item ${itemId} (attempt ${item.retryCount}/${this._maxRetries})`);
    return { retried: true, item };
  }

  /** 全アイテムの一括リトライ */
  async retryAll() {
    const pending = this._queue.filter((i) => i.status === 'pending');
    const results = [];
    for (const item of pending) {
      await this._sleep(this._retryDelayMs);
      results.push(await this.retryItem({ itemId: item.id }));
    }
    return results;
  }

  list() {
    return this._queue.map(({ state, ...rest }) => rest); // 大きなstateオブジェクトを除外
  }

  scheduleCleanup({ uploadId, ttlMs, action }) {
    const cleanupAt = Date.now() + (ttlMs || this._cleanupTtlMs);
    this._log(`cleanup scheduled: ${action} for ${uploadId} at ${new Date(cleanupAt).toISOString()}`);
    // 実際のクリーンアップは _autoCleanup が定期実行
  }

  getStats() {
    const statuses = { pending: 0, retrying: 0, exhausted: 0, cleaned: 0 };
    for (const item of this._queue) {
      statuses[item.status] = (statuses[item.status] || 0) + 1;
    }
    return { total: this._queue.length, ...statuses };
  }

  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }
  }

  _autoCleanup() {
    const now = Date.now();
    const before = this._queue.length;
    this._queue = this._queue.filter((item) => {
      const age = now - item.enqueuedAt;
      if (age > this._cleanupTtlMs && (item.status === 'exhausted' || item.status === 'cleaned')) {
        return false;
      }
      return true;
    });
    const removed = before - this._queue.length;
    if (removed > 0) {
      this._log(`auto-cleanup: removed ${removed} expired items`);
    }
  }

  _generateId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `dl_${time}_${rand}`;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─────────────────────────────────────────────────
// Rollback Agent — M3/F7 の安全な状態復元
// ─────────────────────────────────────────────────
export class RollbackAgent extends BaseAgent {
  constructor(eventBus) {
    super('rollback', 'zeta-recovery', eventBus);
    this._rollbackHistory = [];
  }

  async init() {
    await super.init();
    this.bus.on('rollback:execute', (payload) => this.execute(payload));
    this.bus.on('rollback:history', () => this.getHistory());
  }

  async execute({ entityId, targetVersion, reason }) {
    this._log(`rollback requested: ${entityId} to version ${targetVersion} (reason: ${reason})`);

    try {
      // Versioning Agent に復元を依頼
      const result = await this.bus.request('version:restore', {
        entityId,
        versionId: targetVersion,
      });

      const entry = {
        entityId,
        targetVersion,
        reason,
        status: 'success',
        timestamp: Date.now(),
        restoredData: result,
      };
      this._rollbackHistory.push(entry);
      this._recordSuccess();

      await this.bus.emit('audit:version-save', {
        entityId,
        versionId: `rollback-to-${targetVersion}`,
        author: 'rollback-agent',
        message: `Rollback: ${reason}`,
      });

      return entry;
    } catch (err) {
      const entry = {
        entityId,
        targetVersion,
        reason,
        status: 'failed',
        error: err.message,
        timestamp: Date.now(),
      };
      this._rollbackHistory.push(entry);
      this._recordError(err);
      return entry;
    }
  }

  getHistory() {
    return [...this._rollbackHistory];
  }
}
