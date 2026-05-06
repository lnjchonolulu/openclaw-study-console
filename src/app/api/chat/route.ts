import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateAgentDmRoom, markRoomAsReadAt } from "@/lib/dm";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

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

  const dmRoom = await getOrCreateAgentDmRoom(user.id, targetAgentId);

  if (!dmRoom) {
    return NextResponse.json({ error: "Selected agent was not found." }, { status: 404 });
  }

  await prisma.typingState.deleteMany({
    where: {
      roomId: dmRoom.room.id,
      userId: user.id,
    },
  });

  await prisma.message.create({
    data: {
      roomId: dmRoom.room.id,
      userId: user.id,
      role: "USER",
      content: message,
    },
  });

  await prisma.room.update({
    where: {
      id: dmRoom.room.id,
    },
    data: {},
  });

  try {
    const audience =
      dmRoom.targetAgent.userId === user.id ? "direct_line" : "shared_spaces";
    const instructions = buildAgentRuntimeInstructions({
      agentDisplayName: dmRoom.targetAgent.displayName,
      audience,
      behaviorConfig: dmRoom.targetAgent.soulConfigJson,
      counterpartLabel:
        audience === "direct_line"
          ? `${user.displayName} (@${user.username})`
          : `${user.displayName} (@${user.username}), who is not the owner of this agent`,
      ownerDisplayName: dmRoom.targetAgent.user.displayName,
      ownerUsername: dmRoom.targetAgent.user.username,
      personaSummary: dmRoom.targetAgent.personaSummary,
    });

    const result = await runAgentTurn({
      agentId: dmRoom.targetAgent.openclawAgentId,
      instructions,
      message,
      conversationKey: `room:${dmRoom.room.id}`,
    });

    const replyMessage = await prisma.message.create({
      data: {
        roomId: dmRoom.room.id,
        role: "AGENT",
        agentId: dmRoom.targetAgent.openclawAgentId,
        content: result.assistantText,
      },
    });

    await prisma.room.update({
      where: {
        id: dmRoom.room.id,
      },
      data: {},
    });

    await markRoomAsReadAt(dmRoom.room.id, user.id, replyMessage.createdAt);

    return NextResponse.json({
      reply: result.assistantText,
      replyMessage: {
        id: replyMessage.id,
        content: replyMessage.content,
        createdAt: replyMessage.createdAt.toISOString(),
      },
      roomId: dmRoom.room.id,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to contact OpenClaw.";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
