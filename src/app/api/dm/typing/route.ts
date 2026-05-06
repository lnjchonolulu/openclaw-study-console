import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TYPING_TTL_MS = 4000;

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as { roomId?: string; isTyping?: boolean };
  const roomId = body.roomId?.trim();
  const isTyping = Boolean(body.isTyping);

  if (!roomId) {
    return NextResponse.json({ error: "Room is required." }, { status: 400 });
  }

  const membership = await prisma.room.findFirst({
    where: {
      id: roomId,
      type: "GROUP",
      agents: {
        none: {},
      },
      members: {
        some: {
          userId: user.id,
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Room was not found." }, { status: 404 });
  }

  if (!isTyping) {
    await prisma.typingState.deleteMany({
      where: {
        roomId,
        userId: user.id,
      },
    });

    return NextResponse.json({ ok: true, isTyping: false });
  }

  await prisma.typingState.upsert({
    where: {
      roomId_userId: {
        roomId,
        userId: user.id,
      },
    },
    update: {
      expiresAt: new Date(Date.now() + TYPING_TTL_MS),
    },
    create: {
      roomId,
      userId: user.id,
      expiresAt: new Date(Date.now() + TYPING_TTL_MS),
    },
  });

  return NextResponse.json({ ok: true, isTyping: true });
}
