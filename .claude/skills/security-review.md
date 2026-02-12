---
description: "Security review checklist and procedures for the Slack AI Analysis Dashboard, covering token handling, signature verification, and data protection"
disable-model-invocation: true
arguments:
  - name: scope
    description: "Focus area for review: tokens, oauth, events, data, or all"
    required: false
---

# Security Review

## Purpose
Guide security reviews of the Slack AI Analysis Dashboard, covering token encryption, request verification, data handling, and threat mitigations.

## Reference Documents
- Threat model: `docs/threat-model.md`
- Security checklist: `docs/security-checklist.md`

## Token Encryption

### Implementation (`src/lib/crypto/tokens.ts`)
- Algorithm: AES-256-GCM
- Key: 32-byte key from TOKEN_ENCRYPTION_KEY env var (64 hex chars)
- IV: Random 12 bytes per encryption operation
- Storage format: base64(IV + AuthTag + Ciphertext)
- Tokens encrypted: Slack bot_token, user_token

### Review Points
- [ ] TOKEN_ENCRYPTION_KEY is 64 hex characters (32 bytes)
- [ ] Each encryption uses a fresh random IV
- [ ] Auth tag is verified during decryption
- [ ] Decrypted tokens are never logged
- [ ] Decrypted tokens are never included in API responses
- [ ] Key rotation procedure documented

### Key Rotation
1. Generate new key: `openssl rand -hex 32`
2. Decrypt all tokens with old key
3. Re-encrypt all tokens with new key
4. Update TOKEN_ENCRYPTION_KEY in environment
5. Deploy and verify

## Slack Signature Verification

### Implementation (`src/lib/slack/verify.ts`)
- Algorithm: HMAC-SHA256
- Input: `v0:{timestamp}:{body}`
- Compares against `X-Slack-Signature` header
- Validates timestamp within 5 minutes (prevents replay)
- Uses `crypto.timingSafeEqual` (prevents timing attacks)

### Review Points
- [ ] All Slack-facing endpoints verify signatures
- [ ] Timestamp window is 5 minutes or less
- [ ] Uses timing-safe comparison
- [ ] Raw body is preserved for verification (not parsed then re-serialized)

## OAuth Security

### Implementation (`src/lib/crypto/state.ts`, `src/app/api/slack/oauth/`)
- State parameter: Random UUID with HMAC signature
- Stored in HTTP-only cookie during OAuth flow
- Validated on callback before token exchange

### Review Points
- [ ] State parameter is cryptographically random
- [ ] State is validated before code exchange
- [ ] Redirect URI is validated
- [ ] HTTPS enforced for redirect URIs in production

## QStash Verification

### Implementation (`src/app/api/slack/events/process/route.ts`)
- Verifies QStash signatures on incoming webhook calls
- Uses QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY

### Review Points
- [ ] All queue worker endpoints verify QStash signatures
- [ ] Both current and next signing keys are checked
- [ ] Unsigned requests are rejected in production

## Data Protection

### PII Handling
- Slack messages contain user-generated content (PII)
- User names and IDs are stored for display purposes
- No content is shared with third parties (LLM usage is user-initiated copy/paste)

### Log Sanitization
- Never log: tokens, encryption keys, message content
- Safe to log: workspace IDs, channel IDs, message timestamps, event IDs
- Use structured logging with explicit field allowlists

### Data Retention
- Default retention: 90 days for messages
- Configurable per workspace
- Hard delete (not soft delete) for compliance
- Cascade: workspace deletion removes all associated data

### Deletion Policy
- User requests: delete within 30 days
- Workspace disconnect: offer immediate data purge
- Scheduled cleanup: cron job for expired data (future enhancement)

## Steps
1. Run through all review points above based on scope
2. Check environment variable configuration
3. Verify no secrets in code, logs, or responses
4. Test signature verification with known-good and known-bad requests
5. Verify token encryption/decryption roundtrip
6. Check for OWASP Top 10 vulnerabilities in API routes

## Checklist
- [ ] All tokens encrypted at rest with AES-256-GCM
- [ ] Slack signatures verified on all incoming webhooks
- [ ] OAuth state parameter validated
- [ ] QStash signatures verified on worker endpoints
- [ ] No secrets in logs, responses, or client-side code
- [ ] HTTPS enforced in production
- [ ] Database connections use SSL
- [ ] Rate limiting on public endpoints
- [ ] Input validation on all API routes
- [ ] CORS configured appropriately

## Troubleshooting

### Signature verification fails
- Check SLACK_SIGNING_SECRET matches app settings
- Ensure raw body is used (not parsed JSON re-serialized)
- Verify server clock is synchronized (NTP)

### Token decryption fails
- Verify TOKEN_ENCRYPTION_KEY hasn't changed since encryption
- Check for encoding issues (base64)
- Ensure the encrypted value wasn't truncated in storage

### Audit log review
- Check application logs for: failed signature verifications, failed decryption attempts, unauthorized access attempts
- Monitor QStash dashboard for delivery failures
- Review Slack app activity logs at api.slack.com
