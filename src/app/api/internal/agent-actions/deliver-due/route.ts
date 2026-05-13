import { NextResponse } from "next/server";
import {
  deliverDueScheduledMessages,
  verifyInternalAgentActionToken,
} from "@/lib/internal-agent-actions";

export async function POST(request: Request) {
  if (!verifyInternalAgentActionToken(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const results = await deliverDueScheduledMessages();

  return NextResponse.json({
    delivered: results.filter((result) => result.ok).length,
    results,
  });
}
