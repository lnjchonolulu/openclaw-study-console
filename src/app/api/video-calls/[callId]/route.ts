import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { removeVideoCallFromUserList } from "@/lib/video-calls";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { callId } = await context.params;
  await removeVideoCallFromUserList(callId, user.id);

  return NextResponse.json({ ok: true });
}
