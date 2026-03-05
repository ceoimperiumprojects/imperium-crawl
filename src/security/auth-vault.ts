/**
 * Auth Vault — Encrypted credential storage for login automation.
 *
 * Stores login profiles (URL, username, password, form selectors)
 * encrypted on disk. Profiles are decrypted on-demand for login flows.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SKILLS_DIR_NAME } from "../constants.js";
import { encryptData, decryptData, isEncryptedPayload, ensureEncryptionKey } from "../sessions/encryption.js";

const AUTH_SUBDIR = "auth";
const PROFILE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export interface AuthProfile {
  name: string;
  url: string;
  username: string;
  password: string;
  selectors: {
    username: string;
    password: string;
    submit: string;
  };
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthProfileMeta {
  name: string;
  url: string;
  username: string;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

function getAuthDir(): string {
  return path.join(os.homedir(), SKILLS_DIR_NAME, AUTH_SUBDIR);
}

function profilePath(name: string): string {
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new Error(`Invalid profile name: '${name}'. Use only alphanumeric, underscore, and hyphen.`);
  }
  return path.join(getAuthDir(), `${name}.json`);
}

/**
 * Save an auth profile (encrypted on disk).
 */
export async function saveAuthProfile(profile: Omit<AuthProfile, "createdAt" | "updatedAt">): Promise<void> {
  const key = await ensureEncryptionKey();
  if (!key) {
    throw new Error("Encryption key required for auth vault. Set SESSION_ENCRYPTION_KEY env var or run 'imperium-crawl setup'.");
  }

  const dir = getAuthDir();
  await fs.mkdir(dir, { recursive: true });

  // Load existing for createdAt preservation
  let createdAt = new Date().toISOString();
  try {
    const existing = await getAuthProfile(profile.name);
    if (existing) createdAt = existing.createdAt;
  } catch {
    // New profile
  }

  const fullProfile: AuthProfile = {
    ...profile,
    createdAt,
    updatedAt: new Date().toISOString(),
  };

  const encrypted = encryptData(JSON.stringify(fullProfile), key);
  const filePath = profilePath(profile.name);
  const tmpPath = filePath + ".tmp";

  await fs.writeFile(tmpPath, JSON.stringify(encrypted, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

/**
 * Get a decrypted auth profile by name.
 */
export async function getAuthProfile(name: string): Promise<AuthProfile | null> {
  const key = await ensureEncryptionKey();
  if (!key) return null;

  try {
    const data = await fs.readFile(profilePath(name), "utf-8");
    const parsed = JSON.parse(data);

    if (isEncryptedPayload(parsed)) {
      return JSON.parse(decryptData(parsed, key)) as AuthProfile;
    }

    return parsed as AuthProfile;
  } catch {
    return null;
  }
}

/**
 * List all auth profiles (meta only — no passwords).
 */
export async function listAuthProfiles(): Promise<AuthProfileMeta[]> {
  const dir = getAuthDir();
  const key = await ensureEncryptionKey();

  try {
    const files = await fs.readdir(dir);
    const profiles: AuthProfileMeta[] = [];

    for (const file of files) {
      if (!file.endsWith(".json") || file.endsWith(".tmp.json")) continue;
      const name = file.replace(/\.json$/, "");

      try {
        const profile = key ? await getAuthProfile(name) : null;
        if (profile) {
          profiles.push({
            name: profile.name,
            url: profile.url,
            username: profile.username,
            lastLogin: profile.lastLogin,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          });
        }
      } catch {
        // Skip unreadable profiles
      }
    }

    return profiles;
  } catch {
    return [];
  }
}

/**
 * Delete an auth profile.
 */
export async function deleteAuthProfile(name: string): Promise<boolean> {
  try {
    await fs.unlink(profilePath(name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Update the lastLogin timestamp for a profile.
 */
export async function updateLastLogin(name: string): Promise<void> {
  const profile = await getAuthProfile(name);
  if (!profile) return;

  await saveAuthProfile({
    ...profile,
    lastLogin: new Date().toISOString(),
  });
}
