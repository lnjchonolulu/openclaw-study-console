import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

async function getOrCreatePersonalRoom(userId: string) {
  const existingRoom = await prisma.room.findUnique({
    where: {
      ownerUserId: userId,
    },
  });

  if (existingRoom) {
    return existingRoom;
  }

  return prisma.room.create({
    data: {
      type: "PERSONAL",
      ownerUserId: userId,
    },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as { message?: string };
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  if (!user.agent?.openclawAgentId) {
    return NextResponse.json(
      { error: "This study account is not linked to an OpenClaw agent yet." },
      { status: 400 },
    );
  }

  const room = await getOrCreatePersonalRoom(user.id);

  await prisma.message.create({
    data: {
      roomId: room.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  try {
    const result = await runAgentTurn({
      agentId: user.agent.openclawAgentId,
      message,
    });

    await prisma.message.create({
      data: {
        roomId: room.id,
        role: "AGENT",
        agentId: user.agent.openclawAgentId,
        content: result.assistantText,
      },
    });

    return NextResponse.json({
      reply: result.assistantText,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to contact OpenClaw.";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
