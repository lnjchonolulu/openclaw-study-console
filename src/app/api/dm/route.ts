import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getOrCreatePersonDmRoom(userId: string, recipientId: string) {
  if (userId === recipientId) {
    return null;
  }

  const recipient = await prisma.user.findUnique({
    where: {
      id: recipientId,
    },
  });

  if (!recipient || recipient.status !== "ACTIVE") {
    return null;
  }

  const existingRoom = await prisma.room.findFirst({
    where: {
      type: "GROUP",
      agents: {
        none: {},
      },
      AND: [
        {
          members: {
            some: {
              userId,
            },
          },
        },
        {
          members: {
            some: {
              userId: recipientId,
            },
          },
        },
      ],
    },
  });

  if (existingRoom) {
    return existingRoom;
  }

  return prisma.room.create({
    data: {
      type: "GROUP",
      name: recipient.displayName,
      ownerUserId: userId,
      members: {
        create: [
          {
            userId,
            role: "OWNER",
            canManageRoom: true,
            canShareFiles: true,
          },
          {
            userId: recipientId,
            role: "MEMBER",
            canShareFiles: true,
          },
        ],
      },
    },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    message?: string;
    recipientId?: string;
  };
  const message = body.message?.trim();
  const recipientId = body.recipientId?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  if (!recipientId) {
    return NextResponse.json({ error: "Recipient is required." }, { status: 400 });
  }

  const room = await getOrCreatePersonDmRoom(user.id, recipientId);

  if (!room) {
    return NextResponse.json({ error: "Selected person was not found." }, { status: 404 });
  }

  await prisma.message.create({
    data: {
      roomId: room.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  return NextResponse.json({ ok: true });
}
