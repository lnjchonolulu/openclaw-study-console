import { NextResponse } from "next/server";
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
    senderAgentOpenclawId?: string;
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
    toUsername,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
