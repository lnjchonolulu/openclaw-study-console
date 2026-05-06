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

async function getOrCreatePersonDmRoom(userId: string, targetUserId: string) {
  if (userId === targetUserId) {
    return null;
  }

  const targetUser = await prisma.user.findUnique({
    where: {
      id: targetUserId,
    },
  });

  if (!targetUser || targetUser.status !== "ACTIVE") {
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
              userId: targetUserId,
            },
          },
        },
      ],
    },
  });

  if (existingRoom) {
    return {
      room: existingRoom,
      targetUser,
    };
  }

  const room = await prisma.room.create({
    data: {
      type: "GROUP",
      name: targetUser.displayName,
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
            userId: targetUserId,
            role: "MEMBER",
            canShareFiles: true,
          },
        ],
      },
    },
  });

  return {
    room,
    targetUser,
  };
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[]; user?: string | string[] }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const selectedUserParam = query.user;
  const selectedUserId =
    typeof selectedUserParam === "string" ? selectedUserParam : null;
  const selectedAgentParam = query.agent;
  const selectedAgentId =
    !selectedUserId && typeof selectedAgentParam === "string"
      ? selectedAgentParam
      : user.agent?.openclawAgentId;
  const personDmRoom = selectedUserId
    ? await getOrCreatePersonDmRoom(user.id, selectedUserId)
    : null;
  const agentDmRoom =
    !selectedUserId && selectedAgentId
      ? await getOrCreateDmRoom(user.id, selectedAgentId)
      : null;
  const selectedRoom = personDmRoom ?? agentDmRoom;
  const room =
    selectedRoom &&
    (await prisma.room.findUnique({
      where: {
        id: selectedRoom.room.id,
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
        role:
          entry.role === "AGENT"
            ? ("AGENT" as const)
            : entry.userId === user.id
              ? ("USER" as const)
              : ("OTHER" as const),
        content: entry.content,
      })) ?? [
      {
        id: "welcome-agent",
        role: "AGENT" as const,
        content: `Hi. You are now talking with ${
          personDmRoom?.targetUser.displayName ??
          agentDmRoom?.targetAgent.displayName ??
          "your agent"
        }.`,
      },
    ];

  return (
    <section className="chat-page">
      <ChatClient
        agentId={agentDmRoom?.targetAgent.openclawAgentId ?? null}
        initialMessages={initialMessages}
        key={
          personDmRoom
            ? `person:${personDmRoom.targetUser.id}`
            : `agent:${agentDmRoom?.targetAgent.openclawAgentId ?? "unassigned"}`
        }
        roomId={room?.id ?? null}
        recipientId={personDmRoom?.targetUser.id ?? null}
        recipientKind={personDmRoom ? "person" : "agent"}
      />
    </section>
  );
}
