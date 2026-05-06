import { prisma } from "@/lib/prisma";

export type TeamParticipant = {
  id: string;
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
    name: user.displayName,
    status: "Personal agent active",
    username: user.username,
  };
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

    return existing;
  }

  return prisma.room.create({
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

    return {
      createdBy: fallbackRoom.ownerUserId,
      id: fallbackRoom.id,
      members: fallbackRoom.members.map((member) => mapParticipant(member.user)),
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

  return {
    createdBy: room.ownerUserId,
    id: room.id,
    members: room.members.map((member) => mapParticipant(member.user)),
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

  return prisma.room.create({
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
