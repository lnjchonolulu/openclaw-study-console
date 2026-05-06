import { prisma } from "@/lib/prisma";

export type ChatMessage = {
  id: string;
  role: "USER" | "AGENT" | "OTHER";
  content: string;
  createdAt: string;
};

export type DmItem = {
  id: string;
  kind: "agent" | "person";
  displayName: string;
  meta: string;
  isOwnAgent: boolean;
  roomId: string | null;
  unreadCount: number;
};

async function ensureRoomMembership(roomId: string, userId: string) {
  const room = await prisma.room.findUnique({
    where: {
      id: roomId,
    },
    select: {
      id: true,
      ownerUserId: true,
    },
  });

  if (!room) {
    return;
  }

  const isOwner = room.ownerUserId === userId;

  await prisma.roomMember.upsert({
    where: {
      roomId_userId: {
        roomId,
        userId,
      },
    },
    update: {},
    create: {
      roomId,
      userId,
      role: isOwner ? "OWNER" : "MEMBER",
      canManageRoom: isOwner,
      canManageAgents: isOwner,
      canShareFiles: true,
    },
  });
}

export async function getOrCreateAgentDmRoom(userId: string, targetAgentId: string) {
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
    await ensureRoomMembership(existingRoom.id, userId);

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
    await ensureRoomMembership(legacyOwnRoom.id, userId);

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

export async function getOrCreatePersonDmRoom(userId: string, recipientId: string) {
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
    return {
      room: existingRoom,
      targetUser: recipient,
    };
  }

  const room = await prisma.room.create({
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

  return {
    room,
    targetUser: recipient,
  };
}

export function serializeChatMessages(
  messages: {
    id: string;
    role: "USER" | "AGENT" | "SYSTEM";
    content: string;
    createdAt: Date;
    userId: string | null;
  }[],
  currentUserId: string,
): ChatMessage[] {
  return messages
    .filter((message) => message.role === "USER" || message.role === "AGENT")
    .map((message) => ({
      id: message.id,
      role:
        message.role === "AGENT"
          ? "AGENT"
          : message.userId === currentUserId
            ? "USER"
            : "OTHER",
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    }));
}

export async function markRoomAsRead(roomId: string, userId: string) {
  await markRoomAsReadAt(roomId, userId, new Date());
}

export async function markRoomAsReadAt(
  roomId: string,
  userId: string,
  timestamp: Date,
) {
  await ensureRoomMembership(roomId, userId);

  await prisma.roomMember.updateMany({
    where: {
      roomId,
      userId,
    },
    data: {
      lastReadAt: timestamp,
    },
  });
}

export async function getDmCollections(userId: string) {
  const dmTargets = await prisma.agent.findMany({
    where: {
      user: {
        status: "ACTIVE",
      },
    },
    orderBy: {
      displayName: "asc",
    },
    select: {
      openclawAgentId: true,
      displayName: true,
      userId: true,
    },
  });

  const peopleTargets = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      id: {
        not: userId,
      },
    },
    orderBy: {
      displayName: "asc",
    },
    select: {
      id: true,
      displayName: true,
      username: true,
    },
  });

  const existingDmRooms = await prisma.room.findMany({
    where: {
      OR: [
        {
          type: "PERSONAL",
          ownerUserId: userId,
        },
        {
          type: "GROUP",
          members: {
            some: {
              userId,
            },
          },
          agents: {
            none: {},
          },
        },
      ],
    },
    orderBy: {
      updatedAt: "desc",
    },
    include: {
      agents: {
        include: {
          agent: true,
        },
      },
      members: {
        include: {
          user: true,
        },
      },
    },
  });

  await Promise.all(
    existingDmRooms.map((room) => ensureRoomMembership(room.id, userId)),
  );

  const unreadCounts = await Promise.all(
    existingDmRooms.map(async (room) => {
      const membership = room.members.find((member) => member.userId === userId);
      const lastReadAt = membership?.lastReadAt ?? new Date(0);

      const unreadCount = await prisma.message.count({
        where: {
          roomId: room.id,
          createdAt: {
            gt: lastReadAt,
          },
          OR: [
            {
              role: "AGENT",
            },
            {
              role: "USER",
              userId: {
                not: userId,
              },
            },
          ],
        },
      });

      return [room.id, unreadCount] as const;
    }),
  );

  const unreadByRoomId = new Map(unreadCounts);
  const existingDmAgentIds = new Set(
    existingDmRooms.flatMap((room) =>
      room.agents.map((roomAgent) => roomAgent.agent.openclawAgentId),
    ),
  );
  const existingDmUserIds = new Set(
    existingDmRooms.flatMap((room) =>
      room.members
        .map((member) => member.user.id)
        .filter((memberUserId) => memberUserId !== userId),
    ),
  );

  const conversationsFromRooms = existingDmRooms.reduce<DmItem[]>((items, room) => {
    if (room.type === "PERSONAL") {
      const roomAgent = room.agents[0]?.agent;

      if (!roomAgent) {
        return items;
      }

      items.push({
        id: roomAgent.openclawAgentId,
        kind: "agent",
        displayName: roomAgent.displayName,
        meta: roomAgent.userId === userId ? "Personal agent" : "Agent",
        isOwnAgent: roomAgent.userId === userId,
        roomId: room.id,
        unreadCount: unreadByRoomId.get(room.id) ?? 0,
      });

      return items;
    }

    const counterpart = room.members.find((member) => member.userId !== userId);

    if (!counterpart) {
      return items;
    }

    items.push({
      id: counterpart.user.id,
      kind: "person",
      displayName: counterpart.user.displayName,
      meta: `@${counterpart.user.username}`,
      isOwnAgent: false,
      roomId: room.id,
      unreadCount: unreadByRoomId.get(room.id) ?? 0,
    });

    return items;
  }, []);

  const ownAgent = dmTargets.find((agent) => agent.userId === userId);
  const dmConversations =
    ownAgent &&
    !conversationsFromRooms.some(
      (item) => item.kind === "agent" && item.id === ownAgent.openclawAgentId,
    )
      ? [
          {
            id: ownAgent.openclawAgentId,
            kind: "agent" as const,
            displayName: ownAgent.displayName,
            meta: "Personal agent",
            isOwnAgent: true,
            roomId: null,
            unreadCount: 0,
          },
          ...conversationsFromRooms,
        ]
      : conversationsFromRooms;

  const availableDmTargets: DmItem[] = [
    ...peopleTargets
      .filter((person) => !existingDmUserIds.has(person.id))
      .map((person) => ({
        id: person.id,
        kind: "person" as const,
        displayName: person.displayName,
        meta: `@${person.username}`,
        isOwnAgent: false,
        roomId: null,
        unreadCount: 0,
      })),
    ...dmTargets
      .filter(
        (agent) =>
          agent.userId !== userId && !existingDmAgentIds.has(agent.openclawAgentId),
      )
      .map((agent) => ({
        id: agent.openclawAgentId,
        kind: "agent" as const,
        displayName: agent.displayName,
        meta: "Agent",
        isOwnAgent: false,
        roomId: null,
        unreadCount: 0,
      })),
  ];

  return {
    dmConversations,
    availableDmTargets,
  };
}
