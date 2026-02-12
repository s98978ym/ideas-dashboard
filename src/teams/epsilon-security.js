/**
 * TEAM ε — Security & Audit（セキュリティ・監査チーム）
 *
 * ミッション: 全チームの操作を横断的に監視し、セキュリティと追跡可能性を保証する
 *
 * 対策するミス:
 *   M6 — 認証・認可の穴 (AuthZ Agent)
 *   F4 — 監査証跡の欠如 (Audit Trail Agent)
 *   F6 — 規制コンプライアンス違反 (Compliance Agent)
 */
import { BaseAgent } from '../core/base-agent.js';

// ─────────────────────────────────────────────────
// Audit Trail Agent — F4 (監査証跡の欠如) を根絶
// Append-Only で全操作を不変記録
// ─────────────────────────────────────────────────
export class AuditTrailAgent extends BaseAgent {
  constructor(eventBus, opts = {}) {
    super('audit-trail', 'epsilon-security', eventBus);
    this._log_store = [];  // Append-Only ストア
    this._maxInMemory = opts.maxInMemory ?? 10000;
    this._persistAdapter = opts.persistAdapter ?? null;
  }

  async init() {
    await super.init();

    // 全監査イベントを購読
    this.bus.on('audit:calculation', (payload) => this._record('CALCULATION', payload));
    this.bus.on('audit:version-save', (payload) => this._record('VERSION_SAVE', payload));
    this.bus.on('agent:log', (payload) => this._record('AGENT_LOG', payload));
    this.bus.on('media:completed', (payload) => this._record('MEDIA_UPLOAD', payload));
    this.bus.on('media:aborted', (payload) => this._record('MEDIA_ABORTED', payload));
    this.bus.on('gate:passed', (payload) => this._record('GATE_PASSED', payload));
    this.bus.on('gate:rejected', (payload) => this._record('GATE_REJECTED', payload));
    this.bus.on('circuit:state-change', (payload) => this._record('CIRCUIT_CHANGE', payload));
    this.bus.on('deadletter:enqueue', (payload) => this._record('DEAD_LETTER', payload));
    this.bus.on('auth:access-denied', (payload) => this._record('ACCESS_DENIED', payload));

    // EventBus ミドルウェアとして全メッセージを記録
    this.bus.use(async (envelope) => {
      if (envelope.type.startsWith('audit:')) return; // 監査イベント自体の無限ループ防止
      this._record('EVENT', {
        eventType: envelope.type,
        messageId: envelope.messageId,
        seq: envelope.seq,
      });
    });
  }

  async _record(action, payload) {
    const entry = {
      eventId: this._generateEventId(),
      timestamp: new Date().toISOString(),
      action,
      payload: this._sanitizeForLog(payload),
    };

    // Append-Only: push のみ、delete/update 不可
    this._log_store.push(Object.freeze(entry));

    // インメモリ上限管理 — 古いログを外部永続化
    if (this._log_store.length > this._maxInMemory) {
      const overflow = this._log_store.splice(0, this._log_store.length - this._maxInMemory);
      if (this._persistAdapter?.append) {
        await this._persistAdapter.append(overflow);
      }
    }
  }

  /** 監査ログ検索 */
  query({ action, fromTimestamp, toTimestamp, limit = 100 }) {
    let results = this._log_store;

    if (action) {
      results = results.filter((e) => e.action === action);
    }
    if (fromTimestamp) {
      results = results.filter((e) => e.timestamp >= fromTimestamp);
    }
    if (toTimestamp) {
      results = results.filter((e) => e.timestamp <= toTimestamp);
    }

    return results.slice(-limit);
  }

  /** ログの改ざん検知用ハッシュチェーン */
  getIntegrityHash() {
    let hash = 0;
    for (const entry of this._log_store) {
      const str = JSON.stringify(entry);
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
      }
    }
    return 'audit_' + Math.abs(hash).toString(36);
  }

  getLogCount() {
    return this._log_store.length;
  }

  /** ペイロードから機密情報を除去してログ保存 */
  _sanitizeForLog(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const sanitized = { ...payload };
    const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'cookie'];
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }

  _generateEventId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `evt_${time}_${rand}`;
  }
}

// ─────────────────────────────────────────────────
// AuthZ Agent — M6 (認証・認可の穴) を防止
// ─────────────────────────────────────────────────
export class AuthZAgent extends BaseAgent {
  constructor(eventBus) {
    super('authz', 'epsilon-security', eventBus);
    // ロール → 許可アクション のマッピング
    this._permissions = new Map();
  }

  async init() {
    await super.init();
    this.bus.on('auth:check', (payload) => this.checkPermission(payload));
    this.bus.on('auth:set-role', (payload) => this.setRole(payload));
  }

  setRole({ role, allowedActions }) {
    this._permissions.set(role, new Set(allowedActions));
    this._log(`role configured: ${role} → [${allowedActions.join(', ')}]`);
  }

  checkPermission({ userId, role, action, resource }) {
    const allowed = this._permissions.get(role);
    if (!allowed) {
      this.bus.emit('auth:access-denied', { userId, role, action, resource, reason: 'UNKNOWN_ROLE' });
      return {
        permitted: false,
        reason: `ロール "${role}" は定義されていません`,
      };
    }

    // ワイルドカード + 具体的アクションの両方をチェック
    if (allowed.has('*') || allowed.has(action)) {
      this._recordSuccess();
      return { permitted: true };
    }

    // リソーススコープ付きチェック (例: "read:posts" )
    const scopedAction = `${action}:${resource}`;
    if (allowed.has(scopedAction)) {
      this._recordSuccess();
      return { permitted: true };
    }

    this._recordError(new Error(`Access denied: ${role}/${action}`));
    this.bus.emit('auth:access-denied', { userId, role, action, resource, reason: 'NOT_PERMITTED' });
    return {
      permitted: false,
      reason: `ロール "${role}" にアクション "${action}" の権限がありません`,
    };
  }
}
