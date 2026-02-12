# Threat Model - Slack AI Analysis Dashboard

## Overview

This document outlines the security threat model for the Slack AI Analysis Dashboard, identifying assets, threat actors, attack vectors, and corresponding mitigations.

**Last Updated:** 2026-02-12

---

## Assets

### Critical Assets

1. **Slack OAuth Tokens**
   - Bot tokens (xoxb-*)
   - User tokens (xoxp-*)
   - Provide full access to Slack workspace data
   - Stored encrypted in database

2. **Message Content**
   - Slack messages, threads, and DMs
   - May contain sensitive business information, PII, or trade secrets
   - Stored in PostgreSQL database

3. **User Data**
   - User IDs, names, email addresses (if available)
   - Inbox preferences and notifications
   - Draft messages and TODO items

4. **Workspace Configuration**
   - Team IDs and workspace names
   - Channel monitoring settings
   - OAuth scopes and permissions

5. **Encryption Keys**
   - TOKEN_ENCRYPTION_KEY (32-byte AES-256 key)
   - SLACK_SIGNING_SECRET
   - Database credentials

---

## Threat Actors

### External Attackers

- **Motivation:** Steal Slack tokens, access private messages, exfiltrate data
- **Capabilities:** Network attacks, SQL injection, XSS, CSRF, API exploitation
- **Impact:** High - could compromise entire Slack workspace

### Malicious Insiders

- **Motivation:** Access unauthorized messages, steal tokens, sabotage system
- **Capabilities:** Database access, code access, system administrator privileges
- **Impact:** High - could bypass many security controls

### Compromised Dependencies

- **Motivation:** Supply chain attack via npm packages
- **Capabilities:** Arbitrary code execution, data exfiltration
- **Impact:** Critical - could compromise all assets

### Automated Bots/Crawlers

- **Motivation:** Exploit vulnerabilities, DDoS, credential stuffing
- **Capabilities:** High-volume automated requests
- **Impact:** Medium - service disruption, resource exhaustion

---

## Attack Vectors and Mitigations

### 1. Token Theft

**Attack Scenarios:**
- Database breach exposing encrypted tokens
- Memory dump of running process
- Log file exposure containing decrypted tokens
- Man-in-the-middle attack on Slack API calls

**Mitigations:**
- ✅ **AES-256-GCM encryption at rest** - All tokens encrypted in database
- ✅ **12-byte random IV per encryption** - Prevents pattern analysis
- ✅ **Authentication tags** - Detects tampering
- ✅ **Never log decrypted tokens** - Sanitize all log output
- ✅ **TLS for all external communications** - Encrypt data in transit
- ✅ **Key rotation capability** - TOKEN_ENCRYPTION_KEY can be rotated
- ✅ **Minimal token decryption** - Decrypt only when needed, discard immediately
- ⚠️ **TODO:** Implement automatic token refresh
- ⚠️ **TODO:** Add token usage monitoring and alerting

### 2. Request Forgery (CSRF/SSRF)

**Attack Scenarios:**
- Attacker tricks user into making unauthorized API calls
- Malicious OAuth redirect
- Forged Slack event webhooks

**Mitigations:**
- ✅ **OAuth state parameter** - HMAC-signed, time-limited (10 minutes)
- ✅ **Slack signature verification** - Verify X-Slack-Signature on all webhooks
- ✅ **Timestamp validation** - Reject events older than 5 minutes
- ✅ **Event deduplication** - Store event_id to prevent replay
- ✅ **SameSite cookies** - Set to 'lax' or 'strict'
- ✅ **HTTPS enforcement** - Redirect HTTP to HTTPS in production

### 3. SQL Injection

**Attack Scenarios:**
- Attacker injects SQL via user input
- Malicious filters in API queries
- Second-order SQL injection via stored data

**Mitigations:**
- ✅ **Prisma ORM** - Parameterized queries by default
- ✅ **Input validation** - Validate all user inputs
- ✅ **Type checking** - TypeScript enforces types
- ✅ **Principle of least privilege** - Database user has minimal permissions
- ⚠️ **TODO:** Implement database connection encryption (SSL)

### 4. Replay Attacks

**Attack Scenarios:**
- Replay captured Slack webhook events
- Reuse stolen OAuth state parameters
- Duplicate message processing

**Mitigations:**
- ✅ **Timestamp validation** - Reject events older than 5 minutes
- ✅ **Event ID deduplication** - Store and check event_id
- ✅ **OAuth state expiration** - 10-minute TTL on state parameters
- ✅ **Nonce in state generation** - Cryptographically random state

### 5. PII and Sensitive Data Exposure

**Attack Scenarios:**
- Logs contain user messages or tokens
- API responses leak encrypted tokens
- Error messages expose internal details
- Browser console/network tab reveals sensitive data

**Mitigations:**
- ✅ **Log sanitization** - Never log tokens, minimize message content
- ✅ **API response filtering** - Never return encrypted_bot_token or encrypted_user_token
- ✅ **Production error handling** - Generic error messages in production
- ✅ **No raw_json by default** - Slack raw payload only returned if explicitly requested
- ✅ **HTTPS enforcement** - All traffic encrypted
- ⚠️ **TODO:** Implement PII detection and redaction
- ⚠️ **TODO:** Add audit logging for sensitive operations

### 6. Denial of Service (DoS)

**Attack Scenarios:**
- Flood API endpoints with requests
- Large message backfill exhausting resources
- Webhook spam from compromised Slack app

**Mitigations:**
- ✅ **Pagination limits** - Max 1000 items per request
- ✅ **Query timeouts** - Database query limits
- ⚠️ **TODO:** Rate limiting per IP/workspace
- ⚠️ **TODO:** Request size limits
- ⚠️ **TODO:** Queue-based processing for heavy operations

### 7. Queue Poisoning (QStash)

**Attack Scenarios:**
- Attacker sends forged queue messages
- Malicious payload in scheduled jobs
- Queue flooding

**Mitigations:**
- ✅ **QStash signature verification** - Verify all incoming queue messages
- ✅ **Payload validation** - Validate job structure and types
- ✅ **Job retry limits** - Max 3 attempts per job
- ⚠️ **TODO:** Implement job payload encryption
- ⚠️ **TODO:** Add job execution timeout

### 8. Cross-Site Scripting (XSS)

**Attack Scenarios:**
- Malicious Slack message content rendered in UI
- Stored XSS via user-generated content
- DOM-based XSS in React components

**Mitigations:**
- ✅ **React default escaping** - React escapes by default
- ✅ **Content Security Policy** - Restrict script sources
- ✅ **No dangerouslySetInnerHTML** - Avoid unsafe HTML rendering
- ⚠️ **TODO:** Implement CSP headers
- ⚠️ **TODO:** Sanitize Slack message formatting before rendering

### 9. Authentication and Authorization

**Attack Scenarios:**
- Unauthorized access to other workspaces' data
- Privilege escalation
- Session hijacking

**Mitigations:**
- ✅ **Workspace isolation** - All queries scoped to workspace_id
- ✅ **Foreign key constraints** - Database enforces relationships
- ⚠️ **TODO:** Implement user authentication (NextAuth.js)
- ⚠️ **TODO:** Add RBAC for multi-user access
- ⚠️ **TODO:** Implement session management
- ⚠️ **TODO:** Add audit trail for privileged operations

---

## Data Retention and Deletion

### Retention Policies

1. **Messages:** Retained indefinitely unless workspace uninstalled
2. **Inbox Items:** Retained for 90 days after archival
3. **Drafts:** Retained for 30 days after sent/copied
4. **TODOs:** Retained indefinitely unless manually deleted
5. **Queue Jobs:** Deleted after 7 days (completed or failed)

### Deletion Procedures

**Workspace Uninstall:**
- All workspace data deleted via CASCADE constraints
- Encrypted tokens overwritten before deletion
- Audit log entry created

**User Data Export:**
- ⚠️ **TODO:** Implement GDPR-compliant data export
- ⚠️ **TODO:** Add user-initiated data deletion

**Secure Deletion:**
- Database uses VACUUM to reclaim space
- Backups encrypted and rotated every 30 days

---

## Incident Response

### Detection

- Monitor for unusual token usage patterns
- Alert on repeated failed decryption attempts
- Log all Slack signature verification failures
- Track rate of queue job failures

### Response Procedures

1. **Token Compromise Suspected:**
   - Immediately revoke workspace access
   - Rotate TOKEN_ENCRYPTION_KEY
   - Notify workspace admin
   - Re-encrypt all tokens with new key

2. **Data Breach:**
   - Identify scope of breach
   - Notify affected workspaces
   - Rotate all secrets
   - Review and patch vulnerability

3. **DoS Attack:**
   - Enable rate limiting
   - Block offending IPs
   - Scale infrastructure
   - Contact hosting provider

### Communication

- Maintain security contact email
- Document all incidents
- Post-mortem after major incidents
- Quarterly security reviews

---

## Compliance Considerations

### GDPR (if applicable)
- Right to access: Export user data
- Right to erasure: Delete user data on request
- Data minimization: Only store necessary data
- Encryption at rest and in transit

### SOC 2 (future consideration)
- Access controls
- Encryption requirements
- Audit logging
- Incident response procedures

---

## Security Contacts

- **Security Issues:** security@example.com
- **Bug Bounty:** (Not currently available)
- **Responsible Disclosure:** 90-day disclosure policy

---

## Changelog

- **2026-02-12:** Initial threat model created
