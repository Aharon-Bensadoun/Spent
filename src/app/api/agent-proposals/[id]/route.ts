import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { resolveProposal } from "@/server/db/queries/proposals";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { id } = await params;
  const proposalId = Number(id);
  const body = await request.json().catch(() => null) as { decision?: unknown } | null;
  if (!Number.isInteger(proposalId) ||
      (body?.decision !== "confirm" && body?.decision !== "reject")) {
    return NextResponse.json({ error: "invalid proposal decision" }, { status: 400 });
  }
  try {
    const proposal = resolveProposal(workspaceId, proposalId, body.decision);
    if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(proposal);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "proposal failed",
    }, { status: 409 });
  }
}
