import { NextResponse } from "next/server";
import { AgentTaskEventType } from "@prisma/client";
import { recordAgentActionReceipt } from "@/lib/action-receipts";
import {
  sendAgentDm,
  verifyInternalAgentActionToken,
} from "@/lib/internal-agent-actions";

export async function POST(request: Request) {
  if (!verifyInternalAgentActionToken(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    message?: string;
    objective?: string;
    requesterUserId?: string;
    senderAgentOpenclawId?: string;
    sourceRoomId?: string;
    taskId?: string;
    toUsername?: string;
  };

  const senderAgentOpenclawId = body.senderAgentOpenclawId?.trim();
  const toUsername = body.toUsername?.trim().replace(/^@/, "").toLowerCase();
  const message = body.message?.trim();

  if (!senderAgentOpenclawId || !toUsername || !message) {
    return NextResponse.json(
      { error: "senderAgentOpenclawId, toUsername, and message are required." },
      { status: 400 },
    );
  }

  const result = await sendAgentDm({
    message,
    senderAgentOpenclawId,
    taskId: body.taskId?.trim() || null,
    toUsername,
  });

  await recordAgentActionReceipt({
    action: "send_dm",
    agentOpenclawId: senderAgentOpenclawId,
    eventType: result.ok ? AgentTaskEventType.OUTBOUND_MESSAGE : AgentTaskEventType.SYSTEM_NOTE,
    objective: body.objective,
    payload: {
      messageId: result.ok ? result.messageId : null,
      reason: result.ok ? null : result.reason,
      roomId: result.ok ? result.roomId : null,
      toUsername,
    },
    requesterUserId: body.requesterUserId?.trim() || null,
    sourceRoomId: body.sourceRoomId?.trim() || null,
    status: result.ok ? "success" : "failure",
    summary: result.ok
      ? `Delivered outbound DM to @${result.toUsername}.`
      : `DM delivery failed: ${result.reason}.`,
    taskId: body.taskId?.trim() || null,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
