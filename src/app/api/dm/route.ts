import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseChatPayload } from "@/lib/chat-attachments";
import { getOrCreatePersonDmRoom } from "@/lib/dm";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await parseChatPayload(request);
  const clientMessageId = body.clientMessageId || null;
  const message = body.message;
  const recipientId = body.recipientId;
  const replyToMessageId = body.replyToMessageId || null;

  if (!message && body.attachments.length === 0) {
    return NextResponse.json({ error: "Message or image is required." }, { status: 400 });
  }

  if (!recipientId) {
    return NextResponse.json({ error: "Recipient is required." }, { status: 400 });
  }

  const personDm = await getOrCreatePersonDmRoom(user.id, recipientId);

  if (!personDm) {
    return NextResponse.json({ error: "Selected person was not found." }, { status: 404 });
  }

  const room = personDm.room;

  if (replyToMessageId) {
    const replyTarget = await prisma.message.findFirst({
      where: {
        id: replyToMessageId,
        roomId: room.id,
      },
      select: {
        id: true,
      },
    });

    if (!replyTarget) {
      return NextResponse.json(
        { error: "Reply target was not found in this conversation." },
        { status: 400 },
      );
    }
  }

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
      attachmentsJson: body.attachments,
      replyToMessageId,
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
    userMessage: {
      clientMessageId,
      attachments: body.attachments,
      id: createdMessage.id,
      content: createdMessage.content,
      createdAt: createdMessage.createdAt.toISOString(),
    },
  });
}
