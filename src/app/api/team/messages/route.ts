import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createTeamMessage, getTeamChannelDetail } from "@/lib/team";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");
  const detail = await getTeamChannelDetail(user.id, roomId);

  if (!detail) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  return NextResponse.json(detail);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    message?: string;
    roomId?: string;
  };
  const roomId = body.roomId?.trim();
  const message = body.message?.trim();

  if (!roomId || !message) {
    return NextResponse.json({ error: "Room and message are required." }, { status: 400 });
  }

  const created = await createTeamMessage(user.id, roomId, message);

  if (!created) {
    return NextResponse.json({ error: "Message could not be created." }, { status: 404 });
  }

  return NextResponse.json({
    message: {
      author: created.user?.displayName ?? user.displayName,
      content: created.content,
      createdAt: created.createdAt.toISOString(),
      id: created.id,
      userId: created.userId ?? user.id,
    },
  });
}
