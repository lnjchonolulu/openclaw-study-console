import { NextResponse } from "next/server";
import {
  scheduleAgentDm,
  verifyInternalAgentActionToken,
} from "@/lib/internal-agent-actions";

const MAX_DELAY_MINUTES = 60 * 24 * 14;

function resolveDeliverAt(body: { delayMinutes?: unknown; deliverAt?: unknown }) {
  if (typeof body.delayMinutes === "number" && Number.isFinite(body.delayMinutes)) {
    const clampedMinutes = Math.min(Math.max(body.delayMinutes, 1), MAX_DELAY_MINUTES);
    return new Date(Date.now() + clampedMinutes * 60 * 1000);
  }

  if (typeof body.deliverAt === "string") {
    const date = new Date(body.deliverAt);

    if (Number.isFinite(date.getTime()) && date.getTime() > Date.now()) {
      return date;
    }
  }

  return null;
}

export async function POST(request: Request) {
  if (!verifyInternalAgentActionToken(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    delayMinutes?: unknown;
    deliverAt?: unknown;
    message?: string;
    senderAgentOpenclawId?: string;
    toUsername?: string;
  };

  const senderAgentOpenclawId = body.senderAgentOpenclawId?.trim();
  const toUsername = body.toUsername?.trim().replace(/^@/, "").toLowerCase();
  const message = body.message?.trim();
  const deliverAt = resolveDeliverAt(body);

  if (!senderAgentOpenclawId || !toUsername || !message || !deliverAt) {
    return NextResponse.json(
      {
        error:
          "senderAgentOpenclawId, toUsername, message, and a future delayMinutes or deliverAt are required.",
      },
      { status: 400 },
    );
  }

  const result = await scheduleAgentDm({
    deliverAt,
    message,
    senderAgentOpenclawId,
    toUsername,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
