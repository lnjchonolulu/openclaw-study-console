import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { markRoomAsRead } from "@/lib/dm";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as { roomId?: string };
  const roomId = body.roomId?.trim();

  if (!roomId) {
    return NextResponse.json({ error: "Room is required." }, { status: 400 });
  }

  const membership = await prisma.roomMember.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Room was not found." }, { status: 404 });
  }

  await markRoomAsRead(roomId, user.id);

  return NextResponse.json({ ok: true });
}
