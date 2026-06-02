import { NextResponse } from "next/server";
import { pollTrackedEmailReplies } from "@/lib/email-tracking";
import { verifyInternalAgentActionToken } from "@/lib/internal-agent-actions";

export async function POST(request: Request) {
  if (!verifyInternalAgentActionToken(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await pollTrackedEmailReplies();

  return NextResponse.json(result);
}
