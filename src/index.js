/**
 * Agent Teams — 統合エントリポイント
 *
 * Blog CMS / Financial Model の繰り返しミスを根絶する
 * マルチエージェントチームシステム
 *
 * 使い方:
 *   import { createAgentSystem } from './src/index.js';
 *
 *   const system = await createAgentSystem({ ... });
 *   await system.uploadMedia({ file, fileName, contentType });
 *   await system.calculate({ calculations: [...] });
 */

// ── Core ──
export { EventBus } from './core/event-bus.js';
export { CircuitBreaker, CircuitBreakerState, CircuitBreakerOpenError } from './core/circuit-breaker.js';
export { BaseAgent } from './core/base-agent.js';

// ── TEAM α: Ingestion ──
export {
  MediaIntakeAgent,
  SchemaValidatorAgent,
  SanitizerAgent,
  ValidationError,
  IntegrityError,
  UploadAbortedError,
} from './teams/alpha-ingestion.js';

// ── TEAM β: Processing ──
export {
  CalculationEngineAgent,
  DependencyGraphAgent,
  VersioningAgent,
  Decimal,
  CalculationError,
} from './teams/beta-processing.js';

// ── TEAM γ: Delivery ──
export { CacheStrategyAgent, ApiGatewayAgent } from './teams/gamma-delivery.js';

// ── TEAM δ: Quality Gate ──
export {
  QualityGateAgent,
  checkSchemaComplete,
  checkSanitized,
  checkNoNullResults,
  createLatencyCheck,
} from './teams/delta-quality-gate.js';

// ── TEAM ε: Security ──
export { AuditTrailAgent, AuthZAgent } from './teams/epsilon-security.js';

// ── TEAM ζ: Recovery ──
export { DeadLetterAgent, RollbackAgent } from './teams/zeta-recovery.js';

// ── Orchestrator ──
export { Orchestrator } from './orchestrator.js';

/**
 * 推奨: ワンライナーでシステム全体を起動
 *
 * @param {Object} config
 * @param {Object} [config.mediaIntake]   - MediaIntakeAgent設定
 * @param {Object} [config.cache]         - CacheStrategyAgent設定
 * @param {Object} [config.deadLetter]    - DeadLetterAgent設定
 * @param {Object} [config.audit]         - AuditTrailAgent設定
 * @param {Function} [config.onCriticalAlert] - 致命的アラート時のコールバック
 * @returns {Promise<Orchestrator>}
 */
export async function createAgentSystem(config = {}) {
  const orchestrator = new Orchestrator(config);
  await orchestrator.init();
  return orchestrator;
}
