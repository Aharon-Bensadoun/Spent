import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { getInsightsPayload } from "@/server/db/queries/insights";
import { listPendingProposals } from "@/server/db/queries/proposals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json({
    ...getInsightsPayload(workspaceId),
    proposals: listPendingProposals(workspaceId),
  });
}
