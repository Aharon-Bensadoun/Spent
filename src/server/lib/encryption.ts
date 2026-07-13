import "server-only";

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { readSystemSecret, writeSystemSecret, type SecretBackend } from "./secret-store";

const KEY_PATH = path.join(process.cwd(), "data", ".encryption-key");
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function assertKeyFileMode(stat: fs.Stats): void {
  // POSIX-only. Windows NTFS ACLs don't map to mode bits meaningfully,
  // so skip there and rely on the default user profile permissions.
  if (process.platform === "win32") return;

  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(
      `Refusing to read encryption key: ${KEY_PATH} has mode ${mode.toString(8).padStart(3, "0")}, expected 600. ` +
        `Fix with: chmod 600 ${KEY_PATH}`,
    );
  }
}

function getOrCreateKey(): Buffer {
  const dir = path.dirname(KEY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const stored = readSystemSecret();
  if (stored && /^[0-9a-f]{64}$/i.test(stored.value)) {
    keyBackend = stored.backend;
    return Buffer.from(stored.value, "hex");
  }

  if (fs.existsSync(KEY_PATH)) {
    assertKeyFileMode(fs.statSync(KEY_PATH));
    const value = fs.readFileSync(KEY_PATH, "utf-8").trim();
    const backend = writeSystemSecret(value);
    if (backend) {
      keyBackend = backend;
      fs.rmSync(KEY_PATH, { force: true });
    }
    return Buffer.from(value, "hex");
  }

  const key = crypto.randomBytes(32);
  const backend = writeSystemSecret(key.toString("hex"));
  if (backend) {
    keyBackend = backend;
  } else {
    fs.writeFileSync(KEY_PATH, key.toString("hex"), { mode: 0o600 });
    keyBackend = "file";
  }
  return key;
}

let cachedKey: Buffer | null = null;
let keyBackend: SecretBackend = "file";

function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = getOrCreateKey();
  }
  return cachedKey;
}

export function exportEncryptionKeyHex(): string {
  return getKey().toString("hex");
}

export function getEncryptionKeyBackend(): SecretBackend {
  getKey();
  return keyBackend;
}

export interface EncryptedData {
  encrypted: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encrypt(plaintext: string): EncryptedData {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return { encrypted, iv, authTag };
}

export function decrypt(data: EncryptedData): string {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, data.iv);
  decipher.setAuthTag(data.authTag);

  return Buffer.concat([
    decipher.update(data.encrypted),
    decipher.final(),
  ]).toString("utf-8");
}
