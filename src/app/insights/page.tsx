import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { InsightsPage } from "@/components/insights/insights-page";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export default function Insights() {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM bank_credentials").get() as {
    count: number;
  };
  if (row.count === 0) redirect("/setup");
  return (
    <AppShell>
      <InsightsPage />
    </AppShell>
  );
}
