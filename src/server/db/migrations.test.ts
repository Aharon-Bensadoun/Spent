import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("applies the complete migration history to an empty database", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spent-migrations-"));
    temporaryDirectories.push(directory);
    const db = new Database(path.join(directory, "spent.db"));
    try {
      const migrationDirectory = path.join(process.cwd(), "src/server/db/migrations");
      const files = fs.readdirSync(migrationDirectory)
        .filter((file) => file.endsWith(".sql"))
        .sort();
      expect(files.at(-1)).toBe("022_financial_insights.sql");
      for (const file of files) {
        db.pragma("foreign_keys = OFF");
        db.exec(fs.readFileSync(path.join(migrationDirectory, file), "utf8"));
        db.pragma("foreign_keys = ON");
      }
      expect(db.pragma("foreign_key_check")).toEqual([]);
      const tables = new Set(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
          .map((row) => row.name)
      );
      for (const expected of [
        "accounts",
        "account_balance_snapshots",
        "recurring_series",
        "financial_insights",
        "savings_goals",
        "agent_proposals",
        "audit_events",
        "notification_preferences",
      ]) {
        expect(tables.has(expected), `missing table ${expected}`).toBe(true);
      }
    } finally {
      db.close();
    }
  });
});
