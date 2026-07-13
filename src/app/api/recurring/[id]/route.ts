import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { updateRecurringStatus } from "@/server/db/queries/insights";
import type { RecurringStatus } from "@/lib/types";

const STATUSES = new Set<RecurringStatus>([
  "detected", "subscription", "essential", "ignored", "cancelled",
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const recurringId = Number((await params).id);
  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  if (!Number.isInteger(recurringId) || typeof body?.status !== "string" ||
      !STATUSES.has(body.status as RecurringStatus)) {
    return NextResponse.json({ error: "invalid recurring status" }, { status: 400 });
  }
  if (!updateRecurringStatus(workspaceId, recurringId, body.status as RecurringStatus)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
