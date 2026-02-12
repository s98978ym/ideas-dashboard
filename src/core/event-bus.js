/**
 * EventBus — Agent間通信の統一メッセージングレイヤー
 *
 * 全Agentはこのバスを通じて通信する。直接呼び出しは禁止。
 * これにより疎結合を保ち、監査ログへの一元記録を可能にする。
 */
export class EventBus {
  constructor() {
    this._handlers = new Map();
    this._middlewares = [];
    this._messageCount = 0;
  }

  /** ミドルウェア登録（監査ログ等が利用） */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new TypeError('Middleware must be a function');
    }
    this._middlewares.push(middleware);
  }

  /** イベント購読 */
  on(eventType, handler) {
    if (!this._handlers.has(eventType)) {
      this._handlers.set(eventType, []);
    }
    this._handlers.get(eventType).push(handler);
    return () => this.off(eventType, handler);
  }

  /** 購読解除 */
  off(eventType, handler) {
    const handlers = this._handlers.get(eventType);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  /** イベント発行 — 全ミドルウェアを通過後、ハンドラーに配信 */
  async emit(eventType, payload) {
    const envelope = {
      messageId: this._generateId(),
      type: eventType,
      payload,
      timestamp: Date.now(),
      seq: ++this._messageCount,
    };

    // ミドルウェアチェーン（監査ログ、バリデーション等）
    for (const mw of this._middlewares) {
      try {
        await mw(envelope);
      } catch (err) {
        // ミドルウェアのエラーはイベント配信を止めない
        console.error(`[EventBus] middleware error on "${eventType}":`, err.message);
      }
    }

    const handlers = this._handlers.get(eventType) || [];
    const results = [];
    for (const handler of handlers) {
      try {
        results.push(await handler(envelope.payload, envelope));
      } catch (err) {
        results.push({ error: err.message, agent: handler.name || 'anonymous' });
      }
    }
    return results;
  }

  /** request/response パターン — 単一応答を期待 */
  async request(eventType, payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[EventBus] request "${eventType}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.emit(eventType, payload).then((results) => {
        clearTimeout(timer);
        const firstValid = results.find((r) => r && !r.error);
        if (firstValid) {
          resolve(firstValid);
        } else {
          reject(new Error(`[EventBus] no valid response for "${eventType}": ${JSON.stringify(results)}`));
        }
      });
    });
  }

  _generateId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `msg_${time}_${rand}`;
  }
}
