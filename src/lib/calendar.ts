import { prisma } from "@/lib/prisma";
import { listTeamParticipants, type TeamParticipant } from "@/lib/team";

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
  description: string | null;
  endAt: Date;
  id: string;
  invitations?: Array<{
    id: string;
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
    status: string;
    username: string;
  }[];
  location: string;
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

function startOfMonth(month: string) {
  const [year, monthIndex] = month.split("-").map((value) => Number(value));

  if (!year || !monthIndex || monthIndex < 1 || monthIndex > 12) {
    return new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  }

  return new Date(Date.UTC(year, monthIndex - 1, 1));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function toMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function mapEvent(event: CalendarEventRecord): CalendarEventView {
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
        status: invitation.status,
        username: invitation.invitedUser.username,
      })) ?? [],
    location: event.location ?? "",
    source: event.source,
    startAt: event.startAt.toISOString(),
    title: event.title,
  };
}

export async function listCalendarMonth(userId: string, requestedMonth?: string | null) {
  const user = await getCalendarUser(userId);

  if (!user) {
    return null;
  }

  const monthStart = startOfMonth(requestedMonth ?? "");
  const monthEnd = addMonths(monthStart, 1);
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
      },
      orderBy: {
        startAt: "asc",
      },
    }),
    prisma.calendarInvitation.findMany({
      where: {
        invitedUserId: userId,
        status: "PENDING",
        event: {
          startAt: {
            lt: monthEnd,
          },
          endAt: {
            gte: monthStart,
          },
        },
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
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  return {
    events: events.filter((event) => hasAccess(event, accessKeys)).map(mapEvent),
    invitations: invitations.map((invitation) => ({
      event: mapEvent(invitation.event),
      id: invitation.id,
      invitedBy: invitation.invitedBy?.displayName ?? "Someone",
      status: invitation.status,
    })),
    month: toMonthKey(monthStart),
    participants,
  } satisfies CalendarMonthView;
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
