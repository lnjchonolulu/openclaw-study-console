import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getVideoCallTranscript } from "@/lib/video-calls";

export async function GET(
  _request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { callId } = await context.params;
  const transcript = await getVideoCallTranscript(callId, user.id);

  if (!transcript) {
    return NextResponse.json({ error: "Transcript was not found." }, { status: 404 });
  }

  return new Response(transcript.text, {
    headers: {
      "Content-Disposition": `attachment; filename="${transcript.filename}"`,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
