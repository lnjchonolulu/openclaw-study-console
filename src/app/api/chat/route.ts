import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

async function getOrCreateDmRoom(userId: string, targetAgentId: string) {
  const targetAgent = await prisma.agent.findUnique({
    where: {
      openclawAgentId: targetAgentId,
    },
  });

  if (!targetAgent) {
    return null;
  }

  const existingRoom = await prisma.room.findFirst({
    where: {
      type: "PERSONAL",
      ownerUserId: userId,
      agents: {
        some: {
          agentId: targetAgent.id,
        },
      },
    },
  });

  if (existingRoom) {
    return {
      room: existingRoom,
      targetAgent,
    };
  }

  const legacyOwnRoom =
    targetAgent.userId === userId
      ? await prisma.room.findFirst({
          where: {
            type: "PERSONAL",
            ownerUserId: userId,
            agents: {
              none: {},
            },
          },
        })
      : null;

  if (legacyOwnRoom) {
    await prisma.roomAgent.create({
      data: {
        roomId: legacyOwnRoom.id,
        agentId: targetAgent.id,
        role: "PRIMARY",
      },
    });

    return {
      room: legacyOwnRoom,
      targetAgent,
    };
  }

  const room = await prisma.room.create({
    data: {
      type: "PERSONAL",
      name: targetAgent.displayName,
      ownerUserId: userId,
      members: {
        create: {
          userId,
          role: "OWNER",
          canManageRoom: true,
          canManageAgents: true,
          canShareFiles: true,
        },
      },
      agents: {
        create: {
          agentId: targetAgent.id,
          role: "PRIMARY",
        },
      },
    },
  });

  return {
    room,
    targetAgent,
  };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as { agentId?: string; message?: string };
  const targetAgentId = body.agentId?.trim() || user.agent?.openclawAgentId;
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  if (!targetAgentId) {
    return NextResponse.json(
      { error: "This study account is not linked to an OpenClaw agent yet." },
      { status: 400 },
    );
  }

  const dmRoom = await getOrCreateDmRoom(user.id, targetAgentId);

  if (!dmRoom) {
    return NextResponse.json({ error: "Selected agent was not found." }, { status: 404 });
  }

  await prisma.message.create({
    data: {
      roomId: dmRoom.room.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  try {
    const result = await runAgentTurn({
      agentId: dmRoom.targetAgent.openclawAgentId,
      message,
      conversationKey: `room:${dmRoom.room.id}`,
    });

    await prisma.message.create({
      data: {
        roomId: dmRoom.room.id,
        role: "AGENT",
        agentId: dmRoom.targetAgent.openclawAgentId,
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
