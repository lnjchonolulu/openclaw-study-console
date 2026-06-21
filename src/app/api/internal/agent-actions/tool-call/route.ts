import { NextResponse } from "next/server";
import { handleCyWorldAgentToolCall } from "@/lib/cyworld-agent-tools";
import { verifyInternalAgentActionToken } from "@/lib/internal-agent-actions";
import { loadValidAgentTurnContext } from "@/lib/agent-turn-context";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!verifyInternalAgentActionToken(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    argumentsJson?: unknown;
    callId?: unknown;
    senderAgentOpenclawId?: unknown;
    toolName?: unknown;
    turnContextId?: unknown;
  };
  const senderAgentOpenclawId = cleanString(body.senderAgentOpenclawId);
  const turnContextId = cleanString(body.turnContextId);
  const toolName = cleanString(body.toolName);
  const callId = cleanString(body.callId) || `${toolName}:${turnContextId}`;
  const argumentsJson =
    typeof body.argumentsJson === "string" ? body.argumentsJson : "";

  if (!senderAgentOpenclawId || !turnContextId || !toolName || !argumentsJson) {
    return NextResponse.json(
      {
        error:
          "senderAgentOpenclawId, turnContextId, toolName, and argumentsJson are required.",
      },
      { status: 400 },
    );
  }

  const turnContext = await loadValidAgentTurnContext({
    agentOpenclawId: senderAgentOpenclawId,
    turnContextId,
  });

  if (!turnContext) {
    return NextResponse.json(
      { error: "Turn context was not found, expired, or mismatched." },
      { status: 404 },
    );
  }

  const resultText = await handleCyWorldAgentToolCall({
    call: {
      argumentsJson,
      callId,
      name: toolName,
    },
    currentHumanUserId: turnContext.currentHumanUserId,
    objective: turnContext.objective ?? undefined,
    requesterUserId: turnContext.requesterUserId ?? undefined,
    senderAgentOpenclawId,
    sourceRoomId: turnContext.sourceRoomId ?? undefined,
    taskId: turnContext.taskId,
    triggerType: turnContext.triggerType,
  });

  return new Response(resultText, {
    headers: {
      "content-type": "application/json",
    },
    status: 200,
  });
}
