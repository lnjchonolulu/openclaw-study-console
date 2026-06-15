import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { startScheduledVideoCall } from "@/lib/video-calls";

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
    const call = await startScheduledVideoCall(callId, user.id);
    return NextResponse.json({ call });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "This scheduled call could not be started.",
      },
      { status: 400 },
    );
  }
}
