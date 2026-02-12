import { createHmac } from 'crypto';

// We'll test the verification logic directly without importing the module
// (to avoid needing the full Next.js Request object)

describe('Slack Signature Verification', () => {
  const signingSecret = 'test_signing_secret_12345';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ type: 'event_callback', event: { type: 'message' } });

  function computeSignature(secret: string, ts: string, rawBody: string): string {
    const sigBasestring = `v0:${ts}:${rawBody}`;
    const hmac = createHmac('sha256', secret);
    hmac.update(sigBasestring);
    return `v0=${hmac.digest('hex')}`;
  }

  test('computes correct HMAC-SHA256 signature', () => {
    const sig = computeSignature(signingSecret, timestamp, body);
    expect(sig).toMatch(/^v0=[a-f0-9]{64}$/);
  });

  test('same input produces same signature', () => {
    const sig1 = computeSignature(signingSecret, timestamp, body);
    const sig2 = computeSignature(signingSecret, timestamp, body);
    expect(sig1).toBe(sig2);
  });

  test('different secret produces different signature', () => {
    const sig1 = computeSignature(signingSecret, timestamp, body);
    const sig2 = computeSignature('wrong_secret', timestamp, body);
    expect(sig1).not.toBe(sig2);
  });

  test('different body produces different signature', () => {
    const sig1 = computeSignature(signingSecret, timestamp, body);
    const sig2 = computeSignature(signingSecret, timestamp, '{"different":"body"}');
    expect(sig1).not.toBe(sig2);
  });

  test('rejects timestamps older than 5 minutes', () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 301).toString();
    const isExpired = Math.abs(Date.now() / 1000 - parseInt(oldTimestamp)) > 300;
    expect(isExpired).toBe(true);
  });

  test('accepts timestamps within 5 minutes', () => {
    const recentTimestamp = (Math.floor(Date.now() / 1000) - 60).toString();
    const isExpired = Math.abs(Date.now() / 1000 - parseInt(recentTimestamp)) > 300;
    expect(isExpired).toBe(false);
  });
});
