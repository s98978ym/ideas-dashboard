/**
 * OAuth State Parameter Management
 *
 * Generates and validates OAuth state parameters for CSRF protection.
 * Uses HMAC-SHA256 to sign state values that are stored in cookies.
 *
 * Security features:
 * - Random state generation
 * - HMAC-SHA256 signing with derived key
 * - Timestamp-based expiration
 * - Constant-time comparison
 */

import crypto from 'crypto';

const STATE_LENGTH = 32; // 32 bytes = 256 bits
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Derive a signing key from the encryption key
 * This ensures state signing uses a different key than token encryption
 */
function getStateSigningKey(): Buffer {
  const encryptionKeyHex = process.env.TOKEN_ENCRYPTION_KEY;

  if (!encryptionKeyHex) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY environment variable is not set. ' +
      'Required for OAuth state signing.'
    );
  }

  // Derive a separate key using HKDF (HMAC-based Key Derivation Function)
  const encryptionKey = Buffer.from(encryptionKeyHex, 'hex');
  const info = Buffer.from('oauth-state-signing', 'utf8');

  // Simple HKDF implementation using HMAC
  return crypto.createHmac('sha256', encryptionKey).update(info).digest();
}

/**
 * Generate a signed OAuth state parameter
 *
 * @returns Object containing state and signed cookie value
 */
export function generateOAuthState(): { state: string; cookie: string } {
  // Generate random state
  const state = crypto.randomBytes(STATE_LENGTH).toString('base64url');

  // Create timestamp
  const timestamp = Date.now();

  // Create signed value: state:timestamp:signature
  const signingKey = getStateSigningKey();
  const message = `${state}:${timestamp}`;
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(message)
    .digest('base64url');

  const cookie = `${state}:${timestamp}:${signature}`;

  return { state, cookie };
}

/**
 * Validate OAuth state against signed cookie value
 *
 * @param state - The state parameter from OAuth callback
 * @param cookieValue - The signed cookie value from generateOAuthState()
 * @returns true if valid and not expired, false otherwise
 */
export function validateOAuthState(
  state: string,
  cookieValue: string
): boolean {
  if (!state || !cookieValue) {
    return false;
  }

  try {
    // Parse cookie: state:timestamp:signature
    const parts = cookieValue.split(':');
    if (parts.length !== 3) {
      return false;
    }

    const [cookieState, timestampStr, providedSignature] = parts;

    // Check if state matches
    if (state !== cookieState) {
      return false;
    }

    // Check timestamp expiration
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      return false;
    }

    const now = Date.now();
    if (now - timestamp > STATE_TTL_MS) {
      return false; // Expired
    }

    // Verify signature
    const signingKey = getStateSigningKey();
    const message = `${cookieState}:${timestampStr}`;
    const expectedSignature = crypto
      .createHmac('sha256', signingKey)
      .update(message)
      .digest('base64url');

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(providedSignature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    // Any error in validation means invalid state
    console.error('OAuth state validation error:', error);
    return false;
  }
}

/**
 * Create a cookie string for setting the state cookie
 *
 * @param cookieValue - The signed cookie value
 * @param options - Cookie options
 * @returns Cookie string for Set-Cookie header
 */
export function createStateCookie(
  cookieValue: string,
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    maxAge?: number;
    path?: string;
  } = {}
): string {
  const {
    httpOnly = true,
    secure = process.env.NODE_ENV === 'production',
    sameSite = 'lax',
    maxAge = STATE_TTL_MS / 1000, // Convert to seconds
    path = '/',
  } = options;

  const parts = [
    `oauth_state=${cookieValue}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    `SameSite=${sameSite}`,
  ];

  if (httpOnly) {
    parts.push('HttpOnly');
  }

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
