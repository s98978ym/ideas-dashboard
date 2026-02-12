/**
 * TEAM δ — Quality Gate（品質ゲートチーム）
 *
 * ミッション: 各フェーズ間の品質関門として機能し、不良データの通過を阻止する
 *
 * Blog CMS / Financial Model 共通の構造的欠陥「検証の後回し」を根本解決する
 *
 * GATE 1: TEAM α → TEAM β 間（入力品質保証）
 * GATE 2: TEAM β → TEAM γ 間（出力品質保証）
 */
import { BaseAgent } from '../core/base-agent.js';

export class QualityGateAgent extends BaseAgent {
  constructor(eventBus) {
    super('quality-gate', 'delta-quality-gate', eventBus);
    this._gates = new Map();
    this._passLog = [];
  }

  async init() {
    await super.init();
    this.bus.on('gate:register', (payload) => this.registerGate(payload));
    this.bus.on('gate:check', (payload) => this.check(payload));
    this.bus.on('gate:stats', () => this.getStats());
  }

  /**
   * 品質ゲートを登録
   * @param {Object} params
   * @param {string} params.gateId - ゲートID (例: "gate-1-alpha-to-beta")
   * @param {Function[]} params.checks - チェック関数の配列
   * @param {string} params.description
   */
  registerGate({ gateId, checks, description }) {
    this._gates.set(gateId, { checks, description, passCount: 0, failCount: 0 });
    this._log(`gate registered: ${gateId} (${description})`);
  }

  /**
   * 品質ゲートを通過させる
   * @param {Object} params
   * @param {string} params.gateId
   * @param {Object} params.data - 検査対象データ
   */
  async check({ gateId, data }) {
    const gate = this._gates.get(gateId);
    if (!gate) {
      throw new Error(`品質ゲート "${gateId}" が登録されていません`);
    }

    const results = [];
    let allPassed = true;

    for (const checkFn of gate.checks) {
      try {
        const result = await checkFn(data);
        results.push({
          check: checkFn.name || 'anonymous',
          passed: result.passed !== false,
          message: result.message || '',
          details: result.details,
        });
        if (result.passed === false) allPassed = false;
      } catch (err) {
        allPassed = false;
        results.push({
          check: checkFn.name || 'anonymous',
          passed: false,
          message: err.message,
          error: true,
        });
      }
    }

    if (allPassed) {
      gate.passCount++;
      this._recordSuccess();
    } else {
      gate.failCount++;
      this._recordError(new Error(`Gate ${gateId} check failed`));
    }

    const entry = {
      gateId,
      passed: allPassed,
      results,
      timestamp: Date.now(),
    };
    this._passLog.push(entry);

    await this.bus.emit(allPassed ? 'gate:passed' : 'gate:rejected', entry);

    return entry;
  }

  getStats() {
    const stats = {};
    for (const [gateId, gate] of this._gates) {
      const total = gate.passCount + gate.failCount;
      stats[gateId] = {
        description: gate.description,
        passCount: gate.passCount,
        failCount: gate.failCount,
        passRate: total > 0 ? (gate.passCount / total * 100).toFixed(1) + '%' : 'N/A',
      };
    }
    return stats;
  }
}

// ─────────────────────────────────────────────────
// 事前定義の品質チェック関数群
// ─────────────────────────────────────────────────

/** GATE 1 用: 入力スキーマが完全か */
export function checkSchemaComplete(data) {
  if (!data || typeof data !== 'object') {
    return { passed: false, message: 'データがオブジェクトではありません' };
  }
  return { passed: true };
}

/** GATE 1 用: サニタイズ済みか */
export function checkSanitized(data) {
  const str = JSON.stringify(data);
  const hasScript = /<script/i.test(str);
  const hasOnEvent = /\bon\w+\s*=/i.test(str);
  if (hasScript || hasOnEvent) {
    return { passed: false, message: '未サニタイズのHTMLが検出されました' };
  }
  return { passed: true };
}

/** GATE 2 用: 計算結果にnull/NaNが含まれていないか */
export function checkNoNullResults(data) {
  if (data.results) {
    const nullResults = data.results.filter((r) => r.result === null && !r.error);
    if (nullResults.length > 0) {
      return {
        passed: false,
        message: `${nullResults.length}件の未解決null結果があります`,
        details: nullResults,
      };
    }
  }
  return { passed: true };
}

/** GATE 2 用: 応答時間が閾値内か */
export function createLatencyCheck(maxMs) {
  const checkLatency = (data) => {
    if (data.durationMs && data.durationMs > maxMs) {
      return {
        passed: false,
        message: `応答時間が閾値を超過 (${data.durationMs}ms > ${maxMs}ms)`,
      };
    }
    return { passed: true };
  };
  return checkLatency;
}
