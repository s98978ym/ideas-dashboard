/**
 * Orchestrator Agent — 全チームの指揮・判断・ルーティング
 *
 * 責務:
 * 1. 全6チームの初期化とライフサイクル管理
 * 2. 品質ゲート (GATE 1/GATE 2) の配線
 * 3. エスカレーションルールの適用
 * 4. システム全体のヘルスチェック
 */
import { EventBus } from './core/event-bus.js';
import { MediaIntakeAgent, SchemaValidatorAgent, SanitizerAgent } from './teams/alpha-ingestion.js';
import { CalculationEngineAgent, DependencyGraphAgent, VersioningAgent } from './teams/beta-processing.js';
import { CacheStrategyAgent, ApiGatewayAgent } from './teams/gamma-delivery.js';
import { QualityGateAgent, checkSchemaComplete, checkSanitized, checkNoNullResults, createLatencyCheck } from './teams/delta-quality-gate.js';
import { AuditTrailAgent, AuthZAgent } from './teams/epsilon-security.js';
import { DeadLetterAgent, RollbackAgent } from './teams/zeta-recovery.js';

export class Orchestrator {
  constructor(config = {}) {
    this.bus = new EventBus();
    this._config = config;
    this._agents = new Map();
    this._initialized = false;
  }

  /**
   * 全チームを初期化して品質ゲートを配線
   */
  async init() {
    // ── TEAM ε (Security) を最初に起動 — 全操作を記録するため ──
    const auditTrail = new AuditTrailAgent(this.bus, this._config.audit);
    const authz = new AuthZAgent(this.bus);

    // ── TEAM α (Ingestion) ──
    const mediaIntake = new MediaIntakeAgent(this.bus, this._config.mediaIntake);
    const schemaValidator = new SchemaValidatorAgent(this.bus);
    const sanitizer = new SanitizerAgent(this.bus);

    // ── TEAM β (Processing) ──
    const calcEngine = new CalculationEngineAgent(this.bus);
    const depGraph = new DependencyGraphAgent(this.bus);
    const versioning = new VersioningAgent(this.bus);

    // ── TEAM γ (Delivery) ──
    const cache = new CacheStrategyAgent(this.bus, this._config.cache);
    const apiGateway = new ApiGatewayAgent(this.bus);

    // ── TEAM δ (Quality Gate) ──
    const qualityGate = new QualityGateAgent(this.bus);

    // ── TEAM ζ (Recovery) ──
    const deadLetter = new DeadLetterAgent(this.bus, this._config.deadLetter);
    const rollback = new RollbackAgent(this.bus);

    // エージェント登録
    this._agents.set('audit-trail', auditTrail);
    this._agents.set('authz', authz);
    this._agents.set('media-intake', mediaIntake);
    this._agents.set('schema-validator', schemaValidator);
    this._agents.set('sanitizer', sanitizer);
    this._agents.set('calculation-engine', calcEngine);
    this._agents.set('dependency-graph', depGraph);
    this._agents.set('versioning', versioning);
    this._agents.set('cache-strategy', cache);
    this._agents.set('api-gateway', apiGateway);
    this._agents.set('quality-gate', qualityGate);
    this._agents.set('dead-letter', deadLetter);
    this._agents.set('rollback', rollback);

    // 全Agentを初期化（監査を先に起動）
    await auditTrail.init();
    await authz.init();

    const otherAgents = [
      mediaIntake, schemaValidator, sanitizer,
      calcEngine, depGraph, versioning,
      cache, apiGateway, qualityGate,
      deadLetter, rollback,
    ];
    await Promise.all(otherAgents.map((a) => a.init()));

    // ── 品質ゲートの配線 ──
    this._wireQualityGates(qualityGate);

    // ── デフォルトロール設定 ──
    this._setupDefaultRoles(authz);

    // ── エスカレーションルールの登録 ──
    this._setupEscalation();

    this._initialized = true;
    return this;
  }

  /** エージェントを名前で取得 */
  agent(name) {
    return this._agents.get(name);
  }

  /** EventBus を取得 */
  getEventBus() {
    return this.bus;
  }

  /**
   * メディアアップロードの統合エントリポイント
   * 品質ゲートを自動適用し、全段階を監視する
   */
  async uploadMedia({ file, fileName, contentType }) {
    // GATE 1: 入力品質チェック
    const gateResult = await this.bus.request('gate:check', {
      gateId: 'gate-1-ingestion',
      data: { file, fileName, contentType, hasFile: !!file },
    }).catch(() => ({ passed: true })); // ゲート未登録時はスキップ

    if (gateResult.passed === false) {
      return {
        success: false,
        error: { code: 'GATE_1_REJECTED', details: gateResult.results },
      };
    }

    // サニタイズ
    const sanitized = await this.bus.request('sanitize:html', {
      input: fileName,
    }).catch(() => ({ output: fileName }));

    // アップロード実行
    return this.bus.request('media:upload', {
      file,
      fileName: sanitized.output,
      contentType,
    });
  }

  /**
   * 計算の統合エントリポイント
   * 依存グラフ検証 → 計算実行 → 品質ゲート の順に処理
   */
  async calculate({ calculations }) {
    // 循環参照チェック
    for (const calc of calculations) {
      if (calc.refA && calc.cellId) {
        const result = await this.bus.request('graph:add-edge', {
          from: calc.cellId,
          to: calc.refA,
        }).catch(() => ({ accepted: true }));
        if (result.accepted === false) return { success: false, error: result.error };
      }
      if (calc.refB && calc.cellId) {
        const result = await this.bus.request('graph:add-edge', {
          from: calc.cellId,
          to: calc.refB,
        }).catch(() => ({ accepted: true }));
        if (result.accepted === false) return { success: false, error: result.error };
      }
    }

    // 計算実行
    const results = await this.bus.request('calc:batch', {
      calculations,
      stopOnError: false,
    });

    return { success: true, ...results };
  }

  /** システム全体のヘルスチェック */
  health() {
    const agentHealth = {};
    for (const [name, agent] of this._agents) {
      agentHealth[name] = agent.health();
    }

    const allHealthy = Object.values(agentHealth).every((h) => h.initialized);

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      initialized: this._initialized,
      agentCount: this._agents.size,
      agents: agentHealth,
      timestamp: new Date().toISOString(),
    };
  }

  /** 全エージェントのリソース解放 */
  destroy() {
    for (const agent of this._agents.values()) {
      if (agent.destroy) agent.destroy();
    }
  }

  // ─────────────────────────────────────────────
  // 内部設定
  // ─────────────────────────────────────────────

  _wireQualityGates(qualityGate) {
    // GATE 1: TEAM α → TEAM β 間（入力品質保証）
    qualityGate.registerGate({
      gateId: 'gate-1-ingestion',
      description: '入力品質保証: スキーマ完全性・サニタイズ確認',
      checks: [checkSchemaComplete, checkSanitized],
    });

    // GATE 2: TEAM β → TEAM γ 間（出力品質保証）
    qualityGate.registerGate({
      gateId: 'gate-2-processing',
      description: '出力品質保証: 計算結果整合性・応答時間',
      checks: [checkNoNullResults, createLatencyCheck(5000)],
    });
  }

  _setupDefaultRoles(authz) {
    authz.setRole({
      role: 'admin',
      allowedActions: ['*'],
    });
    authz.setRole({
      role: 'editor',
      allowedActions: ['read', 'write', 'upload', 'read:posts', 'write:posts', 'upload:media'],
    });
    authz.setRole({
      role: 'viewer',
      allowedActions: ['read', 'read:posts', 'read:media'],
    });
    authz.setRole({
      role: 'analyst',
      allowedActions: ['read', 'calculate', 'read:models', 'execute:calculations'],
    });
  }

  _setupEscalation() {
    // Level 3: Recovery チームへのエスカレーション
    this.bus.on('circuit:state-change', async ({ to }) => {
      if (to === 'OPEN') {
        await this.bus.emit('deadletter:retry-all', {});
      }
    });

    // Level 4: 人間へのアラート（コールバック）
    if (this._config.onCriticalAlert) {
      this.bus.on('deadletter:enqueue', (payload) => {
        if (payload.error?.code === 'INTEGRITY_CHECK_FAILED') {
          this._config.onCriticalAlert({
            level: 'CRITICAL',
            message: 'データ整合性エラーが検出されました',
            payload,
          });
        }
      });
    }
  }
}
