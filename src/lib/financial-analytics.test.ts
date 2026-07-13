import { describe, expect, it } from "vitest";
import {
  detectRecurringSeries,
  detectSpendingAnomalies,
  normalizeMerchantName,
  type AnalyticsTransaction,
} from "./financial-analytics";

function transaction(
  id: number,
  date: string,
  description: string,
  amount: number
): AnalyticsTransaction {
  return { id, date, description, amount, categoryName: "Subscriptions" };
}

describe("financial analytics", () => {
  it("normalizes Latin and Hebrew merchant noise without losing words", () => {
    expect(normalizeMerchantName("  NETFLIX * 1234  ")).toBe("netflix");
    expect(normalizeMerchantName("סופר פארם  7788")).toBe("סופר פארם");
  });

  it("detects a stable monthly recurring charge and annualized cost", () => {
    const rows = [
      transaction(1, "2026-01-05", "Netflix 1001", 54.9),
      transaction(2, "2026-02-05", "Netflix 1002", 54.9),
      transaction(3, "2026-03-05", "Netflix 1003", 54.9),
      transaction(4, "2026-04-05", "Netflix 1004", 59.9),
    ];
    const [series] = detectRecurringSeries(rows);
    expect(series.cadence).toBe("monthly");
    expect(series.occurrenceCount).toBe(4);
    expect(series.monthlyCost).toBeGreaterThan(50);
    expect(series.nextExpectedDate).toBe("2026-05-05");
  });

  it("does not classify irregular merchant activity as a subscription", () => {
    const rows = [
      transaction(1, "2026-01-01", "Store", 20),
      transaction(2, "2026-01-03", "Store", 100),
      transaction(3, "2026-03-20", "Store", 40),
    ];
    expect(detectRecurringSeries(rows)).toEqual([]);
  });

  it("flags a large latest charge against the merchant baseline", () => {
    const rows = [
      transaction(1, "2026-01-01", "Electric Co", 300),
      transaction(2, "2026-02-01", "Electric Co", 320),
      transaction(3, "2026-03-01", "Electric Co", 310),
      transaction(4, "2026-04-01", "Electric Co", 800),
    ];
    const [anomaly] = detectSpendingAnomalies(rows);
    expect(anomaly.transactionId).toBe(4);
    expect(anomaly.baseline).toBe(310);
    expect(anomaly.increasePercent).toBeGreaterThan(150);
  });
});
