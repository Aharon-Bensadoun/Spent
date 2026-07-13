import "server-only";

import { getDb } from "../index";
import type { AgentProposal } from "@/lib/types";

type ProposalAction = AgentProposal["actionType"];

interface ProposalRow {
  id: number;
  actionType: ProposalAction;
  title: string;
  rationale: string;
  payloadJson: string;
  status: AgentProposal["status"];
  createdAt: string;
  resolvedAt: string | null;
}

function mapProposal(row: ProposalRow): AgentProposal {
  return {
    id: row.id,
    actionType: row.actionType,
    title: row.title,
    rationale: row.rationale,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

export function createProposal(
  workspaceId: number,
  input: {
    threadId?: number | null;
    actionType: ProposalAction;
    title: string;
    rationale: string;
    payload: Record<string, unknown>;
    precondition?: Record<string, unknown>;
  }
): AgentProposal {
  const result = getDb().prepare(
    `INSERT INTO agent_proposals
       (workspace_id, thread_id, action_type, title, rationale, payload_json, precondition_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    workspaceId,
    input.threadId ?? null,
    input.actionType,
    input.title.trim().slice(0, 140),
    input.rationale.trim().slice(0, 800),
    JSON.stringify(input.payload),
    JSON.stringify(input.precondition ?? {})
  );
  return getProposal(workspaceId, Number(result.lastInsertRowid))!;
}

export function listPendingProposals(workspaceId: number): AgentProposal[] {
  const rows = getDb().prepare(
    `SELECT id, action_type as actionType, title, rationale,
            payload_json as payloadJson, status,
            created_at as createdAt, resolved_at as resolvedAt
     FROM agent_proposals WHERE workspace_id = ? AND status = 'pending'
     ORDER BY created_at DESC, id DESC`
  ).all(workspaceId) as ProposalRow[];
  return rows.map(mapProposal);
}

export function getProposal(workspaceId: number, proposalId: number): AgentProposal | null {
  const row = getDb().prepare(
    `SELECT id, action_type as actionType, title, rationale,
            payload_json as payloadJson, status,
            created_at as createdAt, resolved_at as resolvedAt
     FROM agent_proposals WHERE workspace_id = ? AND id = ?`
  ).get(workspaceId, proposalId) as ProposalRow | undefined;
  return row ? mapProposal(row) : null;
}

export function resolveProposal(
  workspaceId: number,
  proposalId: number,
  decision: "confirm" | "reject"
): AgentProposal | null {
  const db = getDb();
  const raw = db.prepare(
    `SELECT id, action_type as actionType, title, rationale,
            payload_json as payloadJson, precondition_json as preconditionJson,
            status, created_at as createdAt, resolved_at as resolvedAt
     FROM agent_proposals WHERE workspace_id = ? AND id = ?`
  ).get(workspaceId, proposalId) as (ProposalRow & { preconditionJson: string }) | undefined;
  if (!raw || raw.status !== "pending") return raw ? mapProposal(raw) : null;

  const payload = JSON.parse(raw.payloadJson) as Record<string, unknown>;
  const precondition = JSON.parse(raw.preconditionJson) as Record<string, unknown>;
  const apply = db.transaction(() => {
    if (decision === "reject") {
      db.prepare(
        `UPDATE agent_proposals SET status = 'rejected', resolved_at = datetime('now')
         WHERE workspace_id = ? AND id = ? AND status = 'pending'`
      ).run(workspaceId, proposalId);
      return;
    }

    if (raw.actionType === "update_budget") {
      const categoryId = Number(payload.categoryId);
      const amount = Number(payload.amount);
      if (!Number.isInteger(categoryId) || !Number.isFinite(amount) || amount < 0) {
        throw new Error("The budget proposal is invalid");
      }
      const category = db.prepare(
        "SELECT id FROM categories WHERE workspace_id = ? AND id = ?"
      ).get(workspaceId, categoryId);
      if (!category) throw new Error("The category no longer exists");
      const current = db.prepare(
        `SELECT monthly_amount as amount FROM budgets
         WHERE workspace_id = ? AND category_id = ?`
      ).get(workspaceId, categoryId) as { amount: number } | undefined;
      if (precondition.currentAmount !== undefined &&
          Number(precondition.currentAmount) !== (current?.amount ?? null)) {
        db.prepare(
          `UPDATE agent_proposals SET status = 'stale', resolved_at = datetime('now')
           WHERE workspace_id = ? AND id = ?`
        ).run(workspaceId, proposalId);
        return;
      }
      db.prepare(
        `INSERT INTO budgets (workspace_id, category_id, monthly_amount, is_auto, updated_at)
         VALUES (?, ?, ?, 0, datetime('now'))
         ON CONFLICT(workspace_id, category_id) DO UPDATE SET
           monthly_amount = excluded.monthly_amount,
           is_auto = 0,
           updated_at = datetime('now')`
      ).run(workspaceId, categoryId, amount);
    } else if (raw.actionType === "create_goal") {
      const name = typeof payload.name === "string" ? payload.name.trim() : "";
      const targetAmount = Number(payload.targetAmount);
      const currentAmount = Number(payload.currentAmount ?? 0);
      const priority = Math.max(1, Math.min(3, Math.round(Number(payload.priority ?? 2))));
      const targetDate = typeof payload.targetDate === "string" ? payload.targetDate : null;
      if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0 ||
          !Number.isFinite(currentAmount) || currentAmount < 0) {
        throw new Error("The savings goal proposal is invalid");
      }
      db.prepare(
        `INSERT INTO savings_goals
           (workspace_id, name, target_amount, current_amount, target_date, priority)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(workspaceId, name.slice(0, 100), targetAmount, currentAmount, targetDate, priority);
    } else if (raw.actionType === "dismiss_insight") {
      const insightId = Number(payload.insightId);
      if (!Number.isInteger(insightId)) throw new Error("The insight proposal is invalid");
      db.prepare(
        `UPDATE financial_insights SET status = 'dismissed', updated_at = datetime('now')
         WHERE workspace_id = ? AND id = ?`
      ).run(workspaceId, insightId);
    }

    db.prepare(
      `UPDATE agent_proposals SET status = 'confirmed', resolved_at = datetime('now')
       WHERE workspace_id = ? AND id = ? AND status = 'pending'`
    ).run(workspaceId, proposalId);
    db.prepare(
      `INSERT INTO audit_events
         (workspace_id, actor, action, entity_type, entity_id, detail_json)
       VALUES (?, 'agent', ?, 'agent_proposal', ?, ?)`
    ).run(workspaceId, raw.actionType, String(proposalId), raw.payloadJson);
  });
  apply();
  return getProposal(workspaceId, proposalId);
}
