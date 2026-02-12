/**
 * TEAM β — Processing & Logic（処理・ロジックチーム）
 *
 * ミッション: ビジネスロジックの正確な実行と計算の信頼性を保証する
 *
 * 対策するミス:
 *   F1 — 浮動小数点精度エラー (Calculation Engine Agent)
 *   F2 — 循環参照による無限ループ (Dependency Graph Agent)
 *   F8 — 計算チェーンのエラー伝播 (Calculation Engine Agent)
 *   M3 — コンテンツのバージョン管理不在 (Versioning Agent)
 *   F7 — モデル変更のバージョン管理不在 (Versioning Agent)
 */
import { BaseAgent } from '../core/base-agent.js';

// ─────────────────────────────────────────────────
// Decimal — 浮動小数点を排除した高精度数値型
// F1 (精度エラー) を型レベルで根絶する
// ─────────────────────────────────────────────────
export class Decimal {
  /**
   * @param {string|number} value - 数値 (文字列推奨: "123.4567")
   * @param {number} scale - 小数点以下の桁数 (default: 4)
   */
  constructor(value, scale = 4) {
    this.scale = scale;
    const multiplier = Math.pow(10, scale);

    if (typeof value === 'string') {
      // 文字列から直接パース（float変換を避ける）
      const parts = value.split('.');
      const intPart = BigInt(parts[0] || '0');
      const fracStr = (parts[1] || '').padEnd(scale, '0').slice(0, scale);
      const fracPart = BigInt(fracStr);
      const sign = value.startsWith('-') ? -1n : 1n;
      this._value = intPart * BigInt(multiplier) + sign * fracPart;
    } else if (value instanceof Decimal) {
      this._value = value._value;
      this.scale = value.scale;
    } else if (typeof value === 'bigint') {
      this._value = value;
    } else {
      // number型 → 文字列経由で変換し精度を維持
      const str = value.toFixed(scale);
      const parts = str.split('.');
      this._value = BigInt(parts[0]) * BigInt(multiplier)
        + BigInt(parts[1] || '0');
    }
  }

  add(other) {
    const b = other instanceof Decimal ? other : new Decimal(other, this.scale);
    return Decimal._fromRaw(this._value + b._value, this.scale);
  }

  subtract(other) {
    const b = other instanceof Decimal ? other : new Decimal(other, this.scale);
    return Decimal._fromRaw(this._value - b._value, this.scale);
  }

  multiply(other) {
    const b = other instanceof Decimal ? other : new Decimal(other, this.scale);
    const raw = this._value * b._value / BigInt(Math.pow(10, this.scale));
    return Decimal._fromRaw(raw, this.scale);
  }

  divide(other) {
    const b = other instanceof Decimal ? other : new Decimal(other, this.scale);
    if (b._value === 0n) {
      throw new CalculationError(
        'DIVISION_BY_ZERO',
        'ゼロによる除算が検出されました。入力値を確認してください。'
      );
    }
    const raw = this._value * BigInt(Math.pow(10, this.scale)) / b._value;
    return Decimal._fromRaw(raw, this.scale);
  }

  /** 通貨ごとの丸めルール適用 */
  roundForCurrency(currencyCode) {
    const rules = { JPY: 0, USD: 2, EUR: 2, GBP: 2 };
    const targetScale = rules[currencyCode] ?? 2;
    const factor = BigInt(Math.pow(10, this.scale - targetScale));
    const rounded = (this._value + factor / 2n) / factor * factor;
    return Decimal._fromRaw(rounded, this.scale);
  }

  toNumber() {
    const divisor = Math.pow(10, this.scale);
    return Number(this._value) / divisor;
  }

  toString() {
    const divisor = BigInt(Math.pow(10, this.scale));
    const intPart = this._value / divisor;
    const fracPart = this._value % divisor;
    const fracStr = fracPart.toString().padStart(this.scale, '0');
    return `${intPart}.${fracStr}`;
  }

  static _fromRaw(bigintValue, scale) {
    const d = new Decimal('0', scale);
    d._value = bigintValue;
    return d;
  }
}

// ─────────────────────────────────────────────────
// Calculation Engine Agent — F1, F8 を根絶
// ─────────────────────────────────────────────────
export class CalculationEngineAgent extends BaseAgent {
  constructor(eventBus) {
    super('calculation-engine', 'beta-processing', eventBus);
    this._auditLog = [];
  }

  async init() {
    await super.init();
    this.bus.on('calc:execute', (payload) => this.execute(payload));
    this.bus.on('calc:batch', (payload) => this.executeBatch(payload));
  }

  /**
   * 単一計算を実行（監査証跡付き）
   * @param {Object} params
   * @param {string} params.operation - "add"|"subtract"|"multiply"|"divide"
   * @param {string} params.a - 被演算子（文字列で渡す: "123.45"）
   * @param {string} params.b - 演算子
   * @param {string} [params.currency] - 通貨コード（丸め適用用）
   * @param {string} [params.cellId] - セル識別子（スプレッドシート連携用）
   */
  execute({ operation, a, b, currency, cellId }) {
    const decA = new Decimal(a);
    const decB = new Decimal(b);

    const auditEntry = {
      timestamp: Date.now(),
      cellId,
      operation,
      inputA: a,
      inputB: b,
      inputHashA: this._simpleHash(a),
      inputHashB: this._simpleHash(b),
    };

    try {
      let result;
      switch (operation) {
        case 'add': result = decA.add(decB); break;
        case 'subtract': result = decA.subtract(decB); break;
        case 'multiply': result = decA.multiply(decB); break;
        case 'divide': result = decA.divide(decB); break;
        default:
          throw new CalculationError('UNKNOWN_OPERATION', `不明な演算: ${operation}`);
      }

      if (currency) {
        result = result.roundForCurrency(currency);
      }

      // 逆計算による検算 (dual-path verification)
      this._verify(operation, decA, decB, result);

      auditEntry.output = result.toString();
      auditEntry.outputHash = this._simpleHash(result.toString());
      auditEntry.status = 'success';
      this._auditLog.push(auditEntry);
      this._recordSuccess();

      // 監査イベント発行
      this.bus.emit('audit:calculation', auditEntry);

      return {
        result: result.toString(),
        resultNumber: result.toNumber(),
        audit: auditEntry,
      };

    } catch (err) {
      auditEntry.status = 'error';
      auditEntry.error = { code: err.code, message: err.message };
      this._auditLog.push(auditEntry);
      this._recordError(err);

      // F8対策: エラーを明確に構造化して返す（NaN伝播を防止）
      return {
        result: null,
        error: {
          code: err.code || 'CALCULATION_ERROR',
          message: err.message,
          cellId,
          operation,
        },
        audit: auditEntry,
      };
    }
  }

  /** バッチ計算 — 計算チェーンをトポロジカル順に実行 */
  executeBatch({ calculations, stopOnError = true }) {
    const results = [];
    const resolved = new Map(); // cellId → result

    for (const calc of calculations) {
      // 前の計算結果を参照で解決
      const a = calc.refA ? resolved.get(calc.refA)?.result ?? calc.a : calc.a;
      const b = calc.refB ? resolved.get(calc.refB)?.result ?? calc.b : calc.b;

      // F8対策: 上流にエラーがあれば下流をスキップ
      if (calc.refA && resolved.get(calc.refA)?.error) {
        const skipped = {
          result: null,
          error: {
            code: 'UPSTREAM_ERROR',
            message: `上流セル ${calc.refA} でエラーが発生したため、計算をスキップしました`,
            cellId: calc.cellId,
            upstreamCellId: calc.refA,
          },
        };
        results.push(skipped);
        if (calc.cellId) resolved.set(calc.cellId, skipped);
        if (stopOnError) break;
        continue;
      }
      if (calc.refB && resolved.get(calc.refB)?.error) {
        const skipped = {
          result: null,
          error: {
            code: 'UPSTREAM_ERROR',
            message: `上流セル ${calc.refB} でエラーが発生したため、計算をスキップしました`,
            cellId: calc.cellId,
            upstreamCellId: calc.refB,
          },
        };
        results.push(skipped);
        if (calc.cellId) resolved.set(calc.cellId, skipped);
        if (stopOnError) break;
        continue;
      }

      if (a === null || b === null) {
        const missing = {
          result: null,
          error: {
            code: 'MISSING_INPUT',
            message: `セル ${calc.cellId} の入力が解決できません`,
            cellId: calc.cellId,
          },
        };
        results.push(missing);
        if (calc.cellId) resolved.set(calc.cellId, missing);
        if (stopOnError) break;
        continue;
      }

      const res = this.execute({ ...calc, a, b });
      results.push(res);
      if (calc.cellId) resolved.set(calc.cellId, res);
      if (res.error && stopOnError) break;
    }

    return { results, resolvedCells: Object.fromEntries(resolved) };
  }

  /** 逆計算による検算 */
  _verify(operation, a, b, result) {
    try {
      switch (operation) {
        case 'add': {
          const check = result.subtract(b);
          if (Math.abs(check.toNumber() - a.toNumber()) > 1e-8) {
            this._log('verification warning: add reverse check deviation detected', 'warn');
          }
          break;
        }
        case 'multiply': {
          if (b.toNumber() !== 0) {
            const check = result.divide(b);
            if (Math.abs(check.toNumber() - a.toNumber()) > 1e-6) {
              this._log('verification warning: multiply reverse check deviation detected', 'warn');
            }
          }
          break;
        }
      }
    } catch {
      // 検算エラーは致命的ではないのでログのみ
    }
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return 'h_' + Math.abs(hash).toString(36);
  }

  getAuditLog() {
    return [...this._auditLog];
  }
}

// ─────────────────────────────────────────────────
// Dependency Graph Agent — F2 (循環参照) を根絶
// ─────────────────────────────────────────────────
export class DependencyGraphAgent extends BaseAgent {
  constructor(eventBus) {
    super('dependency-graph', 'beta-processing', eventBus);
    this._graph = new Map(); // nodeId → Set<dependencyId>
    this._maxDepth = 100;
  }

  async init() {
    await super.init();
    this.bus.on('graph:add-edge', (payload) => this.addEdge(payload));
    this.bus.on('graph:remove-node', (payload) => this.removeNode(payload));
    this.bus.on('graph:check-cycle', (payload) => this.checkCycle(payload));
    this.bus.on('graph:execution-order', () => this.getExecutionOrder());
  }

  /** 依存関係を追加（追加前にサイクル検査） */
  addEdge({ from, to }) {
    // 追加前にサイクルをシミュレート
    if (this._wouldCreateCycle(from, to)) {
      this._recordError(new Error(`Circular dependency: ${from} → ${to}`));
      return {
        accepted: false,
        error: {
          code: 'CIRCULAR_DEPENDENCY',
          message: `循環参照を検出しました: "${from}" → "${to}" を追加すると循環が発生します`,
          cycle: this._findCyclePath(from, to),
        },
      };
    }

    if (!this._graph.has(from)) {
      this._graph.set(from, new Set());
    }
    this._graph.get(from).add(to);
    this._recordSuccess();

    return { accepted: true, graphSize: this._graph.size };
  }

  removeNode({ nodeId }) {
    this._graph.delete(nodeId);
    for (const deps of this._graph.values()) {
      deps.delete(nodeId);
    }
  }

  /** サイクル検査 */
  checkCycle() {
    const visited = new Set();
    const recStack = new Set();
    const cyclePath = [];

    const dfs = (node) => {
      visited.add(node);
      recStack.add(node);

      const deps = this._graph.get(node) || new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) {
            cyclePath.unshift(dep);
            return true;
          }
        } else if (recStack.has(dep)) {
          cyclePath.unshift(dep);
          return true;
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const node of this._graph.keys()) {
      if (!visited.has(node)) {
        if (dfs(node)) {
          return {
            hasCycle: true,
            cyclePath,
            message: `循環参照を検出: ${cyclePath.join(' → ')}`,
          };
        }
      }
    }

    return { hasCycle: false };
  }

  /** トポロジカルソートで安全な実行順序を返す */
  getExecutionOrder() {
    const cycleCheck = this.checkCycle();
    if (cycleCheck.hasCycle) {
      return { order: null, error: cycleCheck };
    }

    const visited = new Set();
    const order = [];

    const visit = (node, depth) => {
      if (depth > this._maxDepth) {
        throw new Error(`最大再帰深度(${this._maxDepth})を超えました: ${node}`);
      }
      if (visited.has(node)) return;
      visited.add(node);

      const deps = this._graph.get(node) || new Set();
      for (const dep of deps) {
        visit(dep, depth + 1);
      }
      order.push(node);
    };

    for (const node of this._graph.keys()) {
      visit(node, 0);
    }

    return { order, error: null };
  }

  /** 辺を追加するとサイクルになるかシミュレート */
  _wouldCreateCycle(from, to) {
    if (from === to) return true;

    // to → from への到達パスがあればサイクル
    const visited = new Set();
    const queue = [to];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === from) return true;
      if (visited.has(node)) continue;
      visited.add(node);

      const deps = this._graph.get(node) || new Set();
      for (const dep of deps) {
        queue.push(dep);
      }
    }
    return false;
  }

  _findCyclePath(from, to) {
    // BFS でto→fromへのパスを発見
    const visited = new Map();
    const queue = [to];
    visited.set(to, null);

    while (queue.length > 0) {
      const node = queue.shift();
      if (node === from) {
        // パスを再構築
        const path = [from];
        let curr = to;
        while (curr !== null) {
          path.unshift(curr);
          curr = visited.get(curr);
        }
        return path;
      }

      const deps = this._graph.get(node) || new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.set(dep, node);
          queue.push(dep);
        }
      }
    }
    return [from, to, from];
  }
}

// ─────────────────────────────────────────────────
// Versioning Agent — M3, F7 を防止
// ─────────────────────────────────────────────────
export class VersioningAgent extends BaseAgent {
  constructor(eventBus) {
    super('versioning', 'beta-processing', eventBus);
    this._snapshots = new Map(); // entityId → version[]
  }

  async init() {
    await super.init();
    this.bus.on('version:save', (payload) => this.save(payload));
    this.bus.on('version:restore', (payload) => this.restore(payload));
    this.bus.on('version:diff', (payload) => this.diff(payload));
    this.bus.on('version:history', (payload) => this.history(payload));
  }

  save({ entityId, data, author, message }) {
    if (!this._snapshots.has(entityId)) {
      this._snapshots.set(entityId, []);
    }

    const versions = this._snapshots.get(entityId);
    const version = {
      versionId: versions.length + 1,
      data: structuredClone(data),
      author,
      message,
      timestamp: Date.now(),
      hash: this._hashObject(data),
    };
    versions.push(version);
    this._recordSuccess();

    this.bus.emit('audit:version-save', {
      entityId,
      versionId: version.versionId,
      author,
      message,
    });

    return { entityId, versionId: version.versionId, hash: version.hash };
  }

  restore({ entityId, versionId }) {
    const versions = this._snapshots.get(entityId);
    if (!versions || versionId < 1 || versionId > versions.length) {
      throw new Error(`バージョン ${versionId} が見つかりません (entity: ${entityId})`);
    }

    const target = versions[versionId - 1];
    this._recordSuccess();
    return { entityId, versionId, data: structuredClone(target.data), restoredAt: Date.now() };
  }

  diff({ entityId, fromVersion, toVersion }) {
    const versions = this._snapshots.get(entityId);
    if (!versions) return { changes: [] };

    const from = versions[(fromVersion || versions.length - 1) - 1]?.data || {};
    const to = versions[(toVersion || versions.length) - 1]?.data || {};

    return { changes: this._computeDiff(from, to) };
  }

  history({ entityId }) {
    const versions = this._snapshots.get(entityId) || [];
    return versions.map(({ data, ...meta }) => meta);
  }

  _computeDiff(a, b, path = '') {
    const changes = [];
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
      const fullPath = path ? `${path}.${key}` : key;
      if (!(key in a)) {
        changes.push({ path: fullPath, type: 'added', newValue: b[key] });
      } else if (!(key in b)) {
        changes.push({ path: fullPath, type: 'removed', oldValue: a[key] });
      } else if (typeof a[key] === 'object' && typeof b[key] === 'object') {
        changes.push(...this._computeDiff(a[key], b[key], fullPath));
      } else if (a[key] !== b[key]) {
        changes.push({ path: fullPath, type: 'modified', oldValue: a[key], newValue: b[key] });
      }
    }
    return changes;
  }

  _hashObject(obj) {
    const str = JSON.stringify(obj);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return 'v_' + Math.abs(hash).toString(36);
  }
}

// ─────────────────────────────────────────────────
// カスタムエラー型
// ─────────────────────────────────────────────────
export class CalculationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CalculationError';
    this.code = code;
  }
}
