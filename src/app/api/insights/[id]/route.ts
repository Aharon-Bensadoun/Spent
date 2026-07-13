import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { dismissInsight } from "@/server/db/queries/insights";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { id } = await params;
  const insightId = Number(id);
  if (!Number.isInteger(insightId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = await request.json().catch(() => null) as { status?: unknown } | null;
  if (body?.status !== "dismissed") {
    return NextResponse.json({ error: "status must be dismissed" }, { status: 400 });
  }
  if (!dismissInsight(workspaceId, insightId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
