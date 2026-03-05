/**
 * Session Encryption — AES-256-GCM with scrypt key derivation.
 *
 * Auto-encrypts session files when SESSION_ENCRYPTION_KEY env var is set.
 * Uses Node.js crypto module only, zero deps.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SKILLS_DIR_NAME } from "../constants.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_KEY_FILENAME = "encryption.key";

export interface EncryptedPayload {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
  salt: string;
}

/**
 * Derive a 256-bit key from user password using scrypt.
 */
function deriveKey(userKey: string, salt: Buffer): Buffer {
  return scryptSync(userKey, salt, KEY_LENGTH);
}

/**
 * Encrypt plaintext with AES-256-GCM.
 */
export function encryptData(plaintext: string, userKey: string): EncryptedPayload {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(userKey, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
    salt: salt.toString("hex"),
  };
}

/**
 * Decrypt an encrypted payload.
 */
export function decryptData(payload: EncryptedPayload, userKey: string): string {
  const salt = Buffer.from(payload.salt, "hex");
  const key = deriveKey(userKey, salt);
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const ciphertext = Buffer.from(payload.ciphertext, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf-8");
}

/**
 * Check if an object looks like an encrypted payload.
 */
export function isEncryptedPayload(obj: unknown): obj is EncryptedPayload {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    o.version === 1 &&
    o.algorithm === ALGORITHM &&
    typeof o.iv === "string" &&
    typeof o.authTag === "string" &&
    typeof o.ciphertext === "string" &&
    typeof o.salt === "string"
  );
}

/**
 * Get encryption key from env var or auto-generated key file.
 * Returns undefined if no key is configured and no key file exists.
 */
export async function ensureEncryptionKey(): Promise<string | undefined> {
  // Env var takes priority
  const envKey = process.env.SESSION_ENCRYPTION_KEY?.trim();
  if (envKey) return envKey;

  // Check for existing key file
  const keyPath = path.join(os.homedir(), SKILLS_DIR_NAME, ENCRYPTION_KEY_FILENAME);
  try {
    const key = await fs.readFile(keyPath, "utf-8");
    return key.trim();
  } catch {
    // No key file — return undefined (encryption not configured)
    return undefined;
  }
}

/**
 * Generate a new encryption key and save to file.
 * Only call this explicitly (e.g. from setup wizard).
 */
export async function generateEncryptionKey(): Promise<string> {
  const key = randomBytes(32).toString("hex");
  const dir = path.join(os.homedir(), SKILLS_DIR_NAME);
  const keyPath = path.join(dir, ENCRYPTION_KEY_FILENAME);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(keyPath, key, { encoding: "utf-8", mode: 0o600 });

  return key;
}
