import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { markRoomAsRead, serializeChatMessages } from "@/lib/dm";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");

  if (!roomId) {
    return NextResponse.json({ error: "Room is required." }, { status: 400 });
  }

  const room = await prisma.room.findFirst({
    where: {
      id: roomId,
      members: {
        some: {
          userId: user.id,
        },
      },
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        take: 100,
        include: {
          agent: {
            include: {
              user: true,
            },
          },
          user: true,
        },
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Room was not found." }, { status: 404 });
  }

  const activeTyping = await prisma.typingState.findMany({
    where: {
      roomId,
      userId: {
        not: user.id,
      },
      expiresAt: {
        gt: new Date(),
      },
    },
  });

  await markRoomAsRead(room.id, user.id);

  return NextResponse.json({
    messages: serializeChatMessages(room.messages, user.id),
    isOtherTyping: activeTyping.length > 0,
  });
}
