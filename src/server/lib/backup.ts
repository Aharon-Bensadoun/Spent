import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { exportEncryptionKeyHex } from "./encryption";

const DATA_DIR = path.join(process.cwd(), "data");
const PENDING_DIR = path.join(DATA_DIR, ".restore-pending");
const ARCHIVE_VERSION = 1;

interface ArchiveEnvelope {
  format: "spent-backup";
  version: 1;
  kdf: "scrypt";
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface ArchivePayload {
  createdAt: string;
  appVersion: string;
  database: string;
  encryptionKey: string;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16_384, r: 8, p: 1 });
}

export function createEncryptedBackup(passphrase: string): Buffer {
  if (passphrase.length < 10) throw new Error("Backup password must be at least 10 characters");
  const payload: ArchivePayload = {
    createdAt: new Date().toISOString(),
    appVersion: process.env.npm_package_version ?? "0.1.0",
    database: getDb().serialize().toString("base64"),
    encryptionKey: exportEncryptionKeyHex(),
  };
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const envelope: ArchiveEnvelope = {
    format: "spent-backup",
    version: ARCHIVE_VERSION,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

function decryptArchive(archive: Buffer, passphrase: string): ArchivePayload {
  let envelope: ArchiveEnvelope;
  try {
    envelope = JSON.parse(archive.toString("utf8")) as ArchiveEnvelope;
  } catch {
    throw new Error("This is not a valid Spent backup");
  }
  if (envelope.format !== "spent-backup" || envelope.version !== ARCHIVE_VERSION) {
    throw new Error("Unsupported Spent backup version");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveKey(passphrase, Buffer.from(envelope.salt, "base64")),
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")) as ArchivePayload;
  } catch {
    throw new Error("Backup password is incorrect or the archive is damaged");
  }
}

export function stageEncryptedRestore(archive: Buffer, passphrase: string): void {
  const payload = decryptArchive(archive, passphrase);
  if (!/^[0-9a-f]{64}$/i.test(payload.encryptionKey)) {
    throw new Error("Backup encryption key is invalid");
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const validationPath = path.join(DATA_DIR, `.restore-validation-${process.pid}.db`);
  fs.writeFileSync(validationPath, Buffer.from(payload.database, "base64"), { mode: 0o600 });
  try {
    const validationDb = new Database(validationPath);
    try {
      const integrity = validationDb.pragma("integrity_check") as { integrity_check: string }[];
      if (integrity[0]?.integrity_check !== "ok") throw new Error("Backup database failed integrity check");
      runMigrations(validationDb);
      const workspace = validationDb.prepare("SELECT id FROM workspaces LIMIT 1").get();
      if (!workspace) throw new Error("Backup contains no workspace");
    } finally {
      validationDb.close();
    }
    fs.mkdirSync(PENDING_DIR, { recursive: true });
    fs.copyFileSync(validationPath, path.join(PENDING_DIR, "spent.db"));
    fs.writeFileSync(path.join(PENDING_DIR, ".encryption-key"), payload.encryptionKey, { mode: 0o600 });
  } finally {
    fs.rmSync(validationPath, { force: true });
  }
}
