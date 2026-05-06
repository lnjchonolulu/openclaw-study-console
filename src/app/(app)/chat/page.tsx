import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ChatClient } from "@/components/chat-client";

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

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const user = await requireUser();
  const selectedAgentParam = (await searchParams).agent;
  const selectedAgentId =
    typeof selectedAgentParam === "string"
      ? selectedAgentParam
      : user.agent?.openclawAgentId;
  const dmRoom =
    selectedAgentId ? await getOrCreateDmRoom(user.id, selectedAgentId) : null;
  const room =
    dmRoom &&
    (await prisma.room.findUnique({
      where: {
        id: dmRoom.room.id,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
          take: 20,
        },
      },
    }));

  const initialMessages =
    room?.messages
      .filter(
        (
          entry,
        ): entry is typeof entry & {
          role: "USER" | "AGENT";
        } => entry.role === "USER" || entry.role === "AGENT",
      )
      .map((entry) => ({
        id: entry.id,
        role: entry.role,
        content: entry.content,
      })) ?? [
      {
        id: "welcome-agent",
        role: "AGENT" as const,
        content: `Hi. You are now talking with ${
          dmRoom?.targetAgent.displayName ?? "your agent"
        }.`,
      },
    ];

  return (
    <section className="chat-page">
      <ChatClient
        key={dmRoom?.targetAgent.openclawAgentId ?? "unassigned-agent"}
        agentId={dmRoom?.targetAgent.openclawAgentId ?? null}
        initialMessages={initialMessages}
      />
    </section>
  );
}
