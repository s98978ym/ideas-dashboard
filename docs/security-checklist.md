# Security Checklist for Deployment

This checklist ensures all security measures are in place before deploying the Slack AI Analysis Dashboard to production.

**Last Updated:** 2026-02-12

---

## Environment Variables

### Required Variables

- [ ] `DATABASE_URL` - PostgreSQL connection string with SSL enabled
- [ ] `TOKEN_ENCRYPTION_KEY` - 64-character hex string (32 bytes)
  - Generate with: `openssl rand -hex 32`
  - Store securely in secrets manager
  - Never commit to version control
- [ ] `SLACK_CLIENT_ID` - From Slack app configuration
- [ ] `SLACK_CLIENT_SECRET` - From Slack app configuration
- [ ] `SLACK_SIGNING_SECRET` - From Slack app configuration
- [ ] `QSTASH_CURRENT_SIGNING_KEY` - From Upstash QStash dashboard
- [ ] `QSTASH_NEXT_SIGNING_KEY` - From Upstash QStash dashboard
- [ ] `QSTASH_URL` - QStash endpoint URL

### Optional but Recommended

- [ ] `NODE_ENV=production` - Enables production optimizations
- [ ] `NEXTAUTH_SECRET` - For future authentication (generate with: `openssl rand -base64 32`)
- [ ] `NEXTAUTH_URL` - Full URL of deployment (e.g., https://app.example.com)

### Verification Commands

```bash
# Verify TOKEN_ENCRYPTION_KEY format
echo $TOKEN_ENCRYPTION_KEY | grep -E '^[0-9a-fA-F]{64}$' && echo "✅ Valid" || echo "❌ Invalid"

# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Verify all required env vars are set
node -e "
const required = ['DATABASE_URL', 'TOKEN_ENCRYPTION_KEY', 'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_SIGNING_SECRET'];
const missing = required.filter(v => !process.env[v]);
if (missing.length) {
  console.error('❌ Missing:', missing.join(', '));
  process.exit(1);
} else {
  console.log('✅ All required variables set');
}
"
```

---

## Encryption and Secrets

### Key Management

- [ ] TOKEN_ENCRYPTION_KEY rotated from development key
- [ ] Encryption key stored in secure secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault)
- [ ] Key rotation procedure documented
- [ ] Backup encryption key stored in separate secure location
- [ ] No secrets in environment files committed to git
- [ ] `.env` files in `.gitignore`

### Key Rotation Process (when needed)

1. Generate new key: `openssl rand -hex 32`
2. Set as `TOKEN_ENCRYPTION_KEY_NEW` in environment
3. Run migration script to re-encrypt all tokens
4. Swap keys: rename `TOKEN_ENCRYPTION_KEY_NEW` to `TOKEN_ENCRYPTION_KEY`
5. Restart application
6. Verify all tokens decrypt successfully
7. Securely delete old key

---

## Database Security

### Connection Security

- [ ] PostgreSQL connection uses SSL/TLS
- [ ] Database URL contains `?sslmode=require`
- [ ] Database user has minimal required permissions
- [ ] Database connection pool limits configured
- [ ] Connection timeout configured (e.g., 10 seconds)

### Database User Permissions

```sql
-- Database user should have these permissions ONLY:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Database user should NOT have:
-- - CREATE/DROP DATABASE
-- - SUPERUSER
-- - CREATE ROLE
```

### Backup and Recovery

- [ ] Automated daily backups configured
- [ ] Backups encrypted at rest
- [ ] Backup retention policy: 30 days
- [ ] Recovery procedure tested
- [ ] Point-in-time recovery enabled

---

## HTTPS and Network Security

### SSL/TLS Configuration

- [ ] HTTPS enforced on all routes
- [ ] HTTP redirects to HTTPS (301 Permanent Redirect)
- [ ] Valid SSL certificate installed
- [ ] Certificate auto-renewal configured
- [ ] TLS 1.2 or higher enforced
- [ ] Weak ciphers disabled

### Headers and Policies

- [ ] `Strict-Transport-Security` header set (HSTS)
  ```
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  ```
- [ ] `X-Frame-Options: DENY` header set
- [ ] `X-Content-Type-Options: nosniff` header set
- [ ] `X-XSS-Protection: 1; mode=block` header set
- [ ] Content Security Policy (CSP) configured
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'
  ```
- [ ] CORS configured with specific allowed origins (not `*`)

### Next.js Configuration

Add to `next.config.ts`:

```typescript
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          }
        ]
      }
    ];
  },
  async redirects() {
    if (process.env.NODE_ENV === 'production') {
      return [
        {
          source: '/:path*',
          has: [{ type: 'header', key: 'x-forwarded-proto', value: 'http' }],
          destination: 'https://:path*',
          permanent: true
        }
      ];
    }
    return [];
  }
};
```

---

## Logging and Monitoring

### Log Safety

- [ ] No tokens logged (encrypted or decrypted)
- [ ] No passwords logged
- [ ] PII minimized in logs
- [ ] Error messages don't expose internal details in production
- [ ] Log sanitization function applied to all message content

### Log Sanitization Example

```typescript
// src/lib/logger.ts
export function sanitizeForLogs(obj: any): any {
  const sanitized = { ...obj };
  const sensitiveKeys = ['token', 'password', 'secret', 'key', 'encrypted'];

  for (const key in sanitized) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}
```

### Monitoring

- [ ] Application error tracking (e.g., Sentry, Rollbar)
- [ ] Database query performance monitoring
- [ ] API endpoint response time tracking
- [ ] Queue job failure alerts
- [ ] Disk space and memory monitoring
- [ ] Failed login attempt tracking (when auth implemented)

### Alerts

- [ ] Alert on repeated Slack signature verification failures
- [ ] Alert on failed token decryption attempts
- [ ] Alert on database connection failures
- [ ] Alert on queue job failure rate >10%
- [ ] Alert on API error rate >5%

---

## Rate Limiting

### Configuration

- [ ] Rate limiting middleware installed
- [ ] Per-IP rate limits configured
  - Public endpoints: 60 requests/minute
  - API endpoints: 300 requests/minute
  - Webhook endpoints: 1000 requests/minute
- [ ] Per-workspace rate limits (future)
- [ ] Rate limit headers returned (`X-RateLimit-*`)
- [ ] 429 Too Many Requests response configured

### Implementation Example

```typescript
// middleware.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, '1 m'),
});

export async function middleware(request: NextRequest) {
  const ip = request.ip ?? '127.0.0.1';
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return new Response('Too Many Requests', { status: 429 });
  }

  return NextResponse.next();
}
```

---

## Input Validation

### API Endpoints

- [ ] All user inputs validated
- [ ] Type checking on all parameters
- [ ] Length limits on text fields
- [ ] Email validation where applicable
- [ ] URL validation where applicable
- [ ] SQL injection prevention (using Prisma)
- [ ] XSS prevention (React escapes by default)

### Validation Rules

```typescript
// Draft text: max 4000 characters (Slack limit)
// TODO title: max 500 characters
// TODO description: max 2000 characters
// Channel name: max 80 characters
// User ID: alphanumeric + underscore only
```

---

## Slack Integration Security

### Webhook Verification

- [ ] All webhook requests verify Slack signature
- [ ] Timestamp validation (reject >5 minutes old)
- [ ] Event deduplication using event_id
- [ ] Retry handling (idempotent operations)

### Signature Verification Example

```typescript
import crypto from 'crypto';

export function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET!;
  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');
  const expectedSig = `v0=${hmac}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSig)
  );
}
```

### OAuth Security

- [ ] OAuth state parameter validated
- [ ] State parameter has expiration (10 minutes)
- [ ] CSRF protection enabled
- [ ] Redirect URI validation
- [ ] Token exchange over HTTPS only
- [ ] No tokens in URL parameters

---

## Dependency Security

### npm Packages

- [ ] Run `npm audit` and fix all high/critical vulnerabilities
- [ ] Use `npm audit fix` for automated fixes
- [ ] Review manual fix requirements
- [ ] Pin major versions in package.json
- [ ] Regular dependency updates scheduled (monthly)

### Automated Security Scanning

- [ ] Dependabot enabled on GitHub
- [ ] Snyk or similar security scanning tool configured
- [ ] Pre-commit hooks for security checks
- [ ] CI/CD pipeline includes security scan

### Commands

```bash
# Audit dependencies
npm audit

# Fix automatically
npm audit fix

# Check for outdated packages
npm outdated

# Update dependencies safely
npm update
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing
- [ ] Security scan clean (no high/critical vulnerabilities)
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] SSL certificate valid
- [ ] Monitoring and alerting configured
- [ ] Backup and recovery tested

### Deployment

- [ ] Deploy to staging first
- [ ] Run smoke tests on staging
- [ ] Verify token encryption/decryption works
- [ ] Test OAuth flow end-to-end
- [ ] Test webhook reception
- [ ] Verify queue jobs process
- [ ] Check logs for errors

### Post-Deployment

- [ ] Monitor error rates for 24 hours
- [ ] Verify backups running
- [ ] Test rollback procedure
- [ ] Document deployment process
- [ ] Update runbook with any issues encountered

---

## Ongoing Security Maintenance

### Weekly

- [ ] Review error logs for security anomalies
- [ ] Check rate limit violations
- [ ] Review failed authentication attempts (when auth implemented)

### Monthly

- [ ] Update dependencies
- [ ] Review access logs
- [ ] Test backup restoration
- [ ] Review and rotate API keys if needed

### Quarterly

- [ ] Security audit
- [ ] Penetration testing (if budget allows)
- [ ] Review and update threat model
- [ ] Disaster recovery drill
- [ ] Update security documentation

### Annually

- [ ] Rotate TOKEN_ENCRYPTION_KEY
- [ ] Review all third-party integrations
- [ ] Update SSL certificates (if not auto-renewed)
- [ ] Comprehensive security review

---

## Emergency Procedures

### Security Incident

1. Immediately disable affected workspace(s)
2. Rotate all potentially compromised secrets
3. Review logs for extent of breach
4. Notify affected users within 72 hours (GDPR requirement)
5. Document incident and response
6. Implement fixes to prevent recurrence

### Token Compromise

1. Revoke workspace OAuth token via Slack API
2. Rotate TOKEN_ENCRYPTION_KEY
3. Re-encrypt all remaining tokens
4. Force workspace to re-authenticate
5. Audit all API calls made with compromised token

### Database Breach

1. Immediately isolate database
2. Rotate all database credentials
3. Export and analyze breach scope
4. Notify all affected workspaces
5. Provide data export to affected users
6. Implement additional security controls

---

## Sign-Off

Before deploying to production, all items above must be checked off and verified by:

- [ ] **Developer:** ___________________ Date: ___________
- [ ] **Security Lead:** ___________________ Date: ___________
- [ ] **DevOps:** ___________________ Date: ___________

---

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Slack Security Best Practices](https://api.slack.com/authentication/best-practices)
- [Next.js Security Headers](https://nextjs.org/docs/advanced-features/security-headers)
- [PostgreSQL Security](https://www.postgresql.org/docs/current/security.html)
