import { NextResponse } from "next/server";

import { reviewDueAgentTasks } from "@/lib/agent-task-review";
import { verifyInternalAgentActionToken } from "@/lib/internal-agent-actions";

export async function POST(request: Request) {
  if (!verifyInternalAgentActionToken(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await reviewDueAgentTasks();

  return NextResponse.json(result);
}
