import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { leaveVideoCall } from "@/lib/video-calls";

export async function POST(
  _request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { callId } = await context.params;

  try {
    await leaveVideoCall(callId, user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "This call is not available to your account." },
      { status: 404 },
    );
  }
}
