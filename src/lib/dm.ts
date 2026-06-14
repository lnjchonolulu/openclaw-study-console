import { prisma } from "@/lib/prisma";
import {
  attachmentPreviewText,
  normalizeChatAttachments,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import {
  getAgentMeta,
  getUserMeta,
  normalizeProfileConfig,
  type AvatarViewModel,
} from "@/lib/profile";

export type ChatMessage = {
  authorAvatar?: AvatarViewModel | null;
  authorName?: string | null;
  attachments: ChatAttachment[];
  id: string;
  role: "USER" | "AGENT" | "OTHER";
  content: string;
  createdAt: string;
  replyTo?: {
    authorName: string | null;
    content: string;
    id: string;
    role: "USER" | "AGENT" | "OTHER";
  } | null;
};

type SerializableMessage = {
  agent?: {
    displayName: string;
    profileConfigJson: unknown;
    user: {
      username: string;
    } | null;
  } | null;
  content: string;
  attachmentsJson?: unknown;
  createdAt: Date;
  id: string;
  replyToMessage?: {
    agent?: {
      displayName: string;
      user: {
        username: string;
      } | null;
    } | null;
    content: string;
    attachmentsJson?: unknown;
    id: string;
    role: "USER" | "AGENT" | "SYSTEM";
    user?: {
      displayName: string;
    } | null;
    userId: string | null;
  } | null;
  role: "USER" | "AGENT" | "SYSTEM";
  user?: {
    displayName: string;
    profileConfigJson: unknown;
    username: string;
  } | null;
  userId: string | null;
};

function getSerializedMessageRole(
  message: Pick<SerializableMessage, "role" | "userId">,
  currentUserId: string,
) {
  if (message.role === "AGENT") {
    return "AGENT" as const;
  }

  return message.userId === currentUserId ? ("USER" as const) : ("OTHER" as const);
}

function buildReplyPreview(
  replyToMessage: SerializableMessage["replyToMessage"],
  currentUserId: string,
) {
  if (!replyToMessage || replyToMessage.role === "SYSTEM") {
    return null;
  }

  return {
    authorName:
      replyToMessage.role === "AGENT"
        ? replyToMessage.agent?.displayName ?? null
        : replyToMessage.user?.displayName ?? null,
    content:
      replyToMessage.content ||
      attachmentPreviewText(normalizeChatAttachments(replyToMessage.attachmentsJson)),
    id: replyToMessage.id,
    role: getSerializedMessageRole(replyToMessage, currentUserId),
  };
}

export type DmItem = {
  avatar: AvatarViewModel;
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
    include: {
      user: true,
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
  messages: SerializableMessage[],
  currentUserId: string,
): ChatMessage[] {
  return messages
    .filter((message) => message.role === "USER" || message.role === "AGENT")
    .map((message) => ({
      authorAvatar:
        message.role === "AGENT"
          ? {
              kind: "agent" as const,
              config: normalizeProfileConfig(
                message.agent?.profileConfigJson,
                `${message.agent?.user?.username ?? "agent"}-agent`,
                "agent",
              ),
            }
          : message.user
            ? {
                kind: "user" as const,
                config: normalizeProfileConfig(
                  message.user.profileConfigJson,
                  message.user.username,
                  "user",
                ),
              }
            : null,
      authorName:
        message.role === "AGENT"
          ? message.agent?.displayName ?? null
          : message.user?.displayName ?? null,
      id: message.id,
      role: getSerializedMessageRole(message, currentUserId),
      attachments: normalizeChatAttachments(message.attachmentsJson),
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      replyTo: buildReplyPreview(message.replyToMessage, currentUserId),
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
      profileConfigJson: true,
      openclawAgentId: true,
      displayName: true,
      userId: true,
      user: {
        select: {
          username: true,
        },
      },
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
      profileConfigJson: true,
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
    include: {
      agents: {
        include: {
          agent: {
            include: {
              user: true,
            },
          },
        },
      },
      messages: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          createdAt: true,
        },
      },
      members: {
        include: {
          user: true,
        },
      },
    },
  });

  existingDmRooms.sort((left, right) => {
    const leftTimestamp =
      left.messages[0]?.createdAt.getTime() ?? left.createdAt.getTime();
    const rightTimestamp =
      right.messages[0]?.createdAt.getTime() ?? right.createdAt.getTime();

    return rightTimestamp - leftTimestamp;
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
        avatar: {
          kind: "agent" as const,
          config: normalizeProfileConfig(
            roomAgent.profileConfigJson,
            `${roomAgent.user?.username ?? roomAgent.openclawAgentId}-agent`,
            "agent",
          ),
        },
        id: roomAgent.openclawAgentId,
        kind: "agent",
        displayName: roomAgent.displayName,
        meta: getAgentMeta(roomAgent.user?.username ?? "agent"),
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
      avatar: {
        kind: "user" as const,
        config: normalizeProfileConfig(
          counterpart.user.profileConfigJson,
          counterpart.user.username,
          "user",
        ),
      },
      id: counterpart.user.id,
      kind: "person",
      displayName: counterpart.user.displayName,
      meta: getUserMeta(counterpart.user.username),
      isOwnAgent: false,
      roomId: room.id,
      unreadCount: unreadByRoomId.get(room.id) ?? 0,
    });

    return items;
  }, []);

  const dmConversations = conversationsFromRooms;

  const availableDmTargets: DmItem[] = [
    ...peopleTargets
      .filter((person) => !existingDmUserIds.has(person.id))
      .map((person) => ({
        avatar: {
          kind: "user" as const,
          config: normalizeProfileConfig(person.profileConfigJson, person.username, "user"),
        },
        id: person.id,
        kind: "person" as const,
        displayName: person.displayName,
        meta: getUserMeta(person.username),
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
        avatar: {
          kind: "agent" as const,
          config: normalizeProfileConfig(
            agent.profileConfigJson,
            `${agent.user.username}-agent`,
            "agent",
          ),
        },
        id: agent.openclawAgentId,
        kind: "agent" as const,
        displayName: agent.displayName,
        meta: getAgentMeta(agent.user.username),
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
