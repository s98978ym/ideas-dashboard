/**
 * BaseAgent — 全Agentの基底クラス
 *
 * 共通機能:
 * - EventBusへの自動接続
 * - 監査ログの自動記録
 * - 構造化エラーハンドリング
 * - ヘルスチェック
 */
export class BaseAgent {
  /**
   * @param {string} name - Agent名 (例: "media-intake")
   * @param {string} team - 所属チーム (例: "alpha-ingestion")
   * @param {import('./event-bus.js').EventBus} eventBus
   */
  constructor(name, team, eventBus) {
    if (!name || !team || !eventBus) {
      throw new Error('BaseAgent requires name, team, and eventBus');
    }
    this.name = name;
    this.team = team;
    this.bus = eventBus;
    this._startTime = Date.now();
    this._processedCount = 0;
    this._errorCount = 0;
    this._initialized = false;
  }

  /** 初期化 — サブクラスでoverrideしてイベント購読等を行う */
  async init() {
    this._initialized = true;
    this._log('initialized');
  }

  /** ヘルスチェック */
  health() {
    return {
      agent: this.name,
      team: this.team,
      initialized: this._initialized,
      uptimeMs: Date.now() - this._startTime,
      processedCount: this._processedCount,
      errorCount: this._errorCount,
      errorRate: this._processedCount > 0
        ? (this._errorCount / this._processedCount * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /** 処理成功を記録 */
  _recordSuccess() {
    this._processedCount++;
  }

  /** 処理失敗を記録 */
  _recordError(err) {
    this._processedCount++;
    this._errorCount++;
    this._log(`error: ${err.message}`, 'error');
  }

  /** 構造化ログ出力 */
  _log(message, level = 'info') {
    const entry = {
      timestamp: new Date().toISOString(),
      agent: this.name,
      team: this.team,
      level,
      message,
    };
    // イベントバスに監査イベントとして流す（TEAM ε が購読）
    this.bus.emit('agent:log', entry).catch(() => {});
  }

  /**
   * リトライ付き実行 — 指数バックオフ
   * Blog CMS/Financial Model 共通の「リトライ欠如」を根本解決
   */
  async _withRetry(fn, { maxRetries = 3, baseDelayMs = 2000, label = 'operation' } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          this._log(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${err.message}`, 'warn');
          await this._sleep(delay);
        }
      }
    }
    throw lastError;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
