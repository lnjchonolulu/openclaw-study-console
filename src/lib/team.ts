import { prisma } from "@/lib/prisma";

export type TeamParticipant = {
  id: string;
  kind?: "agent" | "user";
  name: string;
  status: string;
  username: string;
};

export type TeamChannelSummary = {
  createdBy: string | null;
  id: string;
  memberCount: number;
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
    userId: string;
  }[];
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
  displayName: string;
  id: string;
  username: string;
}) {
  return {
    id: user.id,
    kind: "user" as const,
    name: user.displayName,
    status: "Participant",
    username: user.username,
  };
}

function mapAgentParticipant(agent: {
  id: string;
  user: {
    displayName: string;
    username: string;
  };
}) {
  return {
    id: agent.id,
    kind: "agent" as const,
    name: `${agent.user.displayName}'s agent`,
    status: "Agent",
    username: `${agent.user.username}-agent`,
  };
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

async function clearRoomAgents(roomId: string) {
  await prisma.roomAgent.deleteMany({
    where: {
      roomId,
    },
  });
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
      user: {
        displayName: string;
        username: string;
      };
    };
  }>,
) {
  return [
    ...userMembers.map((member) => mapParticipant(member.user)),
    ...agentMembers.map((member) => mapAgentParticipant(member.agent)),
  ];
}

function buildChannelParticipants(args: {
  agentMembers: Array<{
    agent: {
      id: string;
      user: {
        displayName: string;
        username: string;
      };
    };
  }>;
  roomName: string;
  userMembers: Array<{
    user: {
      displayName: string;
      id: string;
      username: string;
    };
  }>;
}) {
  if (args.roomName === "General") {
    return mergeParticipants(args.userMembers, args.agentMembers);
  }

  return args.userMembers.map((member) => mapParticipant(member.user));
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

  return context.team.users.map(mapParticipant);
}

export async function listTeamChannels(userId: string): Promise<TeamChannelSummary[]> {
  const context = await getTeamContext(userId);

  if (!context) {
    return [];
  }

  await ensureGeneralTeamChannel(userId);

  const rooms = await prisma.room.findMany({
    where: {
      type: "TEAM",
      teamId: context.team.id,
      members: {
        some: {
          userId,
        },
      },
    },
    orderBy: [
      {
        createdAt: "asc",
      },
    ],
    include: {
      members: true,
    },
  });

  return rooms.map((room) => ({
    createdBy: room.ownerUserId,
    id: room.id,
    memberCount: room.members.length,
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
      id: targetRoomId,
      type: "TEAM",
      teamId: context.team.id,
      members: {
        some: {
          userId,
        },
      },
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
              user: true,
            },
          },
        },
      }));

    if (!fallbackRoom) {
      return null;
    }

    if (fallbackRoom.name !== "General" && fallbackRoom.agents.length > 0) {
      await clearRoomAgents(fallbackRoom.id);
    }

    return {
      createdBy: fallbackRoom.ownerUserId,
      id: fallbackRoom.id,
      members: buildChannelParticipants({
        roomName: fallbackRoom.name,
        userMembers: fallbackRoom.members,
        agentMembers: fallbackRoom.agents,
      }),
      messages: fallbackRoom.messages.map((message) => ({
        author: message.user?.displayName ?? "Unknown",
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        id: message.id,
        userId: message.userId ?? "unknown",
      })),
      title: fallbackRoom.name,
    };
  }

  if (room.name !== "General" && room.agents.length > 0) {
    await clearRoomAgents(room.id);
  }

  return {
    createdBy: room.ownerUserId,
    id: room.id,
    members: buildChannelParticipants({
      roomName: room.name,
      userMembers: room.members,
      agentMembers: room.agents,
    }),
    messages: room.messages.map((message) => ({
      author: message.user?.displayName ?? "Unknown",
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      id: message.id,
      userId: message.userId ?? "unknown",
    })),
    title: room.name,
  };
}

export async function createTeamChannel(
  userId: string,
  name: string,
  invitedUserIds: string[],
) {
  const context = await getTeamContext(userId);

  if (!context) {
    return null;
  }

  const allowedUserIds = new Set(context.team.users.map((user) => user.id));
  const memberIds = Array.from(new Set([userId, ...invitedUserIds])).filter((id) =>
    allowedUserIds.has(id),
  );

  const created = await prisma.room.create({
    data: {
      type: "TEAM",
      name,
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
    },
  });

  return created;
}

export async function updateTeamChannel(
  userId: string,
  roomId: string,
  name: string,
  invitedUserIds: string[],
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

  await prisma.room.update({
    where: {
      id: room.id,
    },
    data: {
      name,
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

  await clearRoomAgents(room.id);

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

export async function createTeamMessage(userId: string, roomId: string, content: string) {
  const room = await prisma.room.findFirst({
    where: {
      id: roomId,
      type: "TEAM",
      members: {
        some: {
          userId,
        },
      },
    },
  });

  if (!room) {
    return null;
  }

  return prisma.message.create({
    data: {
      roomId: room.id,
      userId,
      role: "USER",
      content,
    },
    include: {
      user: true,
    },
  });
}
