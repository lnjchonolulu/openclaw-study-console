import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreatePersonDmRoom } from "@/lib/dm";
import { prisma } from "@/lib/prisma";

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

  const personDm = await getOrCreatePersonDmRoom(user.id, recipientId);

  if (!personDm) {
    return NextResponse.json({ error: "Selected person was not found." }, { status: 404 });
  }

  const room = personDm.room;

  await prisma.typingState.deleteMany({
    where: {
      roomId: room.id,
      userId: user.id,
    },
  });

  const createdMessage = await prisma.message.create({
    data: {
      roomId: room.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  await prisma.room.update({
    where: {
      id: room.id,
    },
    data: {},
  });

  return NextResponse.json({
    ok: true,
    roomId: room.id,
    message: {
      id: createdMessage.id,
      content: createdMessage.content,
      createdAt: createdMessage.createdAt.toISOString(),
    },
  });
}
