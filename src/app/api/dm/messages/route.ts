import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { markRoomAsRead, serializeChatMessages } from "@/lib/dm";
import { prisma } from "@/lib/prisma";

const OLDER_DM_PAGE_SIZE = 20;
const RECENT_DM_PAGE_SIZE = 100;

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");
  const before = url.searchParams.get("before");

  if (!roomId) {
    return NextResponse.json({ error: "Room is required." }, { status: 400 });
  }

  const beforeDate = before ? new Date(before) : null;

  if (before && (!beforeDate || Number.isNaN(beforeDate.getTime()))) {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }

  const pageSize = beforeDate ? OLDER_DM_PAGE_SIZE : RECENT_DM_PAGE_SIZE;

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
        where: beforeDate
          ? {
              createdAt: {
                lt: beforeDate,
              },
            }
          : undefined,
        orderBy: {
          createdAt: "desc",
        },
        take: pageSize + 1,
        include: {
          agent: {
            include: {
              user: true,
            },
          },
          replyToMessage: {
            include: {
              agent: {
                include: {
                  user: true,
                },
              },
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

  const hasOlderMessages = room.messages.length > pageSize;

  if (hasOlderMessages) {
    room.messages = room.messages.slice(0, pageSize);
  }

  room.messages.reverse();

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
    hasOlderMessages,
    messages: serializeChatMessages(room.messages, user.id),
    isOtherTyping: activeTyping.length > 0,
  });
}
