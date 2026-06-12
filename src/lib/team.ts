import { prisma } from "@/lib/prisma";
import {
  getAgentMeta,
  getUserMeta,
  normalizeProfileConfig,
  type AvatarViewModel,
} from "@/lib/profile";

export type TeamParticipant = {
  avatar: AvatarViewModel;
  id: string;
  kind: "agent" | "user";
  meta: string;
  messageKey: string;
  name: string;
  username: string;
};

export type TeamChannelSummary = {
  createdBy: string | null;
  id: string;
  memberCount: number;
  purpose: string | null;
  title: string;
};

export type TeamChannelDetail = {
  createdBy: string | null;
  id: string;
  members: TeamParticipant[];
  messages: {
    author: string;
    content: string;
    createdAt: string;
    id: string;
    replyTo?: {
      author: string;
      content: string;
      id: string;
      userId: string;
    } | null;
    senderKey: string;
    userId: string;
  }[];
  purpose: string | null;
  title: string;
};

async function getTeamContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      team: {
        include: {
          users: {
            where: {
              status: "ACTIVE",
            },
            orderBy: {
              displayName: "asc",
            },
            include: {
              agent: true,
            },
          },
        },
      },
    },
  });

  if (!user?.team) {
    return null;
  }

  return {
    team: user.team,
    user,
  };
}

function mapParticipant(user: {
  profileConfigJson?: unknown;
  displayName: string;
  id: string;
  username: string;
}) {
  return {
    avatar: {
      kind: "user" as const,
      config: normalizeProfileConfig(user.profileConfigJson, user.username, "user"),
    },
    id: user.id,
    kind: "user" as const,
    messageKey: user.id,
    name: user.displayName,
    meta: getUserMeta(user.username),
    username: user.username,
  };
}

function mapAgentParticipant(agent: {
  id: string;
  displayName?: string | null;
  openclawAgentId: string;
  profileConfigJson?: unknown;
  user: {
    username: string;
  };
}) {
  return {
    avatar: {
      kind: "agent" as const,
      config: normalizeProfileConfig(
        agent.profileConfigJson,
        `${agent.user.username}-agent`,
        "agent",
      ),
    },
    id: agent.id,
    kind: "agent" as const,
    messageKey: `agent:${agent.openclawAgentId}`,
    meta: getAgentMeta(agent.user.username),
    name: agent.displayName ?? `${agent.user.username}'s agent`,
    username: `${agent.user.username}-agent`,
  };
}

function compareParticipants(a: TeamParticipant, b: TeamParticipant) {
  const usernameOrder = a.username.localeCompare(b.username, "en", {
    sensitivity: "base",
  });

  return usernameOrder || a.id.localeCompare(b.id);
}

async function syncRoomAgents(roomId: string, memberUserIds: string[]) {
  const teamAgents = await prisma.agent.findMany({
    where: {
      userId: {
        in: memberUserIds,
      },
      user: {
        status: "ACTIVE",
      },
    },
    include: {
      user: true,
    },
  });

  const agentIds = teamAgents.map((agent) => agent.id);

  await prisma.roomAgent.deleteMany({
    where: {
      roomId,
      agentId: {
        notIn: agentIds.length > 0 ? agentIds : ["__none__"],
      },
    },
  });

  await Promise.all(
    teamAgents.map((agent) =>
      prisma.roomAgent.upsert({
        where: {
          roomId_agentId: {
            roomId,
            agentId: agent.id,
          },
        },
        update: {
          role: "COLLABORATOR",
          canRespond: true,
          canUseFiles: true,
          canBeMentioned: true,
        },
        create: {
          roomId,
          agentId: agent.id,
          role: "COLLABORATOR",
          canRespond: true,
          canUseFiles: true,
          canBeMentioned: true,
        },
      }),
    ),
  );
}

function mergeParticipants(
  userMembers: Array<{
    user: {
      displayName: string;
      id: string;
      username: string;
    };
  }>,
  agentMembers: Array<{
    agent: {
      id: string;
      openclawAgentId: string;
      user: {
        displayName: string;
        username: string;
      };
    };
  }>,
) {
  const users = userMembers
    .map((member) => mapParticipant(member.user))
    .sort(compareParticipants);
  const agents = agentMembers
    .map((member) => mapAgentParticipant(member.agent))
    .sort(compareParticipants);

  return [
    ...users,
    ...agents,
  ];
}

function buildChannelParticipants(args: {
  agentMembers: Array<{
    agent: {
      id: string;
      openclawAgentId: string;
      user: {
        displayName: string;
        username: string;
      };
    };
  }>;
  userMembers: Array<{
    user: {
      displayName: string;
      id: string;
      username: string;
    };
  }>;
}) {
  return mergeParticipants(args.userMembers, args.agentMembers);
}

export async function ensureGeneralTeamChannel(userId: string) {
  const context = await getTeamContext(userId);

  if (!context) {
    return null;
  }

  const existing = await prisma.room.findFirst({
    where: {
      type: "TEAM",
      teamId: context.team.id,
      name: "General",
    },
  });

  if (existing) {
    const teamUsers = context.team.users;

    await Promise.all(
      teamUsers.map((teamUser) =>
        prisma.roomMember.upsert({
          where: {
            roomId_userId: {
              roomId: existing.id,
              userId: teamUser.id,
            },
          },
          update: {},
          create: {
            roomId: existing.id,
            userId: teamUser.id,
            role: teamUser.id === context.user.id ? "OWNER" : "MEMBER",
            canManageRoom: teamUser.id === context.user.id,
            canShareFiles: true,
          },
        }),
      ),
    );

    await syncRoomAgents(
      existing.id,
      teamUsers.map((teamUser) => teamUser.id),
    );

    return existing;
  }

  const created = await prisma.room.create({
    data: {
      type: "TEAM",
      name: "General",
      teamId: context.team.id,
      ownerUserId: context.user.id,
      members: {
        create: context.team.users.map((teamUser) => ({
          userId: teamUser.id,
          role: teamUser.id === context.user.id ? "OWNER" : "MEMBER",
          canManageRoom: teamUser.id === context.user.id,
          canShareFiles: true,
        })),
      },
    },
  });

  await syncRoomAgents(
    created.id,
    context.team.users.map((teamUser) => teamUser.id),
  );

  return created;
}

export async function listTeamParticipants(userId: string): Promise<TeamParticipant[]> {
  const context = await getTeamContext(userId);

  if (!context) {
    return [];
  }

  return context.team.users.flatMap((member) => {
    const participants: TeamParticipant[] = [mapParticipant(member)];

    if (member.agent) {
      participants.push(
        mapAgentParticipant({
          displayName: member.agent.displayName,
          id: member.agent.id,
          openclawAgentId: member.agent.openclawAgentId,
          profileConfigJson: member.agent.profileConfigJson,
          user: {
            username: member.username,
          },
        }),
      );
    }

    return participants;
  });
}

export async function listTeamChannels(userId: string): Promise<TeamChannelSummary[]> {
  const context = await getTeamContext(userId);

  if (!context) {
    return [];
  }

  await ensureGeneralTeamChannel(userId);

  const rooms = await prisma.room.findMany({
    where: {
      AND: [
        {
          type: "TEAM",
          teamId: context.team.id,
        },
        {
          OR: [
            {
              ownerUserId: userId,
            },
            {
              members: {
                some: {
                  userId,
                },
              },
            },
            {
              agents: {
                some: {
                  agent: {
                    userId,
                  },
                },
              },
            },
          ],
        },
      ],
    },
    orderBy: [
      {
        createdAt: "asc",
      },
    ],
    include: {
      members: true,
      agents: true,
    },
  });

  return rooms.map((room) => ({
    createdBy: room.ownerUserId,
    id: room.id,
    memberCount: room.members.length + room.agents.length,
    purpose: room.purpose,
    title: room.name,
  }));
}

export async function getTeamChannelDetail(
  userId: string,
  roomId?: string | null,
): Promise<TeamChannelDetail | null> {
  const context = await getTeamContext(userId);

  if (!context) {
    return null;
  }

  const generalRoom = await ensureGeneralTeamChannel(userId);

  const targetRoomId = roomId ?? generalRoom?.id ?? null;

  if (!targetRoomId) {
    return null;
  }

  const room = await prisma.room.findFirst({
    where: {
      AND: [
        {
          id: targetRoomId,
          type: "TEAM",
          teamId: context.team.id,
        },
        {
          OR: [
            {
              ownerUserId: userId,
            },
            {
              members: {
                some: {
                  userId,
                },
              },
            },
            {
              agents: {
                some: {
                  agent: {
                    userId,
                  },
                },
              },
            },
          ],
        },
      ],
    },
    include: {
      members: {
        include: {
          user: true,
        },
      },
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
          createdAt: "asc",
        },
        include: {
          replyToMessage: {
            include: {
              agent: true,
              user: true,
            },
          },
          agent: true,
          user: true,
        },
      },
    },
  });

  if (!room) {
    const fallbackRoom =
      generalRoom &&
      (await prisma.room.findUnique({
        where: {
          id: generalRoom.id,
        },
        include: {
          members: {
            include: {
              user: true,
            },
          },
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
              createdAt: "asc",
            },
            include: {
              replyToMessage: {
                include: {
                  agent: true,
                  user: true,
                },
              },
              agent: true,
              user: true,
            },
          },
        },
      }));

    if (!fallbackRoom) {
      return null;
    }

    return {
      createdBy: fallbackRoom.ownerUserId,
      id: fallbackRoom.id,
      members: buildChannelParticipants({
        userMembers: fallbackRoom.members,
        agentMembers: fallbackRoom.agents,
      }),
      messages: fallbackRoom.messages.map((message) => ({
        author: message.user?.displayName ?? message.agent?.displayName ?? "Unknown",
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        id: message.id,
        replyTo: message.replyToMessage
          ? {
              author:
                message.replyToMessage.user?.displayName ??
                message.replyToMessage.agent?.displayName ??
                "Unknown",
              content: message.replyToMessage.content,
              id: message.replyToMessage.id,
              userId:
                message.replyToMessage.userId ??
                `agent:${message.replyToMessage.agentId ?? "unknown"}`,
            }
          : null,
        senderKey: message.userId ?? `agent:${message.agentId ?? "unknown"}`,
        userId: message.userId ?? `agent:${message.agentId ?? "unknown"}`,
      })),
      purpose: fallbackRoom.purpose,
      title: fallbackRoom.name,
    };
  }

  return {
    createdBy: room.ownerUserId,
    id: room.id,
    members: buildChannelParticipants({
      userMembers: room.members,
      agentMembers: room.agents,
    }),
    messages: room.messages.map((message) => ({
      author: message.user?.displayName ?? message.agent?.displayName ?? "Unknown",
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      id: message.id,
      replyTo: message.replyToMessage
        ? {
            author:
              message.replyToMessage.user?.displayName ??
              message.replyToMessage.agent?.displayName ??
              "Unknown",
            content: message.replyToMessage.content,
            id: message.replyToMessage.id,
            userId:
              message.replyToMessage.userId ??
              `agent:${message.replyToMessage.agentId ?? "unknown"}`,
          }
        : null,
      senderKey: message.userId ?? `agent:${message.agentId ?? "unknown"}`,
      userId: message.userId ?? `agent:${message.agentId ?? "unknown"}`,
    })),
    purpose: room.purpose,
    title: room.name,
  };
}

export async function createTeamChannel(
  userId: string,
  name: string,
  invitedUserIds: string[],
  invitedAgentIds: string[],
  purpose?: string | null,
) {
  const context = await getTeamContext(userId);

  if (!context) {
    return null;
  }

  const allowedUserIds = new Set(context.team.users.map((user) => user.id));
  const memberIds = Array.from(new Set([userId, ...invitedUserIds])).filter((id) =>
    allowedUserIds.has(id),
  );
  const allowedAgentIds = new Set(
    context.team.users
      .map((member) => member.agent?.id ?? null)
      .filter((value): value is string => Boolean(value)),
  );
  const agentIds = Array.from(new Set(invitedAgentIds)).filter((id) => allowedAgentIds.has(id));

  const created = await prisma.room.create({
    data: {
      type: "TEAM",
      name,
      purpose: purpose?.trim() || null,
      ownerUserId: userId,
      teamId: context.team.id,
      members: {
        create: memberIds.map((memberId) => ({
          userId: memberId,
          role: memberId === userId ? "OWNER" : "MEMBER",
          canManageRoom: memberId === userId,
          canShareFiles: true,
        })),
      },
      agents: {
        create: agentIds.map((agentId) => ({
          agentId,
          role: "COLLABORATOR",
          canRespond: true,
          canUseFiles: true,
          canBeMentioned: true,
        })),
      },
    },
  });

  return created;
}

export async function updateTeamChannel(
  userId: string,
  roomId: string,
  name: string,
  invitedUserIds: string[],
  invitedAgentIds: string[],
  purpose?: string | null,
) {
  const context = await getTeamContext(userId);

  if (!context) {
    return null;
  }

  const room = await prisma.room.findFirst({
    where: {
      id: roomId,
      type: "TEAM",
      teamId: context.team.id,
      members: {
        some: {
          userId,
        },
      },
    },
    include: {
      members: true,
    },
  });

  if (!room || room.name === "General") {
    return null;
  }

  const allowedUserIds = new Set(context.team.users.map((user) => user.id));
  const memberIds = Array.from(new Set([room.ownerUserId ?? userId, ...invitedUserIds])).filter(
    (id) => allowedUserIds.has(id),
  );
  const allowedAgentIds = new Set(
    context.team.users
      .map((member) => member.agent?.id ?? null)
      .filter((value): value is string => Boolean(value)),
  );
  const agentIds = Array.from(new Set(invitedAgentIds)).filter((id) => allowedAgentIds.has(id));

  await prisma.room.update({
    where: {
      id: room.id,
    },
    data: {
      name,
      purpose: purpose?.trim() || null,
    },
  });

  await prisma.roomMember.deleteMany({
    where: {
      roomId: room.id,
      userId: {
        notIn: memberIds,
      },
    },
  });

  await Promise.all(
    memberIds.map((memberId) =>
      prisma.roomMember.upsert({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: memberId,
          },
        },
        update: {
          role: memberId === room.ownerUserId ? "OWNER" : "MEMBER",
          canManageRoom: memberId === room.ownerUserId,
          canShareFiles: true,
        },
        create: {
          roomId: room.id,
          userId: memberId,
          role: memberId === room.ownerUserId ? "OWNER" : "MEMBER",
          canManageRoom: memberId === room.ownerUserId,
          canShareFiles: true,
        },
      }),
    ),
  );

  await prisma.roomAgent.deleteMany({
    where: {
      roomId: room.id,
      agentId: {
        notIn: agentIds.length > 0 ? agentIds : ["__none__"],
      },
    },
  });

  await Promise.all(
    agentIds.map((agentId) =>
      prisma.roomAgent.upsert({
        where: {
          roomId_agentId: {
            roomId: room.id,
            agentId,
          },
        },
        update: {
          role: "COLLABORATOR",
          canRespond: true,
          canUseFiles: true,
          canBeMentioned: true,
        },
        create: {
          roomId: room.id,
          agentId,
          role: "COLLABORATOR",
          canRespond: true,
          canUseFiles: true,
          canBeMentioned: true,
        },
      }),
    ),
  );

  return room;
}

export async function deleteTeamChannel(userId: string, roomId: string) {
  const room = await prisma.room.findFirst({
    where: {
      id: roomId,
      type: "TEAM",
      ownerUserId: userId,
    },
  });

  if (!room || room.name === "General") {
    return false;
  }

  await prisma.room.delete({
    where: {
      id: room.id,
    },
  });

  return true;
}

export async function createTeamMessage(
  userId: string,
  roomId: string,
  content: string,
  replyToMessageId?: string | null,
) {
  const room = await prisma.room.findFirst({
    where: {
      AND: [
        {
          id: roomId,
          type: "TEAM",
        },
        {
          OR: [
            {
              ownerUserId: userId,
            },
            {
              members: {
                some: {
                  userId,
                },
              },
            },
            {
              agents: {
                some: {
                  agent: {
                    userId,
                  },
                },
              },
            },
          ],
        },
      ],
    },
  });

  if (!room) {
    return null;
  }

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
      return null;
    }
  }

  return prisma.message.create({
    data: {
      roomId: room.id,
      userId,
      role: "USER",
      content,
      replyToMessageId: replyToMessageId?.trim() || null,
    },
    include: {
      replyToMessage: {
        include: {
          agent: true,
          user: true,
        },
      },
      agent: true,
      user: true,
    },
  });
}
