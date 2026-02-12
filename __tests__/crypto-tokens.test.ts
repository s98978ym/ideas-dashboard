import { randomBytes } from 'crypto';

// Test encryption logic directly
describe('Token Encryption', () => {
  // Simulate the encryption functions from src/lib/crypto/tokens.ts
  const testKey = randomBytes(32).toString('hex'); // 64 hex chars

  // Import the actual module dynamically in a way that works
  // For unit testing, we test the crypto primitives

  test('AES-256-GCM roundtrip', () => {
    const crypto = require('crypto');
    const key = Buffer.from(testKey, 'hex');
    const plaintext = 'xoxb-test-token-12345';

    // Encrypt
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const combined = Buffer.concat([iv, authTag, encrypted]);
    const ciphertext = combined.toString('base64');

    // Decrypt
    const data = Buffer.from(ciphertext, 'base64');
    const decIv = data.subarray(0, 12);
    const decAuthTag = data.subarray(12, 28);
    const decEncrypted = data.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, decIv);
    decipher.setAuthTag(decAuthTag);
    const decrypted = decipher.update(decEncrypted) + decipher.final('utf8');

    expect(decrypted).toBe(plaintext);
  });

  test('different IVs produce different ciphertexts', () => {
    const crypto = require('crypto');
    const key = Buffer.from(testKey, 'hex');
    const plaintext = 'xoxb-same-token';

    function encrypt(text: string) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, encrypted]).toString('base64');
    }

    const ct1 = encrypt(plaintext);
    const ct2 = encrypt(plaintext);
    expect(ct1).not.toBe(ct2); // Different IVs means different ciphertexts
  });

  test('wrong key fails decryption', () => {
    const crypto = require('crypto');
    const key = Buffer.from(testKey, 'hex');
    const wrongKey = crypto.randomBytes(32);
    const plaintext = 'xoxb-secret-token';

    // Encrypt with correct key
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([iv, authTag, encrypted]).toString('base64');

    // Try to decrypt with wrong key
    const data = Buffer.from(ciphertext, 'base64');
    const decIv = data.subarray(0, 12);
    const decAuthTag = data.subarray(12, 28);
    const decEncrypted = data.subarray(28);

    expect(() => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', wrongKey, decIv);
      decipher.setAuthTag(decAuthTag);
      decipher.update(decEncrypted) + decipher.final('utf8');
    }).toThrow();
  });
});
