import { prisma } from "@/lib/prisma";
import { listTeamParticipants, type TeamParticipant } from "@/lib/team";
import {
  monthBoundaryUtc,
  normalizeMonthKey,
  normalizeTimeZone,
} from "@/lib/timezone";

type CalendarAccessConfig = {
  participantKeys: string[];
};

type CalendarEventRecord = {
  accessConfigJson: unknown;
  allDay: boolean;
  createdBy: {
    displayName: string;
    username: string;
  } | null;
  createdByUserId: string | null;
  description: string | null;
  endAt: Date;
  id: string;
  invitations?: Array<{
    id: string;
    invitedUserId: string;
    invitedUser: {
      displayName: string;
      username: string;
    };
    status: string;
  }>;
  location: string | null;
  source: string;
  startAt: Date;
  title: string;
  titleOverrides?: Array<{
    title: string;
    userId: string;
  }>;
};

export type CalendarEventView = {
  allDay: boolean;
  createdBy: string;
  description: string;
  endAt: string;
  id: string;
  invitees: {
    displayName: string;
    id: string;
    invitedUserId: string;
    status: string;
    username: string;
  }[];
  location: string;
  originalTitle: string;
  ownerUserId: string | null;
  source: string;
  startAt: string;
  title: string;
};

export type CalendarInvitationView = {
  event: CalendarEventView;
  id: string;
  invitedBy: string;
  status: string;
};

export type CalendarMonthView = {
  events: CalendarEventView[];
  invitations: CalendarInvitationView[];
  month: string;
  participants: TeamParticipant[];
  currentUserId: string;
  timeZone: string;
};

export function calendarUserKey(userId: string) {
  return `user:${userId}`;
}

export function calendarAgentKey(agentId: string) {
  return `agent:${agentId}`;
}

function parseCalendarAccessConfig(value: unknown): CalendarAccessConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { participantKeys: [] };
  }

  const participantKeys = (value as { participantKeys?: unknown }).participantKeys;

  return {
    participantKeys: Array.isArray(participantKeys)
      ? participantKeys.filter((key): key is string => typeof key === "string")
      : [],
  };
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function getCalendarUser(userId: string) {
  return prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      agent: true,
      team: true,
    },
  });
}

function getUserAccessKeys(user: { agent?: { id: string } | null; id: string }) {
  return uniq([
    calendarUserKey(user.id),
    ...(user.agent ? [calendarAgentKey(user.agent.id)] : []),
  ]);
}

async function getUserAndAgentAccessKeys(userId: string) {
  const user = await getCalendarUser(userId);

  if (!user) {
    return [];
  }

  return getUserAccessKeys(user);
}

function hasAccess(event: { accessConfigJson: unknown }, keys: string[]) {
  const access = parseCalendarAccessConfig(event.accessConfigJson);

  return access.participantKeys.some((key) => keys.includes(key));
}

async function getAccessKeysForUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      id: {
        in: userIds,
      },
    },
    include: {
      agent: true,
    },
  });

  return users.flatMap((user) => getUserAccessKeys(user));
}

function mapEvent(event: CalendarEventRecord, viewerUserId: string): CalendarEventView {
  const titleOverride = event.titleOverrides?.find((override) => override.userId === viewerUserId);

  return {
    allDay: event.allDay,
    createdBy: event.createdBy?.displayName ?? "Unknown",
    description: event.description ?? "",
    endAt: event.endAt.toISOString(),
    id: event.id,
    invitees:
      event.invitations?.map((invitation) => ({
        displayName: invitation.invitedUser.displayName,
        id: invitation.id,
        invitedUserId: invitation.invitedUserId,
        status: invitation.status,
        username: invitation.invitedUser.username,
      })) ?? [],
    location: event.location ?? "",
    originalTitle: event.title,
    ownerUserId: event.createdByUserId,
    source: event.source,
    startAt: event.startAt.toISOString(),
    title: titleOverride?.title ?? event.title,
  };
}

export async function listCalendarMonth(userId: string, requestedMonth?: string | null) {
  const user = await getCalendarUser(userId);

  if (!user) {
    return null;
  }

  const timeZone = normalizeTimeZone(user.timezone);
  const monthKey = normalizeMonthKey(requestedMonth, timeZone);
  const { end: monthEnd, start: monthStart } = monthBoundaryUtc(monthKey, timeZone);
  const accessKeys = getUserAccessKeys(user);
  const [participants, events, invitations] = await Promise.all([
    listTeamParticipants(userId),
    prisma.calendarEvent.findMany({
      where: {
        teamId: user.teamId,
        startAt: {
          lt: monthEnd,
        },
        endAt: {
          gte: monthStart,
        },
      },
      include: {
        createdBy: true,
        invitations: {
          include: {
            invitedUser: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
        titleOverrides: {
          where: {
            userId,
          },
        },
      },
      orderBy: {
        startAt: "asc",
      },
    }),
    prisma.calendarInvitation.findMany({
      where: {
        invitedUserId: userId,
        status: "PENDING",
      },
      include: {
        invitedBy: true,
        event: {
          include: {
            createdBy: true,
            invitations: {
              include: {
                invitedUser: true,
              },
            },
            titleOverrides: {
              where: {
                userId,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  return {
    currentUserId: userId,
    events: events.filter((event) => hasAccess(event, accessKeys)).map((event) => mapEvent(event, userId)),
    invitations: invitations.map((invitation) => ({
      event: mapEvent(invitation.event, userId),
      id: invitation.id,
      invitedBy: invitation.invitedBy?.displayName ?? "Someone",
      status: invitation.status,
    })),
    month: monthKey,
    participants,
    timeZone,
  } satisfies CalendarMonthView;
}

export async function countPendingCalendarInvitations(userId: string) {
  return prisma.calendarInvitation.count({
    where: {
      invitedUserId: userId,
      status: "PENDING",
    },
  });
}

export async function createCalendarEvent(args: {
  allDay?: boolean;
  createdByUserId: string;
  description?: string;
  endAt: Date;
  invitedUserIds?: string[];
  location?: string;
  startAt: Date;
  title: string;
}) {
  const user = await getCalendarUser(args.createdByUserId);

  if (!user) {
    throw new Error("User not found.");
  }

  if (!user.teamId) {
    throw new Error("Calendar requires a team.");
  }

  if (!args.title.trim()) {
    throw new Error("Event title is required.");
  }

  if (args.endAt.getTime() <= args.startAt.getTime()) {
    throw new Error("Event end must be after the start.");
  }

  const invitedUserIds = uniq(args.invitedUserIds ?? []).filter(
    (invitedUserId) => invitedUserId !== user.id,
  );
  const validInvitees = await prisma.user.findMany({
    where: {
      id: {
        in: invitedUserIds.length > 0 ? invitedUserIds : ["__none__"],
      },
      teamId: user.teamId,
      status: "ACTIVE",
    },
    select: {
      id: true,
    },
  });
  const validInviteeIds = validInvitees.map((invitee) => invitee.id);

  return prisma.calendarEvent.create({
    data: {
      accessConfigJson: {
        participantKeys: getUserAccessKeys(user),
      },
      allDay: Boolean(args.allDay),
      createdByUserId: user.id,
      description: args.description?.trim() || null,
      endAt: args.endAt,
      invitations: {
        create: validInviteeIds.map((invitedUserId) => ({
          invitedByUserId: user.id,
          invitedUserId,
          status: "PENDING",
        })),
      },
      location: args.location?.trim() || null,
      startAt: args.startAt,
      teamId: user.teamId,
      title: args.title.trim(),
    },
  });
}

export async function updateCalendarEvent(args: {
  description?: string;
  endAt?: Date;
  eventId: string;
  invitedUserIds?: string[];
  location?: string;
  startAt?: Date;
  title?: string;
  userId: string;
}) {
  const user = await getCalendarUser(args.userId);

  if (!user) {
    throw new Error("User not found.");
  }

  const event = await prisma.calendarEvent.findUnique({
    where: {
      id: args.eventId,
    },
    include: {
      invitations: true,
    },
  });

  if (!event || !hasAccess(event, getUserAccessKeys(user))) {
    throw new Error("Event not found.");
  }

  const nextStartAt = args.startAt ?? event.startAt;
  const nextEndAt = args.endAt ?? event.endAt;

  if (nextEndAt.getTime() <= nextStartAt.getTime()) {
    throw new Error("Event end must be after the start.");
  }

  const existingInviteeIds = event.invitations
    .filter((invitation) => invitation.status !== "CANCELED")
    .map((invitation) => invitation.invitedUserId);
  const requestedInviteeIds =
    args.invitedUserIds === undefined
      ? existingInviteeIds
      : uniq([
          ...args.invitedUserIds,
          ...existingInviteeIds.filter((inviteeId) => inviteeId === user.id),
        ]);
  const validInvitees = await prisma.user.findMany({
    where: {
      id: {
        in: requestedInviteeIds.length > 0 ? requestedInviteeIds : ["__none__"],
      },
      teamId: user.teamId,
      status: "ACTIVE",
    },
    select: {
      id: true,
    },
  });
  const validInviteeIds = validInvitees.map((invitee) => invitee.id);
  const removedInviteeIds = existingInviteeIds.filter(
    (inviteeId) => !validInviteeIds.includes(inviteeId),
  );
  const timeChanged =
    nextStartAt.getTime() !== event.startAt.getTime() ||
    nextEndAt.getTime() !== event.endAt.getTime();
  const currentAccess = parseCalendarAccessConfig(event.accessConfigJson);
  const removedAccessKeys = await getAccessKeysForUserIds(
    timeChanged
      ? validInviteeIds.filter((inviteeId) => inviteeId !== user.id)
      : removedInviteeIds,
  );
  const nextAccessKeys = currentAccess.participantKeys.filter(
    (key) => !removedAccessKeys.includes(key),
  );

  await prisma.$transaction(async (transaction) => {
    if (args.title?.trim()) {
      await transaction.calendarEventTitleOverride.upsert({
        where: {
          eventId_userId: {
            eventId: event.id,
            userId: user.id,
          },
        },
        update: {
          title: args.title.trim(),
        },
        create: {
          eventId: event.id,
          title: args.title.trim(),
          userId: user.id,
        },
      });
    }

    await transaction.calendarEvent.update({
      where: {
        id: event.id,
      },
      data: {
        accessConfigJson: {
          participantKeys: uniq(nextAccessKeys),
        },
        description: args.description === undefined ? undefined : args.description.trim() || null,
        endAt: nextEndAt,
        location: args.location === undefined ? undefined : args.location.trim() || null,
        startAt: nextStartAt,
      },
    });

    for (const invitedUserId of validInviteeIds) {
      await transaction.calendarInvitation.upsert({
        where: {
          eventId_invitedUserId: {
            eventId: event.id,
            invitedUserId,
          },
        },
        update: {
          invitedByUserId: user.id,
          status: timeChanged && invitedUserId !== user.id ? "PENDING" : undefined,
        },
        create: {
          eventId: event.id,
          invitedByUserId: user.id,
          invitedUserId,
          status: "PENDING",
        },
      });
    }

    if (removedInviteeIds.length > 0) {
      await transaction.calendarInvitation.updateMany({
        where: {
          eventId: event.id,
          invitedUserId: {
            in: removedInviteeIds,
          },
        },
        data: {
          status: "CANCELED",
        },
      });
    }
  });
}

export async function respondToCalendarInvitation(args: {
  invitationId: string;
  status: "ACCEPTED" | "DECLINED";
  userId: string;
}) {
  const invitation = await prisma.calendarInvitation.findFirst({
    where: {
      id: args.invitationId,
      invitedUserId: args.userId,
      status: "PENDING",
    },
    include: {
      event: true,
    },
  });

  if (!invitation) {
    throw new Error("Invitation not found.");
  }

  if (args.status === "DECLINED") {
    return prisma.calendarInvitation.update({
      where: {
        id: invitation.id,
      },
      data: {
        status: "DECLINED",
      },
    });
  }

  const currentAccess = parseCalendarAccessConfig(invitation.event.accessConfigJson);
  const acceptedKeys = await getUserAndAgentAccessKeys(args.userId);

  return prisma.$transaction([
    prisma.calendarEvent.update({
      where: {
        id: invitation.eventId,
      },
      data: {
        accessConfigJson: {
          participantKeys: uniq([...currentAccess.participantKeys, ...acceptedKeys]),
        },
      },
    }),
    prisma.calendarInvitation.update({
      where: {
        id: invitation.id,
      },
      data: {
        status: "ACCEPTED",
      },
    }),
  ]);
}
