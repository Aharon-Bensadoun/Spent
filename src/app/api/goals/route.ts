import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { createGoal, listGoals } from "@/server/db/queries/insights";

export async function GET(request: Request) {
  return NextResponse.json(listGoals(getWorkspaceIdFromRequest(request)));
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const targetAmount = Number(body?.targetAmount);
  const currentAmount = Number(body?.currentAmount ?? 0);
  if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0 ||
      !Number.isFinite(currentAmount) || currentAmount < 0) {
    return NextResponse.json({ error: "invalid goal" }, { status: 400 });
  }
  return NextResponse.json(createGoal(workspaceId, {
    name,
    targetAmount,
    currentAmount,
    targetDate: typeof body?.targetDate === "string" ? body.targetDate : null,
    priority: Number(body?.priority ?? 2),
  }), { status: 201 });
}
