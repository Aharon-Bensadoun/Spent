import { NextResponse } from "next/server";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { deleteGoal, updateGoal } from "@/server/db/queries/insights";
import type { SavingsGoal } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const goalId = Number((await params).id);
  if (!Number.isInteger(goalId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = await request.json().catch(() => null) as Partial<SavingsGoal> | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    const goal = updateGoal(workspaceId, goalId, {
      name: typeof body.name === "string" ? body.name : undefined,
      targetAmount: typeof body.targetAmount === "number" ? body.targetAmount : undefined,
      currentAmount: typeof body.currentAmount === "number" ? body.currentAmount : undefined,
      targetDate: typeof body.targetDate === "string" || body.targetDate === null ? body.targetDate : undefined,
      priority: body.priority,
      status: body.status,
    });
    return goal
      ? NextResponse.json(goal)
      : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid goal" }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const goalId = Number((await params).id);
  if (!Number.isInteger(goalId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  return deleteGoal(workspaceId, goalId)
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
