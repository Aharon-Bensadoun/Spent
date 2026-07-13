import "server-only";

import { getDb } from "../index";
import type { FinancialAccount } from "@/lib/types";

export function upsertAccountBalance(
  workspaceId: number,
  provider: string,
  accountNumber: string,
  balance: number | undefined,
  currency = "ILS"
): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO accounts
         (workspace_id, provider, account_number, currency, current_balance, balance_updated_at)
       VALUES (?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)
       ON CONFLICT(workspace_id, provider, account_number) DO UPDATE SET
         currency = excluded.currency,
         current_balance = COALESCE(excluded.current_balance, accounts.current_balance),
         balance_updated_at = CASE
           WHEN excluded.current_balance IS NULL THEN accounts.balance_updated_at
           ELSE datetime('now')
         END,
         updated_at = datetime('now')`
    ).run(workspaceId, provider, accountNumber, currency, balance ?? null, balance ?? null);

    if (balance != null && Number.isFinite(balance)) {
      const account = db.prepare(
        `SELECT id FROM accounts
         WHERE workspace_id = ? AND provider = ? AND account_number = ?`
      ).get(workspaceId, provider, accountNumber) as { id: number };
      db.prepare(
        `INSERT INTO account_balance_snapshots (account_id, balance, currency)
         VALUES (?, ?, ?)`
      ).run(account.id, balance, currency);
    }
  });
  run();
}

export function listAccounts(workspaceId: number): FinancialAccount[] {
  return getDb().prepare(
    `SELECT id, provider, account_number as accountNumber, currency,
            current_balance as currentBalance, balance_updated_at as balanceUpdatedAt
     FROM accounts WHERE workspace_id = ? ORDER BY provider, account_number`
  ).all(workspaceId) as FinancialAccount[];
}
