/**
 * TEAM α — Ingestion & Validation（取り込み・検証チーム）
 *
 * ミッション: すべての入力を受け取り、後続チームが安全に処理できる状態を保証する
 *
 * 対策するミス:
 *   M1 — メディアアップロード失敗 (Media Intake Agent)
 *   M2 — XSS/インジェクション (Sanitizer Agent)
 *   M5 — スキーマ不整合 (Schema Validator Agent)
 *   F3 — 入力バリデーション不足 (Schema Validator Agent)
 */
import { BaseAgent } from '../core/base-agent.js';
import { CircuitBreaker } from '../core/circuit-breaker.js';

// ─────────────────────────────────────────────────
// MIME マジックバイト定義（拡張子偽装を防ぐ）
// ─────────────────────────────────────────────────
const MAGIC_BYTES = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png': [[0x89, 0x50, 0x4E, 0x47]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
  'video/mp4': {
    offset: 4,
    bytes: [
      [0x66, 0x74, 0x79, 0x70], // ftyp
    ],
  },
};

// ─────────────────────────────────────────────────
// Media Intake Agent — M1(メディアアップロード失敗)を根絶
// ─────────────────────────────────────────────────
export class MediaIntakeAgent extends BaseAgent {
  /**
   * @param {import('../core/event-bus.js').EventBus} eventBus
   * @param {Object} opts
   * @param {number} opts.maxFileSizeBytes      - ファイルサイズ上限 (default: 50MB)
   * @param {number} opts.chunkSizeBytes        - チャンクサイズ (default: 5MB)
   * @param {string[]} opts.allowedMimeTypes    - 許可MIME (default: 画像+PDF)
   * @param {number} opts.maxConcurrentUploads  - 同時アップロード数 (default: 3)
   * @param {Function} opts.storageAdapter      - ストレージ書き込み関数
   */
  constructor(eventBus, opts = {}) {
    super('media-intake', 'alpha-ingestion', eventBus);

    this.maxFileSizeBytes = opts.maxFileSizeBytes ?? 50 * 1024 * 1024;
    this.chunkSizeBytes = opts.chunkSizeBytes ?? 5 * 1024 * 1024;
    this.allowedMimeTypes = opts.allowedMimeTypes ?? [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
    ];
    this.maxConcurrentUploads = opts.maxConcurrentUploads ?? 3;
    this.storageAdapter = opts.storageAdapter ?? null;

    // サーキットブレーカー: アップロード先の障害から保護
    this._breaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      onStateChange: (change) => {
        this._log(`circuit breaker: ${change.from} → ${change.to}`, 'warn');
        this.bus.emit('circuit:state-change', {
          agent: this.name,
          ...change,
        });
      },
    });

    // アップロード進捗の追跡（中断再開用）
    this._activeUploads = new Map();
    this._currentConcurrency = 0;
    this._uploadQueue = [];
  }

  async init() {
    await super.init();
    this.bus.on('media:upload', (payload) => this.handleUpload(payload));
    this.bus.on('media:resume', (payload) => this.handleResume(payload));
    this.bus.on('media:abort', (payload) => this.handleAbort(payload));
  }

  /**
   * メインのアップロード処理 — 4段階防御
   * @param {Object} params
   * @param {File|Blob|ArrayBuffer} params.file
   * @param {string} params.fileName
   * @param {string} params.contentType
   * @param {string} [params.uploadId] - 再開用ID
   */
  async handleUpload({ file, fileName, contentType, uploadId }) {
    const uid = uploadId || this._generateUploadId();

    try {
      // ── STAGE 1: Pre-flight Check ──
      await this._preflight(file, fileName, contentType);

      // ── 同時アップロード制限 ──
      if (this._currentConcurrency >= this.maxConcurrentUploads) {
        return this._enqueue(uid, { file, fileName, contentType });
      }

      this._currentConcurrency++;

      // ── STAGE 2: Chunked Upload ──
      const chunks = await this._splitIntoChunks(file);
      const uploadState = {
        id: uid,
        fileName,
        contentType,
        totalChunks: chunks.length,
        completedChunks: 0,
        chunkHashes: [],
        status: 'in_progress',
        startedAt: Date.now(),
      };
      this._activeUploads.set(uid, uploadState);

      for (let i = 0; i < chunks.length; i++) {
        // 中断チェック
        if (this._activeUploads.get(uid)?.status === 'aborted') {
          throw new UploadAbortedError(uid);
        }

        const chunkHash = await this._hashChunk(chunks[i]);
        await this._uploadChunkWithRetry(uid, i, chunks[i], chunkHash);

        uploadState.completedChunks = i + 1;
        uploadState.chunkHashes.push(chunkHash);

        // 進捗イベント
        await this.bus.emit('media:progress', {
          uploadId: uid,
          progress: ((i + 1) / chunks.length * 100).toFixed(1),
          completedChunks: i + 1,
          totalChunks: chunks.length,
        });
      }

      // ── STAGE 3: Post-upload Validation ──
      const fullHash = await this._hashFull(file);
      await this._postUploadValidation(uid, fullHash, file);

      // 完了
      uploadState.status = 'completed';
      uploadState.completedAt = Date.now();
      this._activeUploads.delete(uid);
      this._recordSuccess();

      const result = {
        uploadId: uid,
        fileName,
        contentType,
        sizeBytes: file.byteLength ?? file.size,
        hash: fullHash,
        durationMs: uploadState.completedAt - uploadState.startedAt,
        status: 'completed',
      };

      await this.bus.emit('media:completed', result);
      return result;

    } catch (err) {
      this._recordError(err);

      // ── STAGE 4: Failure Recovery ──
      await this._handleFailure(uid, err);
      throw err;
    } finally {
      this._currentConcurrency = Math.max(0, this._currentConcurrency - 1);
      this._processQueue();
    }
  }

  /** 中断したアップロードを再開 */
  async handleResume({ uploadId }) {
    const state = this._activeUploads.get(uploadId);
    if (!state) {
      throw new Error(`No upload found with id: ${uploadId}`);
    }
    state.status = 'in_progress';
    this._log(`resuming upload ${uploadId} from chunk ${state.completedChunks}`);
    // 再開ロジックは実装先のstorageAdapterに依存
    return { uploadId, resumeFromChunk: state.completedChunks };
  }

  /** アップロード中断 */
  async handleAbort({ uploadId }) {
    const state = this._activeUploads.get(uploadId);
    if (state) {
      state.status = 'aborted';
      this._log(`upload ${uploadId} aborted`);
      await this.bus.emit('media:aborted', { uploadId });
    }
  }

  // ─────────────────────────────────────────────
  // STAGE 1: Pre-flight Check
  // ─────────────────────────────────────────────
  async _preflight(file, fileName, contentType) {
    const fileSize = file.byteLength ?? file.size ?? 0;

    // 1-1: ファイルサイズ検証
    if (fileSize === 0) {
      throw new ValidationError(
        'EMPTY_FILE',
        'ファイルが空です。有効なファイルを選択してください。'
      );
    }
    if (fileSize > this.maxFileSizeBytes) {
      const maxMB = (this.maxFileSizeBytes / 1024 / 1024).toFixed(0);
      const actualMB = (fileSize / 1024 / 1024).toFixed(1);
      throw new ValidationError(
        'FILE_TOO_LARGE',
        `ファイルサイズが上限を超えています（上限: ${maxMB}MB, 現在: ${actualMB}MB）。圧縮するか分割してください。`
      );
    }

    // 1-2: MIME タイプ検証（Content-Typeヘッダー）
    if (!this.allowedMimeTypes.includes(contentType)) {
      throw new ValidationError(
        'MIME_NOT_ALLOWED',
        `このファイル形式は許可されていません: ${contentType}。許可形式: ${this.allowedMimeTypes.join(', ')}`
      );
    }

    // 1-3: マジックバイト検証（拡張子偽装を防止）
    const detectedMime = await this._detectMimeByMagicBytes(file);
    if (detectedMime && detectedMime !== contentType) {
      throw new ValidationError(
        'MIME_MISMATCH',
        `ファイルの実際の形式(${detectedMime})が申告された形式(${contentType})と一致しません。ファイルが破損しているか、拡張子が偽装されている可能性があります。`
      );
    }

    // 1-4: ファイル名検証（パストラバーサル防止）
    if (/[\/\\:*?"<>|]/.test(fileName) || fileName.includes('..')) {
      throw new ValidationError(
        'INVALID_FILENAME',
        'ファイル名に使用できない文字が含まれています。'
      );
    }

    // 1-5: ストレージ容量チェック（アダプター提供時）
    if (this.storageAdapter?.checkCapacity) {
      const capacity = await this.storageAdapter.checkCapacity();
      if (capacity.availableBytes < fileSize) {
        throw new ValidationError(
          'STORAGE_FULL',
          `ストレージ容量が不足しています（必要: ${(fileSize / 1024 / 1024).toFixed(1)}MB, 空き: ${(capacity.availableBytes / 1024 / 1024).toFixed(1)}MB）`
        );
      }
    }

    this._log(`preflight passed: ${fileName} (${(fileSize / 1024).toFixed(1)}KB, ${contentType})`);
  }

  // ─────────────────────────────────────────────
  // STAGE 2: Chunked Upload
  // ─────────────────────────────────────────────
  async _splitIntoChunks(file) {
    const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    const chunks = [];
    for (let offset = 0; offset < buffer.byteLength; offset += this.chunkSizeBytes) {
      chunks.push(buffer.slice(offset, offset + this.chunkSizeBytes));
    }
    return chunks;
  }

  async _uploadChunkWithRetry(uploadId, chunkIndex, chunkData, chunkHash) {
    return this._withRetry(
      async (attempt) => {
        return this._breaker.execute(
          async () => {
            if (this.storageAdapter?.writeChunk) {
              return this.storageAdapter.writeChunk(uploadId, chunkIndex, chunkData, chunkHash);
            }
            // デフォルト: チャンクデータをイベントとして発行
            return this.bus.emit('storage:write-chunk', {
              uploadId,
              chunkIndex,
              chunkHash,
              sizeBytes: chunkData.byteLength,
            });
          },
          // サーキットブレーカーOPEN時のフォールバック
          () => {
            this._log(`circuit open, queuing chunk ${chunkIndex} for upload ${uploadId}`, 'warn');
            return { queued: true, uploadId, chunkIndex };
          }
        );
      },
      { maxRetries: 3, baseDelayMs: 2000, label: `chunk ${chunkIndex}/${uploadId}` }
    );
  }

  // ─────────────────────────────────────────────
  // STAGE 3: Post-upload Validation
  // ─────────────────────────────────────────────
  async _postUploadValidation(uploadId, fullHash, file) {
    const state = this._activeUploads.get(uploadId);
    if (!state) return;

    // ハッシュ整合性チェック
    if (this.storageAdapter?.verifyIntegrity) {
      const isValid = await this.storageAdapter.verifyIntegrity(uploadId, fullHash);
      if (!isValid) {
        throw new IntegrityError(
          `アップロード完了後のファイル整合性チェックに失敗しました (upload: ${uploadId})。再アップロードしてください。`
        );
      }
    }

    // メタデータ抽出 & EXIF除去（画像の場合）
    const contentType = state.contentType;
    if (contentType.startsWith('image/')) {
      await this.bus.emit('media:process-image', {
        uploadId,
        contentType,
        operations: ['strip-exif', 'generate-thumbnail', 'convert-webp'],
      });
    }

    this._log(`post-upload validation passed: ${uploadId}`);
  }

  // ─────────────────────────────────────────────
  // STAGE 4: Failure Recovery
  // ─────────────────────────────────────────────
  async _handleFailure(uploadId, error) {
    const state = this._activeUploads.get(uploadId);

    // Dead Letter Queue にエラー情報を保存
    await this.bus.emit('deadletter:enqueue', {
      source: this.name,
      uploadId,
      error: {
        code: error.code || 'UNKNOWN',
        message: error.message,
        stack: error.stack,
      },
      state: state ? { ...state, status: 'failed' } : null,
      timestamp: Date.now(),
    });

    // 部分アップロードの残骸をクリーンアップ予約（24h後）
    if (state) {
      state.status = 'failed';
      await this.bus.emit('cleanup:schedule', {
        uploadId,
        ttlMs: 24 * 60 * 60 * 1000,
        action: 'delete-partial-upload',
      });
    }

    this._log(`upload ${uploadId} failed, sent to dead letter queue: ${error.message}`, 'error');
  }

  // ─────────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────────
  async _detectMimeByMagicBytes(file) {
    const buffer = file instanceof ArrayBuffer
      ? new Uint8Array(file, 0, Math.min(12, file.byteLength))
      : new Uint8Array(await file.slice(0, 12).arrayBuffer());

    for (const [mime, spec] of Object.entries(MAGIC_BYTES)) {
      const offset = spec.offset || 0;
      const bytePatterns = spec.bytes || spec;

      for (const pattern of bytePatterns) {
        let match = true;
        for (let i = 0; i < pattern.length; i++) {
          if (buffer[offset + i] !== pattern[i]) {
            match = false;
            break;
          }
        }
        if (match) return mime;
      }
    }
    return null; // 不明な形式
  }

  async _hashChunk(chunk) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', chunk);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    // Node.js環境フォールバック
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(Buffer.from(chunk)).digest('hex');
  }

  async _hashFull(file) {
    const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    return this._hashChunk(buffer);
  }

  _generateUploadId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `upload_${time}_${rand}`;
  }

  _enqueue(uid, params) {
    this._log(`upload ${uid} queued (concurrency limit reached)`, 'warn');
    return new Promise((resolve, reject) => {
      this._uploadQueue.push({ uid, params, resolve, reject });
    });
  }

  async _processQueue() {
    if (this._uploadQueue.length === 0) return;
    if (this._currentConcurrency >= this.maxConcurrentUploads) return;

    const next = this._uploadQueue.shift();
    try {
      const result = await this.handleUpload({
        ...next.params,
        uploadId: next.uid,
      });
      next.resolve(result);
    } catch (err) {
      next.reject(err);
    }
  }
}

// ─────────────────────────────────────────────────
// Schema Validator Agent — M5, F3 を防止
// ─────────────────────────────────────────────────
export class SchemaValidatorAgent extends BaseAgent {
  constructor(eventBus) {
    super('schema-validator', 'alpha-ingestion', eventBus);
    this._schemas = new Map();
  }

  async init() {
    await super.init();
    this.bus.on('schema:validate', (payload) => this.validate(payload));
    this.bus.on('schema:register', (payload) => this.registerSchema(payload));
  }

  registerSchema({ name, schema }) {
    this._schemas.set(name, schema);
    this._log(`schema registered: ${name}`);
  }

  validate({ schemaName, data }) {
    const schema = this._schemas.get(schemaName);
    if (!schema) {
      throw new ValidationError('SCHEMA_NOT_FOUND', `スキーマ "${schemaName}" が登録されていません`);
    }

    const errors = this._validateObject(data, schema, '');
    if (errors.length > 0) {
      this._recordError(new Error(`Validation failed: ${errors.length} errors`));
      return { valid: false, errors };
    }

    this._recordSuccess();
    return { valid: true, errors: [] };
  }

  _validateObject(data, schema, path) {
    const errors = [];

    // required チェック
    if (schema.required) {
      for (const field of schema.required) {
        if (data[field] === undefined || data[field] === null) {
          errors.push({
            path: path ? `${path}.${field}` : field,
            code: 'REQUIRED',
            message: `必須フィールド "${field}" がありません`,
          });
        }
      }
    }

    // properties チェック
    if (schema.properties) {
      for (const [key, rule] of Object.entries(schema.properties)) {
        const value = data?.[key];
        const fieldPath = path ? `${path}.${key}` : key;

        if (value === undefined || value === null) continue;

        // 型チェック
        if (rule.type && !this._checkType(value, rule.type)) {
          errors.push({
            path: fieldPath,
            code: 'TYPE_MISMATCH',
            message: `"${fieldPath}" は ${rule.type} 型である必要があります（実際: ${typeof value}）`,
          });
          continue;
        }

        // 数値制約（F3: ゼロ除算・負値・境界値）
        if (rule.type === 'number') {
          if (rule.min !== undefined && value < rule.min) {
            errors.push({
              path: fieldPath,
              code: 'BELOW_MIN',
              message: `"${fieldPath}" は ${rule.min} 以上である必要があります（実際: ${value}）`,
            });
          }
          if (rule.max !== undefined && value > rule.max) {
            errors.push({
              path: fieldPath,
              code: 'ABOVE_MAX',
              message: `"${fieldPath}" は ${rule.max} 以下である必要があります（実際: ${value}）`,
            });
          }
          if (rule.nonZero && value === 0) {
            errors.push({
              path: fieldPath,
              code: 'ZERO_NOT_ALLOWED',
              message: `"${fieldPath}" にゼロは許可されていません（ゼロ除算防止）`,
            });
          }
        }

        // 文字列制約
        if (rule.type === 'string') {
          if (rule.maxLength && value.length > rule.maxLength) {
            errors.push({
              path: fieldPath,
              code: 'TOO_LONG',
              message: `"${fieldPath}" は ${rule.maxLength} 文字以下である必要があります`,
            });
          }
          if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
            errors.push({
              path: fieldPath,
              code: 'PATTERN_MISMATCH',
              message: `"${fieldPath}" がパターン ${rule.pattern} に一致しません`,
            });
          }
        }

        // ネストオブジェクト
        if (rule.type === 'object' && rule.properties) {
          errors.push(...this._validateObject(value, rule, fieldPath));
        }
      }
    }

    return errors;
  }

  _checkType(value, type) {
    switch (type) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number' && !Number.isNaN(value);
      case 'boolean': return typeof value === 'boolean';
      case 'array': return Array.isArray(value);
      case 'object': return typeof value === 'object' && !Array.isArray(value);
      default: return true;
    }
  }
}

// ─────────────────────────────────────────────────
// Sanitizer Agent — M2 (XSS/インジェクション) を防止
// ─────────────────────────────────────────────────
export class SanitizerAgent extends BaseAgent {
  constructor(eventBus) {
    super('sanitizer', 'alpha-ingestion', eventBus);
  }

  async init() {
    await super.init();
    this.bus.on('sanitize:html', (payload) => this.sanitizeHtml(payload));
    this.bus.on('sanitize:sql', (payload) => this.sanitizeSqlParam(payload));
  }

  sanitizeHtml({ input, allowedTags = [] }) {
    if (typeof input !== 'string') return { output: String(input) };

    const ALLOWED_SET = new Set(allowedTags);

    // Step 1: scriptタグとイベントハンドラを完全除去
    let output = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

    // Step 2: 許可されていないタグを除去
    output = output.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
      return ALLOWED_SET.has(tag.toLowerCase()) ? match : '';
    });

    // Step 3: javascript: プロトコルを除去
    output = output.replace(/javascript\s*:/gi, '');

    // Step 4: data: URIを除去（SVG経由のXSS防止）
    output = output.replace(/data\s*:[^,]*;base64/gi, '');

    this._recordSuccess();
    return { output, sanitized: output !== input };
  }

  sanitizeSqlParam({ input }) {
    if (typeof input !== 'string') return { output: String(input) };

    // パラメータ化クエリの使用を強く推奨するが、最低限のエスケープも提供
    const output = input
      .replace(/'/g, "''")
      .replace(/\\/g, '\\\\')
      .replace(/\0/g, '');

    this._recordSuccess();
    return {
      output,
      warning: 'パラメータ化クエリ（プリペアドステートメント）の使用を強く推奨します',
    };
  }
}

// ─────────────────────────────────────────────────
// カスタムエラー型
// ─────────────────────────────────────────────────
export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export class IntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntegrityError';
    this.code = 'INTEGRITY_CHECK_FAILED';
  }
}

export class UploadAbortedError extends Error {
  constructor(uploadId) {
    super(`Upload ${uploadId} was aborted`);
    this.name = 'UploadAbortedError';
    this.code = 'UPLOAD_ABORTED';
    this.uploadId = uploadId;
  }
}
