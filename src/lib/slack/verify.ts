/**
 * Slack Request Signature Verification
 *
 * Verifies that incoming requests from Slack are authentic using HMAC-SHA256.
 * Reference: https://api.slack.com/authentication/verifying-requests-from-slack
 */

import { createHmac, timingSafeEqual } from 'crypto';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Verify Slack request signature
 *
 * Validates that the request came from Slack by checking the signature
 * and timestamp headers. Rejects requests older than 5 minutes to prevent
 * replay attacks.
 *
 * @param req - Request object with headers and body
 * @returns Object with validity flag and raw body string
 */
export async function verifySlackSignature(
  req: Request
): Promise<{ valid: boolean; body: string }> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    console.error('[Slack] SLACK_SIGNING_SECRET not configured');
    return { valid: false, body: '' };
  }

  // Get signature and timestamp from headers
  const slackSignature = req.headers.get('x-slack-signature');
  const timestamp = req.headers.get('x-slack-request-timestamp');

  if (!slackSignature || !timestamp) {
    console.error('[Slack] Missing signature or timestamp headers');
    return { valid: false, body: '' };
  }

  // Check if request is too old (prevent replay attacks)
  const requestTime = parseInt(timestamp, 10) * 1000; // Convert to milliseconds
  const currentTime = Date.now();

  if (Math.abs(currentTime - requestTime) > FIVE_MINUTES_MS) {
    console.error(
      '[Slack] Request timestamp too old or too far in future:',
      new Date(requestTime).toISOString()
    );
    return { valid: false, body: '' };
  }

  // Read the raw body (can only be read once)
  const rawBody = await req.text();

  // Construct the signature base string
  const sigBaseString = `v0:${timestamp}:${rawBody}`;

  // Compute the expected signature
  const hmac = createHmac('sha256', signingSecret);
  hmac.update(sigBaseString, 'utf8');
  const expectedSignature = `v0=${hmac.digest('hex')}`;

  // Use timing-safe comparison to prevent timing attacks
  const signatureBuffer = Buffer.from(slackSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  // Ensure buffers are the same length before comparing
  if (signatureBuffer.length !== expectedBuffer.length) {
    console.error('[Slack] Signature length mismatch');
    return { valid: false, body: rawBody };
  }

  const valid = timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!valid) {
    console.error('[Slack] Signature verification failed');
    console.error('  Expected:', expectedSignature);
    console.error('  Received:', slackSignature);
  }

  return { valid, body: rawBody };
}

/**
 * Extract event ID from Slack event payload
 * Used for deduplication
 */
export function getEventId(payload: any): string | null {
  if (payload.event?.event_id) {
    return payload.event.event_id;
  }
  if (payload.event_id) {
    return payload.event_id;
  }
  return null;
}

/**
 * Check if this is a retry attempt
 * Slack includes x-slack-retry-num and x-slack-retry-reason headers
 */
export function isRetryAttempt(req: Request): boolean {
  const retryNum = req.headers.get('x-slack-retry-num');
  return retryNum !== null && parseInt(retryNum, 10) > 0;
}

/**
 * Get retry information from headers
 */
export function getRetryInfo(req: Request): {
  retryNum: number;
  retryReason: string | null;
} {
  const retryNum = parseInt(req.headers.get('x-slack-retry-num') || '0', 10);
  const retryReason = req.headers.get('x-slack-retry-reason');

  return { retryNum, retryReason };
}
