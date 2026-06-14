import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { startVideoCallTranscription } from "@/lib/video-calls";

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
    const result = await startVideoCallTranscription(callId, user.id);

    if (!result.ok) {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Video call transcription could not be started.",
      },
      { status: 502 },
    );
  }
}
