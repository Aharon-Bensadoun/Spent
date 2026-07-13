export interface AnalyticsTransaction {
  id: number;
  date: string;
  description: string;
  amount: number;
  categoryName?: string | null;
}

export interface DetectedRecurring {
  merchantKey: string;
  displayName: string;
  cadence: "weekly" | "monthly" | "quarterly" | "yearly" | "irregular";
  averageAmount: number;
  monthlyCost: number;
  nextExpectedDate: string | null;
  confidence: number;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  transactionIds: number[];
  latestIncreasePercent: number | null;
}

export interface DetectedAnomaly {
  merchantKey: string;
  displayName: string;
  transactionId: number;
  date: string;
  observed: number;
  baseline: number;
  increasePercent: number;
  categoryName: string | null;
}

export function normalizeMerchantName(description: string): string {
  return description
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+\d+\s*$/, "")
    .trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function daysBetween(a: string, b: string): number {
  const start = new Date(`${a}T12:00:00Z`).getTime();
  const end = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextDateForCadence(
  iso: string,
  cadence: DetectedRecurring["cadence"],
  interval: number
): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (cadence === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else if (cadence === "quarterly") date.setUTCMonth(date.getUTCMonth() + 3);
  else if (cadence === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else return addDays(iso, Math.round(interval));
  return date.toISOString().slice(0, 10);
}

function cadenceFor(days: number): DetectedRecurring["cadence"] {
  if (days >= 5 && days <= 10) return "weekly";
  if (days >= 24 && days <= 38) return "monthly";
  if (days >= 70 && days <= 110) return "quarterly";
  if (days >= 330 && days <= 400) return "yearly";
  return "irregular";
}

export function detectRecurringSeries(
  transactions: AnalyticsTransaction[]
): DetectedRecurring[] {
  const buckets = new Map<string, AnalyticsTransaction[]>();
  for (const transaction of transactions) {
    const key = normalizeMerchantName(transaction.description);
    if (!key || transaction.amount <= 0) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(transaction);
    buckets.set(key, bucket);
  }

  const result: DetectedRecurring[] = [];
  for (const [merchantKey, unsorted] of buckets) {
    if (unsorted.length < 3) continue;
    const rows = [...unsorted].sort((a, b) => a.date.localeCompare(b.date));
    const distinctMonths = new Set(rows.map((row) => row.date.slice(0, 7)));
    if (distinctMonths.size < 2) continue;

    const intervals = rows.slice(1).map((row, index) =>
      daysBetween(rows[index].date, row.date)
    ).filter((days) => days > 0);
    const interval = median(intervals);
    const cadence = cadenceFor(interval);
    if (cadence === "irregular") continue;

    const amounts = rows.map((row) => row.amount);
    const typical = median(amounts);
    const average = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
    const intervalDeviation = intervals.length === 0
      ? 1
      : intervals.reduce((sum, days) => sum + Math.abs(days - interval), 0) /
        intervals.length / Math.max(interval, 1);
    const amountDeviation = amounts.reduce(
      (sum, amount) => sum + Math.abs(amount - typical), 0
    ) / amounts.length / Math.max(typical, 1);
    const confidence = Math.max(
      0.5,
      Math.min(0.99, 1 - intervalDeviation * 0.7 - amountDeviation * 0.3)
    );
    const last = rows.at(-1)!;
    const previousTypical = median(amounts.slice(0, -1));
    const latestIncreasePercent = previousTypical > 0 && last.amount > previousTypical * 1.1
      ? ((last.amount - previousTypical) / previousTypical) * 100
      : null;

    result.push({
      merchantKey,
      displayName: rows.at(-1)!.description,
      cadence,
      averageAmount: Number(average.toFixed(2)),
      monthlyCost: Number((average * (30.4375 / interval)).toFixed(2)),
      nextExpectedDate: nextDateForCadence(last.date, cadence, interval),
      confidence: Number(confidence.toFixed(2)),
      occurrenceCount: rows.length,
      firstSeenAt: rows[0].date,
      lastSeenAt: last.date,
      transactionIds: rows.map((row) => row.id),
      latestIncreasePercent:
        latestIncreasePercent == null ? null : Number(latestIncreasePercent.toFixed(1)),
    });
  }
  return result.sort((a, b) => b.monthlyCost - a.monthlyCost);
}

export function detectSpendingAnomalies(
  transactions: AnalyticsTransaction[]
): DetectedAnomaly[] {
  const buckets = new Map<string, AnalyticsTransaction[]>();
  for (const transaction of transactions) {
    const key = normalizeMerchantName(transaction.description);
    if (!key || transaction.amount <= 0) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(transaction);
    buckets.set(key, bucket);
  }

  const anomalies: DetectedAnomaly[] = [];
  for (const [merchantKey, unsorted] of buckets) {
    if (unsorted.length < 4) continue;
    const rows = [...unsorted].sort((a, b) => a.date.localeCompare(b.date));
    const latest = rows.at(-1)!;
    const baseline = median(rows.slice(0, -1).map((row) => row.amount));
    if (baseline < 10) continue;
    const threshold = Math.max(baseline * 1.5, baseline + 50);
    if (latest.amount < threshold) continue;
    anomalies.push({
      merchantKey,
      displayName: latest.description,
      transactionId: latest.id,
      date: latest.date,
      observed: latest.amount,
      baseline,
      increasePercent: Number((((latest.amount - baseline) / baseline) * 100).toFixed(1)),
      categoryName: latest.categoryName ?? null,
    });
  }
  return anomalies.sort((a, b) => b.observed - b.baseline - (a.observed - a.baseline));
}
