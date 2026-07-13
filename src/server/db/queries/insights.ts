import "server-only";

import { createHash } from "node:crypto";
import { getDb } from "../index";
import { listAccounts } from "./accounts";
import {
  detectRecurringSeries,
  detectSpendingAnomalies,
  type AnalyticsTransaction,
} from "@/lib/financial-analytics";
import { toLocalISODate } from "@/server/lib/date-utils";
import type {
  CashFlowForecastPoint,
  FinancialInsight,
  InsightsPayload,
  RecurringSeries,
  SavingsGoal,
} from "@/lib/types";

function monthsAgoStart(months: number): string {
  const now = new Date();
  return toLocalISODate(new Date(now.getFullYear(), now.getMonth() - months, 1));
}

function fingerprint(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function loadTransactions(workspaceId: number): AnalyticsTransaction[] {
  return getDb().prepare(
    `SELECT t.id, t.date, t.description, ABS(t.charged_amount) as amount,
            c.name as categoryName
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.workspace_id = ? AND t.date >= ?
       AND t.status = 'completed' AND t.kind = 'expense'
     ORDER BY t.date ASC, t.id ASC`
  ).all(workspaceId, monthsAgoStart(12)) as AnalyticsTransaction[];
}

function upsertInsight(
  workspaceId: number,
  input: {
    kind: FinancialInsight["kind"];
    severity: FinancialInsight["severity"];
    title: string;
    summary: string;
    monthlyImpact?: number | null;
    annualImpact?: number | null;
    evidence: Record<string, unknown>;
    fingerprint: string;
  }
): void {
  getDb().prepare(
    `INSERT INTO financial_insights
       (workspace_id, kind, severity, title, summary, monthly_impact,
        annual_impact, evidence_json, fingerprint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, fingerprint) DO UPDATE SET
       severity = excluded.severity,
       title = excluded.title,
       summary = excluded.summary,
       monthly_impact = excluded.monthly_impact,
       annual_impact = excluded.annual_impact,
       evidence_json = excluded.evidence_json,
       updated_at = datetime('now')`
  ).run(
    workspaceId,
    input.kind,
    input.severity,
    input.title,
    input.summary,
    input.monthlyImpact ?? null,
    input.annualImpact ?? null,
    JSON.stringify(input.evidence),
    input.fingerprint
  );
}

function refreshRecurring(workspaceId: number, transactions: AnalyticsTransaction[]): void {
  const db = getDb();
  const detected = detectRecurringSeries(transactions);
  const write = db.transaction(() => {
    for (const series of detected) {
      db.prepare(
        `INSERT INTO recurring_series
           (workspace_id, merchant_key, display_name, cadence, average_amount,
            monthly_cost, next_expected_date, confidence, occurrence_count,
            first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, merchant_key) DO UPDATE SET
           display_name = excluded.display_name,
           cadence = excluded.cadence,
           average_amount = excluded.average_amount,
           monthly_cost = excluded.monthly_cost,
           next_expected_date = excluded.next_expected_date,
           confidence = excluded.confidence,
           occurrence_count = excluded.occurrence_count,
           first_seen_at = excluded.first_seen_at,
           last_seen_at = excluded.last_seen_at,
           updated_at = datetime('now')`
      ).run(
        workspaceId, series.merchantKey, series.displayName, series.cadence,
        series.averageAmount, series.monthlyCost, series.nextExpectedDate,
        series.confidence, series.occurrenceCount, series.firstSeenAt, series.lastSeenAt
      );

      if (series.monthlyCost >= 20) {
        upsertInsight(workspaceId, {
          kind: "recurring",
          severity: "info",
          title: `Review ${series.displayName}`,
          summary: `${series.occurrenceCount} recurring charges suggest about ILS ${Math.round(series.monthlyCost)} per month.`,
          monthlyImpact: series.monthlyCost,
          annualImpact: series.monthlyCost * 12,
          evidence: {
            transactionIds: series.transactionIds,
            merchant: series.displayName,
            period: { from: series.firstSeenAt, to: series.lastSeenAt },
          },
          fingerprint: fingerprint(["recurring", series.merchantKey]),
        });
      }
      if (series.latestIncreasePercent != null) {
        upsertInsight(workspaceId, {
          kind: "price_increase",
          severity: series.latestIncreasePercent >= 25 ? "warning" : "info",
          title: `${series.displayName} increased in price`,
          summary: `The latest charge is ${series.latestIncreasePercent}% above its previous typical amount.`,
          monthlyImpact: series.monthlyCost,
          annualImpact: series.monthlyCost * 12,
          evidence: { transactionIds: series.transactionIds, merchant: series.displayName },
          fingerprint: fingerprint(["price", series.merchantKey, series.lastSeenAt]),
        });
      }
    }
  });
  write();
}

function refreshAnomalies(workspaceId: number, transactions: AnalyticsTransaction[]): void {
  for (const anomaly of detectSpendingAnomalies(transactions)) {
    upsertInsight(workspaceId, {
      kind: "anomaly",
      severity: anomaly.increasePercent >= 200 ? "critical" : "warning",
      title: `Unusual charge at ${anomaly.displayName}`,
      summary: `ILS ${Math.round(anomaly.observed)} versus a typical ILS ${Math.round(anomaly.baseline)}.`,
      monthlyImpact: anomaly.observed - anomaly.baseline,
      annualImpact: null,
      evidence: {
        transactionIds: [anomaly.transactionId],
        merchant: anomaly.displayName,
        category: anomaly.categoryName,
        observed: anomaly.observed,
        baseline: anomaly.baseline,
        period: { from: anomaly.date, to: anomaly.date },
      },
      fingerprint: fingerprint(["anomaly", anomaly.transactionId]),
    });
  }
}

function refreshBudgetRisks(workspaceId: number): void {
  const now = new Date();
  const from = toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = toLocalISODate(now);
  const elapsed = Math.max(1, now.getDate()) /
    new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const rows = getDb().prepare(
    `SELECT b.category_id as categoryId, c.name,
            b.monthly_amount as budget,
            COALESCE(SUM(ABS(t.charged_amount)), 0) as spent
     FROM budgets b
     JOIN categories c ON c.id = b.category_id
     LEFT JOIN transactions t ON t.category_id = b.category_id
       AND t.workspace_id = b.workspace_id AND t.date >= ? AND t.date <= ?
       AND t.status = 'completed' AND t.kind = 'expense'
     WHERE b.workspace_id = ?
     GROUP BY b.category_id, c.name, b.monthly_amount`
  ).all(from, to, workspaceId) as { categoryId: number; name: string; budget: number; spent: number }[];
  for (const row of rows) {
    const projected = row.spent / elapsed;
    if (row.budget <= 0 || projected <= row.budget * 1.1) continue;
    const over = projected - row.budget;
    upsertInsight(workspaceId, {
      kind: "budget_risk",
      severity: projected >= row.budget * 1.4 ? "critical" : "warning",
      title: `${row.name} may exceed its budget`,
      summary: `Current pace projects ILS ${Math.round(projected)}, about ILS ${Math.round(over)} over budget.`,
      monthlyImpact: over,
      annualImpact: over * 12,
      evidence: { category: row.name, observed: row.spent, baseline: row.budget, period: { from, to } },
      fingerprint: fingerprint(["budget", row.categoryId, from.slice(0, 7)]),
    });
  }
}

function refreshFees(workspaceId: number): void {
  const now = new Date();
  const from = toLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1));
  const rows = getDb().prepare(
    `SELECT t.id, ABS(t.charged_amount) as amount
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.workspace_id = ? AND t.date >= ? AND t.status = 'completed'
       AND t.kind = 'expense' AND c.name = 'Fees & Taxes'`
  ).all(workspaceId, from) as { id: number; amount: number }[];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  if (total < 25) return;
  upsertInsight(workspaceId, {
    kind: "fee",
    severity: total >= 100 ? "warning" : "info",
    title: "Bank fees are adding up",
    summary: `Fees and taxes total ILS ${Math.round(total)} this month. Review whether any account or card fee can be avoided.`,
    monthlyImpact: total,
    annualImpact: total * 12,
    evidence: { transactionIds: rows.map((row) => row.id), category: "Fees & Taxes", period: { from, to: toLocalISODate(now) } },
    fingerprint: fingerprint(["fees", from.slice(0, 7)]),
  });
}

function listRecurring(workspaceId: number): RecurringSeries[] {
  return getDb().prepare(
    `SELECT id, merchant_key as merchantKey, display_name as displayName,
            cadence, average_amount as averageAmount, monthly_cost as monthlyCost,
            next_expected_date as nextExpectedDate, confidence, occurrence_count as occurrenceCount,
            status, first_seen_at as firstSeenAt, last_seen_at as lastSeenAt
     FROM recurring_series WHERE workspace_id = ? AND status <> 'ignored'
     ORDER BY monthly_cost DESC`
  ).all(workspaceId) as RecurringSeries[];
}

export function listGoals(workspaceId: number): SavingsGoal[] {
  return getDb().prepare(
    `SELECT id, name, target_amount as targetAmount, current_amount as currentAmount,
            target_date as targetDate, priority, status,
            created_at as createdAt, updated_at as updatedAt
     FROM savings_goals WHERE workspace_id = ? ORDER BY status, priority, target_date`
  ).all(workspaceId) as SavingsGoal[];
}

export function createGoal(
  workspaceId: number,
  input: { name: string; targetAmount: number; currentAmount?: number; targetDate?: string | null; priority?: number }
): SavingsGoal {
  const result = getDb().prepare(
    `INSERT INTO savings_goals
       (workspace_id, name, target_amount, current_amount, target_date, priority)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    workspaceId,
    input.name.trim().slice(0, 100),
    input.targetAmount,
    input.currentAmount ?? 0,
    input.targetDate ?? null,
    Math.max(1, Math.min(3, Math.round(input.priority ?? 2)))
  );
  return getDb().prepare(
    `SELECT id, name, target_amount as targetAmount, current_amount as currentAmount,
            target_date as targetDate, priority, status,
            created_at as createdAt, updated_at as updatedAt
     FROM savings_goals WHERE workspace_id = ? AND id = ?`
  ).get(workspaceId, Number(result.lastInsertRowid)) as SavingsGoal;
}

export function updateGoal(
  workspaceId: number,
  goalId: number,
  input: Partial<Pick<SavingsGoal, "name" | "targetAmount" | "currentAmount" | "targetDate" | "priority" | "status">>
): SavingsGoal | null {
  const current = getDb().prepare(
    `SELECT id, name, target_amount as targetAmount, current_amount as currentAmount,
            target_date as targetDate, priority, status,
            created_at as createdAt, updated_at as updatedAt
     FROM savings_goals WHERE workspace_id = ? AND id = ?`
  ).get(workspaceId, goalId) as SavingsGoal | undefined;
  if (!current) return null;
  const next: SavingsGoal = {
    ...current,
    name: input.name ?? current.name,
    targetAmount: input.targetAmount ?? current.targetAmount,
    currentAmount: input.currentAmount ?? current.currentAmount,
    targetDate: input.targetDate === undefined ? current.targetDate : input.targetDate,
    priority: input.priority ?? current.priority,
    status: input.status ?? current.status,
  };
  if (!next.name.trim() || next.targetAmount <= 0 || next.currentAmount < 0) {
    throw new Error("Invalid savings goal");
  }
  getDb().prepare(
    `UPDATE savings_goals SET name = ?, target_amount = ?, current_amount = ?,
       target_date = ?, priority = ?, status = ?, updated_at = datetime('now')
     WHERE workspace_id = ? AND id = ?`
  ).run(
    next.name.trim().slice(0, 100), next.targetAmount, next.currentAmount,
    next.targetDate, next.priority, next.status, workspaceId, goalId
  );
  return listGoals(workspaceId).find((goal) => goal.id === goalId) ?? null;
}

export function deleteGoal(workspaceId: number, goalId: number): boolean {
  return getDb().prepare(
    "DELETE FROM savings_goals WHERE workspace_id = ? AND id = ?"
  ).run(workspaceId, goalId).changes > 0;
}

function listInsights(workspaceId: number): FinancialInsight[] {
  const rows = getDb().prepare(
    `SELECT id, kind, severity, title, summary,
            monthly_impact as monthlyImpact, annual_impact as annualImpact,
            evidence_json as evidenceJson, status, detected_at as detectedAt
     FROM financial_insights WHERE workspace_id = ? AND status = 'active'
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
              COALESCE(annual_impact, monthly_impact, 0) DESC`
  ).all(workspaceId) as (Omit<FinancialInsight, "evidence"> & { evidenceJson: string })[];
  return rows.map(({ evidenceJson, ...row }) => ({
    ...row,
    evidence: JSON.parse(evidenceJson) as FinancialInsight["evidence"],
  }));
}

export function dismissInsight(workspaceId: number, insightId: number): boolean {
  return getDb().prepare(
    `UPDATE financial_insights SET status = 'dismissed', updated_at = datetime('now')
     WHERE workspace_id = ? AND id = ? AND status = 'active'`
  ).run(workspaceId, insightId).changes > 0;
}

export function updateRecurringStatus(
  workspaceId: number,
  recurringId: number,
  status: RecurringSeries["status"]
): boolean {
  return getDb().prepare(
    `UPDATE recurring_series SET status = ?, updated_at = datetime('now')
     WHERE workspace_id = ? AND id = ?`
  ).run(status, workspaceId, recurringId).changes > 0;
}

function buildForecast(workspaceId: number, totalBalance: number | null): CashFlowForecastPoint[] {
  const today = new Date();
  const from = monthsAgoStart(6);
  const row = getDb().prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN kind = 'income' THEN charged_amount ELSE 0 END), 0) / 6.0 as income,
       COALESCE(SUM(CASE WHEN kind = 'expense' THEN ABS(charged_amount) ELSE 0 END), 0) / 6.0 as expenses
     FROM transactions
     WHERE workspace_id = ? AND status = 'completed' AND date >= ?`
  ).get(workspaceId, from) as { income: number; expenses: number };
  const base = totalBalance ?? 0;
  return ([30, 60, 90] as const).map((days) => {
    const months = days / 30.4375;
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return {
      days,
      date: toLocalISODate(date),
      conservative: base + (row.income * 0.9 - row.expenses * 1.15) * months,
      central: base + (row.income - row.expenses) * months,
      optimistic: base + (row.income * 1.05 - row.expenses * 0.9) * months,
    };
  });
}

export function getInsightsPayload(workspaceId: number): InsightsPayload {
  const transactions = loadTransactions(workspaceId);
  refreshRecurring(workspaceId, transactions);
  refreshAnomalies(workspaceId, transactions);
  refreshBudgetRisks(workspaceId);
  refreshFees(workspaceId);

  const accounts = listAccounts(workspaceId);
  const balances = accounts
    .map((account) => account.currentBalance)
    .filter((balance): balance is number => balance != null);
  const totalBalance = balances.length > 0
    ? balances.reduce((sum, balance) => sum + balance, 0)
    : null;
  const recurring = listRecurring(workspaceId);
  const forecast = buildForecast(workspaceId, totalBalance);
  const risky = forecast.find((point) => point.central < 0);
  if (risky) {
    upsertInsight(workspaceId, {
      kind: "forecast",
      severity: risky.days <= 30 ? "critical" : "warning",
      title: `Cash balance may turn negative within ${risky.days} days`,
      summary: `The central scenario reaches ${Math.round(risky.central)} ILS by ${risky.date}. Review recurring commitments and planned purchases.`,
      monthlyImpact: Math.abs(risky.central),
      annualImpact: null,
      evidence: { transactionIds: [], observed: risky.central, period: { from: toLocalISODate(new Date()), to: risky.date } },
      fingerprint: fingerprint(["forecast", risky.days, risky.date]),
    });
  }
  const insights = listInsights(workspaceId);
  return {
    generatedAt: new Date().toISOString(),
    accounts,
    totalBalance,
    recurring,
    insights,
    goals: listGoals(workspaceId),
    forecast,
    potentialMonthlySavings: insights
      .filter((insight) => insight.kind === "recurring" || insight.kind === "price_increase")
      .reduce((sum, insight) => sum + (insight.monthlyImpact ?? 0), 0),
  };
}
