import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasJoinedActiveVideoCall, joinVideoCall } from "@/lib/video-calls";

export async function POST(
  _request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { callId } = await context.params;

  if (await hasJoinedActiveVideoCall(user.id, callId)) {
    return NextResponse.json(
      { error: "Leave your current call before joining another one." },
      { status: 409 },
    );
  }

  try {
    await joinVideoCall(callId, user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "This call is not available to your account." },
      { status: 404 },
    );
  }
}
