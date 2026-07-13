import "server-only";

import fs from "node:fs";
import path from "node:path";

export function applyPendingRestore(): boolean {
  const dataDir = path.join(process.cwd(), "data");
  const pendingDir = path.join(dataDir, ".restore-pending");
  const pendingDb = path.join(pendingDir, "spent.db");
  const pendingKey = path.join(pendingDir, ".encryption-key");
  if (!fs.existsSync(pendingDb) || !fs.existsSync(pendingKey)) return false;
  fs.mkdirSync(dataDir, { recursive: true });
  const currentDb = path.join(dataDir, "spent.db");
  const backupSuffix = `pre-restore-${Date.now()}`;
  if (fs.existsSync(currentDb)) {
    fs.renameSync(currentDb, path.join(dataDir, `spent.${backupSuffix}.db`));
  }
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${currentDb}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.renameSync(sidecar, path.join(dataDir, `spent.${backupSuffix}.db${suffix}`));
    }
  }
  fs.renameSync(pendingDb, currentDb);
  fs.copyFileSync(pendingKey, path.join(dataDir, ".encryption-key"));
  fs.chmodSync(path.join(dataDir, ".encryption-key"), 0o600);
  fs.rmSync(pendingDir, { recursive: true, force: true });
  return true;
}
