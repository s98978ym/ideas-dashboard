/**
 * CircuitBreaker — 障害の連鎖を断ち切る
 *
 * Blog CMS: メディアアップロード連続失敗時にバックエンドを保護
 * Financial Model: 計算チェーンのエラー伝播(F8)を防止
 *
 * 状態遷移: CLOSED → OPEN → HALF_OPEN → CLOSED (or OPEN)
 */

const STATE = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

export class CircuitBreaker {
  /**
   * @param {Object} opts
   * @param {number} opts.failureThreshold  - OPEN移行までの連続失敗数 (default: 5)
   * @param {number} opts.resetTimeoutMs    - OPEN→HALF_OPEN までの待機時間 (default: 30000)
   * @param {number} opts.halfOpenMaxAttempts - HALF_OPENで試行する最大数 (default: 1)
   * @param {Function} opts.onStateChange   - 状態変化時コールバック
   */
  constructor(opts = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30000;
    this.halfOpenMaxAttempts = opts.halfOpenMaxAttempts ?? 1;
    this.onStateChange = opts.onStateChange ?? (() => {});

    this._state = STATE.CLOSED;
    this._failureCount = 0;
    this._successCount = 0;
    this._lastFailureTime = 0;
    this._halfOpenAttempts = 0;
  }

  get state() {
    // OPEN状態でクールダウン経過 → 自動的にHALF_OPENへ
    if (
      this._state === STATE.OPEN &&
      Date.now() - this._lastFailureTime >= this.resetTimeoutMs
    ) {
      this._transition(STATE.HALF_OPEN);
    }
    return this._state;
  }

  /**
   * 保護された関数を実行
   * @param {Function} fn - 実行する非同期関数
   * @param {Function} [fallback] - OPEN時のフォールバック関数
   */
  async execute(fn, fallback) {
    const currentState = this.state;

    if (currentState === STATE.OPEN) {
      if (fallback) return fallback();
      throw new CircuitBreakerOpenError(
        `Circuit is OPEN. Retry after ${this._remainingCooldownMs()}ms`
      );
    }

    if (currentState === STATE.HALF_OPEN) {
      if (this._halfOpenAttempts >= this.halfOpenMaxAttempts) {
        if (fallback) return fallback();
        throw new CircuitBreakerOpenError('Circuit is HALF_OPEN and max attempts reached');
      }
      this._halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  /** 手動リセット */
  reset() {
    this._failureCount = 0;
    this._successCount = 0;
    this._halfOpenAttempts = 0;
    this._transition(STATE.CLOSED);
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this._failureCount,
      successCount: this._successCount,
      lastFailureTime: this._lastFailureTime,
      remainingCooldownMs: this._remainingCooldownMs(),
    };
  }

  _onSuccess() {
    this._failureCount = 0;
    this._successCount++;
    if (this._state === STATE.HALF_OPEN) {
      this._halfOpenAttempts = 0;
      this._transition(STATE.CLOSED);
    }
  }

  _onFailure() {
    this._failureCount++;
    this._successCount = 0;
    this._lastFailureTime = Date.now();

    if (this._state === STATE.HALF_OPEN) {
      this._halfOpenAttempts = 0;
      this._transition(STATE.OPEN);
    } else if (this._failureCount >= this.failureThreshold) {
      this._transition(STATE.OPEN);
    }
  }

  _transition(newState) {
    if (this._state === newState) return;
    const prev = this._state;
    this._state = newState;
    if (newState === STATE.HALF_OPEN) {
      this._halfOpenAttempts = 0;
    }
    this.onStateChange({ from: prev, to: newState, timestamp: Date.now() });
  }

  _remainingCooldownMs() {
    if (this._state !== STATE.OPEN) return 0;
    const elapsed = Date.now() - this._lastFailureTime;
    return Math.max(0, this.resetTimeoutMs - elapsed);
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.isCircuitBreakerError = true;
  }
}

export { STATE as CircuitBreakerState };
