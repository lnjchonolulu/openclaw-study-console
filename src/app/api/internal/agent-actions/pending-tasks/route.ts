import { NextResponse } from "next/server";

import { verifyInternalAgentActionToken } from "@/lib/internal-agent-actions";
import { listPendingAgentTasks } from "@/lib/pending-agent-tasks";

export async function POST(request: Request) {
  if (!verifyInternalAgentActionToken(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    agentOpenclawId?: string;
    limit?: number;
  };
  const agentOpenclawId = body.agentOpenclawId?.trim();

  if (!agentOpenclawId) {
    return NextResponse.json(
      { error: "agentOpenclawId is required." },
      { status: 400 },
    );
  }

  const result = await listPendingAgentTasks({
    agentOpenclawId,
    limit: body.limit,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
