/**
 * Token Encryption/Decryption Module
 *
 * Provides secure encryption and decryption for Slack tokens using AES-256-GCM.
 * Tokens are encrypted at rest in the database and decrypted only when needed.
 *
 * Security features:
 * - AES-256-GCM authenticated encryption
 * - Random 12-byte IV per encryption
 * - 16-byte authentication tag
 * - Base64 encoding for storage
 *
 * Format: base64(iv + authTag + ciphertext)
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes (96 bits) recommended for GCM
const AUTH_TAG_LENGTH = 16; // 16 bytes (128 bits)
const KEY_LENGTH = 32; // 32 bytes (256 bits)

/**
 * Get and validate the encryption key from environment
 * @throws Error if key is not set or malformed
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY environment variable is not set. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }

  // Validate hex string format
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes). ' +
      `Current length: ${keyHex.length} characters. ` +
      'Generate one with: openssl rand -hex 32'
    );
  }

  const key = Buffer.from(keyHex, 'hex');

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `Encryption key must be ${KEY_LENGTH} bytes. Got ${key.length} bytes.`
    );
  }

  return key;
}

/**
 * Encrypt a plaintext token
 *
 * @param plaintext - The token to encrypt
 * @returns Base64-encoded string containing IV + authTag + ciphertext
 * @throws Error if encryption fails or key is invalid
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Cannot encrypt empty or invalid token');
  }

  try {
    const key = getEncryptionKey();

    // Generate random IV for this encryption
    const iv = crypto.randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt the plaintext
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);

    // Get the authentication tag
    const authTag = cipher.getAuthTag();

    // Combine: iv + authTag + ciphertext
    const combined = Buffer.concat([iv, authTag, encrypted]);

    // Return as base64
    return combined.toString('base64');
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Token encryption failed: ${error.message}`);
    }
    throw new Error('Token encryption failed with unknown error');
  }
}

/**
 * Decrypt an encrypted token
 *
 * @param ciphertext - Base64-encoded string from encryptToken()
 * @returns The decrypted plaintext token
 * @throws Error if decryption fails, token is tampered, or key is invalid
 */
export function decryptToken(ciphertext: string): string {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('Cannot decrypt empty or invalid ciphertext');
  }

  try {
    const key = getEncryptionKey();

    // Decode from base64
    const combined = Buffer.from(ciphertext, 'base64');

    // Validate minimum length
    const minLength = IV_LENGTH + AUTH_TAG_LENGTH;
    if (combined.length < minLength) {
      throw new Error(
        `Invalid ciphertext: too short (${combined.length} bytes, need at least ${minLength})`
      );
    }

    // Extract components
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    if (error instanceof Error) {
      // Don't expose internal details in production
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Token decryption failed: invalid or tampered data');
      }
      throw new Error(`Token decryption failed: ${error.message}`);
    }
    throw new Error('Token decryption failed with unknown error');
  }
}

/**
 * Validate that an encryption key is properly configured
 * Useful for startup checks
 *
 * @returns true if key is valid, false otherwise
 */
export function validateEncryptionKey(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
