import {
  createCalendarEvent,
  listCalendarMonth,
  type CalendarEventView,
} from "@/lib/calendar";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { sendSharedGmail } from "@/lib/google-integration";
import { scheduleAgentDm, sendAgentDm } from "@/lib/internal-agent-actions";
import type { OpenClawFunctionCall, OpenClawFunctionTool } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";
import {
  dateKeyInTimeZone,
  formatDateTimeInTimeZone,
  normalizeTimeZone,
} from "@/lib/timezone";

export const CYWORLD_AGENT_TOOLS: OpenClawFunctionTool[] = [
  {
    name: "study_send_dm",
    description:
      "Send a direct message from this agent to a human participant inside CyWorld.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: {
          type: "string",
          description: "The exact message body to deliver.",
        },
        expectReply: {
          type: "boolean",
          description:
            "Set true when this message asks the recipient for information and the agent should wait for a reply.",
        },
        toUsername: {
          type: "string",
          description: "The recipient's CyWorld username without @.",
        },
      },
      required: ["toUsername", "message"],
    },
  },
  {
    name: "study_create_calendar_event",
    description:
      "Create a CyWorld Calendar event for the current human participant. Use this when the user asks this agent to add, create, schedule, or put an event on their CyWorld Calendar.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: {
          type: "string",
          description: "Optional notes or agenda for the event.",
        },
        endAt: {
          type: "string",
          description:
            "Event end as an ISO 8601 datetime string with the correct timezone offset for the current human participant unless another timezone was specified.",
        },
        invitedUsernames: {
          type: "array",
          description:
            "Optional CyWorld usernames to invite. Do not include the event creator.",
          items: {
            type: "string",
          },
        },
        location: {
          type: "string",
          description: "Optional location or meeting link.",
        },
        startAt: {
          type: "string",
          description:
            "Event start as an ISO 8601 datetime string with the correct timezone offset for the current human participant unless another timezone was specified.",
        },
        title: {
          type: "string",
          description: "Event title.",
        },
      },
      required: ["title", "startAt", "endAt"],
    },
  },
  {
    name: "study_list_calendar",
    description:
      "List CyWorld Calendar events and pending invitations visible to the current human participant. Use this when the user asks to check their calendar, schedule, events, availability, invitations, or what's on their calendar.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        month: {
          type: "string",
          description:
            "Optional month to inspect in YYYY-MM format. Defaults to the current month.",
        },
        username: {
          type: "string",
          description:
            "Optional CyWorld username. Omit it for the current human participant. To inspect this agent owner's calendar while speaking with someone else, set it to the owner's username; the owner's calendar sharing policy will be enforced.",
        },
      },
      required: [],
    },
  },
  {
    name: "study_schedule_dm",
    description:
      "Schedule a direct message from this agent to a human participant inside CyWorld.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        delayMinutes: {
          type: "number",
          description: "How many minutes from now to deliver the message.",
        },
        message: {
          type: "string",
          description: "The exact message body to deliver later.",
        },
        expectReply: {
          type: "boolean",
          description:
            "Set true when this scheduled message asks the recipient for information and the agent should wait for a reply.",
        },
        toUsername: {
          type: "string",
          description: "The recipient's CyWorld username without @.",
        },
      },
      required: ["toUsername", "message", "delayMinutes"],
    },
  },
  {
    name: "study_send_email",
    description:
      "Send an email through the shared CyWorld Gmail account. Use only when a user explicitly asks or approves sending an email. This Gmail address is shared by CyWorld agents; it is not this agent's personal address.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        body: {
          type: "string",
          description: "The email body to send.",
        },
        cc: {
          type: "string",
          description:
            "Optional comma-separated CC recipient email addresses.",
        },
        subject: {
          type: "string",
          description: "The email subject.",
        },
        to: {
          type: "string",
          description: "The recipient email address.",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "study_send_calendar_invite_email",
    description:
      "Send an external calendar invitation email with an .ics attachment through the shared CyWorld Gmail account. Use when the user asks to invite someone outside CyWorld, send a calendar invite to a personal email address, or make an event usable in Google Calendar, Apple Calendar, Outlook, or another outside calendar. External email invite acceptance/decline is not tracked inside CyWorld.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: {
          type: "string",
          description: "Optional agenda or context for the calendar invite.",
        },
        ccEmails: {
          type: "array",
          description: "Optional external CC recipient email addresses.",
          items: {
            type: "string",
          },
        },
        endAt: {
          type: "string",
          description:
            "Event end as an ISO 8601 datetime string with the correct timezone offset for the current human participant unless another timezone was specified.",
        },
        location: {
          type: "string",
          description: "Optional location or meeting link.",
        },
        putOnCyWorldCalendar: {
          type: "boolean",
          description:
            "Set true unless the user explicitly only wants to send an external invite email without adding the event to their CyWorld Calendar.",
        },
        startAt: {
          type: "string",
          description:
            "Event start as an ISO 8601 datetime string with the correct timezone offset for the current human participant unless another timezone was specified.",
        },
        title: {
          type: "string",
          description: "Event title.",
        },
        toEmails: {
          type: "array",
          description: "External recipient email addresses.",
          items: {
            type: "string",
          },
        },
      },
      required: ["toEmails", "title", "startAt", "endAt"],
    },
  },
];

function parseToolArguments(call: OpenClawFunctionCall) {
  try {
    return JSON.parse(call.argumentsJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanUsername(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

function cleanMessage(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias: string) {
  return escapeRegExp(alias.trim().replace(/^@/, "").toLowerCase()).replace(/\s+/g, "\\s+");
}

function matchesRecipientCommand(text: string, aliases: string[]) {
  const normalized = text.toLowerCase();

  return aliases.some((alias) => {
    const pattern = aliasPattern(alias);

    if (!pattern) {
      return false;
    }

    const boundaryStart = "(?:^|[^a-z0-9_-])";
    const boundaryEnd = "(?=$|[^a-z0-9_-])";
    const commandPatterns = [
      `${boundaryStart}(?:ask|tell|message|dm|contact)\\s+@?${pattern}${boundaryEnd}`,
      `${boundaryStart}ask\\s+(?:it|this|that|my\\s+message|the\\s+message)\\s+to\\s+@?${pattern}${boundaryEnd}`,
      `${boundaryStart}check\\s+with\\s+@?${pattern}${boundaryEnd}`,
      `${boundaryStart}send\\s+(?:it|this|that|my\\s+message|the\\s+message)\\s+to\\s+@?${pattern}${boundaryEnd}`,
      `${boundaryStart}send\\s+to\\s+@?${pattern}${boundaryEnd}`,
      `${boundaryStart}@?${pattern}(?:에게|한테)`,
    ];

    return commandPatterns.some((commandPattern) =>
      new RegExp(commandPattern, "i").test(normalized),
    );
  });
}

async function inferExplicitDmRecipientUsername(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      username: "asc",
    },
    select: {
      displayName: true,
      username: true,
    },
  });

  const matches = users.filter((user) => {
    const aliases = [
      user.username,
      user.displayName,
      user.displayName.split(/\s+/)[0] ?? "",
    ].filter((value) => value.trim().length > 0);

    return matchesRecipientCommand(trimmed, aliases);
  });

  return matches.length === 1 ? matches[0].username : null;
}

async function resolveDmTargetUsername({
  objective,
  requestedUsername,
}: {
  objective?: string;
  requestedUsername: string;
}) {
  if (!objective?.trim()) {
    return requestedUsername;
  }

  const inferredUsername = await inferExplicitDmRecipientUsername(objective);

  return inferredUsername ?? requestedUsername;
}

function cleanEmail(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const email = value.trim();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanEmailArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map(cleanEmail).filter(Boolean)));
}

function cleanEmailListString(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return Array.from(new Set(value.split(",").map(cleanEmail).filter(Boolean))).join(", ");
}

async function registerOutboundEmailThread({
  agentId,
  cc,
  gmailMessageId,
  gmailThreadId,
  requesterUserId,
  sourceRoomId,
  subject,
  taskId,
  to,
}: {
  agentId: string;
  cc?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  requesterUserId?: string;
  sourceRoomId?: string | null;
  subject: string;
  taskId?: string | null;
  to: string;
}) {
  if (!gmailThreadId || !requesterUserId) {
    return null;
  }

  return prisma.emailThread.upsert({
    where: {
      gmailThreadId,
    },
    update: {
      cc: cc || null,
      lastGmailMessageId: gmailMessageId ?? undefined,
      sourceRoomId: sourceRoomId ?? undefined,
      subject,
      taskId: taskId ?? undefined,
      to,
    },
    create: {
      agentId,
      cc: cc || null,
      gmailThreadId,
      lastGmailMessageId: gmailMessageId ?? null,
      requesterUserId,
      sourceRoomId: sourceRoomId ?? null,
      subject,
      taskId: taskId ?? null,
      to,
    },
  });
}

function cleanMonth(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const month = value.trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mentionsTodayLikeDate(value: string) {
  return /\b(today|this\s+morning|this\s+afternoon|this\s+evening|tonight)\b/i.test(
    value,
  );
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldIcsLine(line: string) {
  const chunks = line.match(/.{1,74}/g);
  return chunks ? chunks.map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`)).join("\r\n") : line;
}

function safeIcsFilename(title: string) {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${cleaned || "cyworld-invite"}.ics`;
}

function buildCalendarInviteIcs({
  description,
  endAt,
  location,
  organizerEmail,
  startAt,
  title,
  toEmails,
  uid,
}: {
  description?: string;
  endAt: Date;
  location?: string;
  organizerEmail?: string | null;
  startAt: Date;
  title: string;
  toEmails: string[];
  uid: string;
}) {
  const organizerLine = organizerEmail
    ? `ORGANIZER;CN=CyWorld:mailto:${organizerEmail}`
    : null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CyWorld//CyWorld Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startAt)}`,
    `DTEND:${formatIcsDate(endAt)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    description?.trim() ? `DESCRIPTION:${escapeIcsText(description.trim())}` : null,
    location?.trim() ? `LOCATION:${escapeIcsText(location.trim())}` : null,
    organizerLine,
    ...toEmails.map(
      (email) =>
        `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`,
    ),
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);

  return lines.map(foldIcsLine).join("\r\n");
}

function summarizeCalendarEvent(event: CalendarEventView, timeZone: string) {
  return {
    createdBy: event.createdBy,
    description: event.description,
    endAt: event.endAt,
    endLocal: formatDateTimeInTimeZone(event.endAt, timeZone, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    invitees: event.invitees.map((invitee) => ({
      status: invitee.status,
      username: invitee.username,
    })),
    location: event.location,
    startAt: event.startAt,
    startLocal: formatDateTimeInTimeZone(event.startAt, timeZone, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    title: event.title,
  };
}

async function handleCalendarListTool({
  args,
  requesterUserId,
  senderAgentOpenclawId,
}: {
  args: Record<string, unknown>;
  requesterUserId?: string;
  senderAgentOpenclawId: string;
}) {
  if (!requesterUserId) {
    return JSON.stringify({
      ok: false,
      reason: "missing_requester_user",
    });
  }

  const requester = await prisma.user.findUnique({
    where: {
      id: requesterUserId,
    },
    select: {
      displayName: true,
      id: true,
      timezone: true,
      username: true,
    },
  });

  if (!requester) {
    return JSON.stringify({
      ok: false,
      reason: "requester_not_found",
    });
  }

  const requestedUsername = cleanUsername(args.username);

  if (requestedUsername && requestedUsername !== requester.username) {
    const senderAgent = await prisma.agent.findUnique({
      where: {
        openclawAgentId: senderAgentOpenclawId,
      },
      include: {
        user: true,
      },
    });

    if (!senderAgent || senderAgent.user.username !== requestedUsername) {
      return JSON.stringify({
        ok: false,
        reason: "calendar_access_is_limited_to_current_human",
        currentHuman: {
          displayName: requester.displayName,
          username: requester.username,
        },
        requestedUsername,
      });
    }

    const policy = normalizeAgentBehaviorConfig(
      senderAgent.soulConfigJson,
    ).calendarSharingPolicy;

    if (policy !== "always") {
      return JSON.stringify({
        ok: false,
        reason:
          policy === "never"
            ? "owner_calendar_sharing_disabled"
            : "owner_calendar_permission_required",
        owner: {
          displayName: senderAgent.user.displayName,
          username: senderAgent.user.username,
        },
        requestedUsername,
      });
    }

    const ownerView = await listCalendarMonth(senderAgent.user.id, cleanMonth(args.month));

    if (!ownerView) {
      return JSON.stringify({
        ok: false,
        reason: "calendar_not_found",
      });
    }

    return JSON.stringify({
      ok: true,
      calendar: "CyWorld Calendar",
      viewer: {
        displayName: requester.displayName,
        timezone: normalizeTimeZone(requester.timezone),
        username: requester.username,
      },
      sharedFrom: {
        displayName: senderAgent.user.displayName,
        username: senderAgent.user.username,
      },
      sharingPolicy: policy,
      month: ownerView.month,
      timeZone: ownerView.timeZone,
      events: ownerView.events.slice(0, 40).map((event) => summarizeCalendarEvent(event, ownerView.timeZone)),
      pendingInvitations: ownerView.invitations.slice(0, 20).map((invitation) => ({
        event: summarizeCalendarEvent(invitation.event, ownerView.timeZone),
        invitedBy: invitation.invitedBy,
        status: invitation.status,
      })),
      totalEvents: ownerView.events.length,
      totalPendingInvitations: ownerView.invitations.length,
    });
  }

  const view = await listCalendarMonth(requester.id, cleanMonth(args.month));

  if (!view) {
    return JSON.stringify({
      ok: false,
      reason: "calendar_not_found",
    });
  }

  return JSON.stringify({
    ok: true,
    calendar: "CyWorld Calendar",
    viewer: {
      displayName: requester.displayName,
      timezone: view.timeZone,
      username: requester.username,
    },
    month: view.month,
    timeZone: view.timeZone,
    events: view.events.slice(0, 40).map((event) => summarizeCalendarEvent(event, view.timeZone)),
    pendingInvitations: view.invitations.slice(0, 20).map((invitation) => ({
      event: summarizeCalendarEvent(invitation.event, view.timeZone),
      invitedBy: invitation.invitedBy,
      status: invitation.status,
    })),
    totalEvents: view.events.length,
    totalPendingInvitations: view.invitations.length,
  });
}

async function handleCalendarCreateTool({
  args,
  objective,
  requesterUserId,
}: {
  args: Record<string, unknown>;
  objective?: string;
  requesterUserId?: string;
}) {
  if (!requesterUserId) {
    return JSON.stringify({
      ok: false,
      reason: "missing_requester_user",
    });
  }

  const title = typeof args.title === "string" ? args.title.trim() : "";
  const startAt = parseDate(args.startAt);
  const endAt = parseDate(args.endAt);
  const requester = await prisma.user.findUnique({
    where: {
      id: requesterUserId,
    },
    select: {
      timezone: true,
    },
  });
  const requesterTimezone = normalizeTimeZone(requester?.timezone);

  if (!title || !startAt || !endAt) {
    return JSON.stringify({
      ok: false,
      reason: "missing_or_invalid_title_startAt_or_endAt",
    });
  }

  if (endAt.getTime() <= startAt.getTime()) {
    return JSON.stringify({
      ok: false,
      reason: "endAt_must_be_after_startAt",
    });
  }

  if (
    objective &&
    mentionsTodayLikeDate(objective) &&
    dateKeyInTimeZone(startAt, requesterTimezone) !==
      dateKeyInTimeZone(new Date(), requesterTimezone)
  ) {
    return JSON.stringify({
      ok: false,
      reason: "relative_date_does_not_match_today_in_requester_timezone",
      currentDate: dateKeyInTimeZone(new Date(), requesterTimezone),
      requestedStartDate: dateKeyInTimeZone(startAt, requesterTimezone),
      requesterTimezone,
      guidance:
        "The user used today-like language. Recalculate the event date from the current human participant's timezone or ask a clarification before creating it.",
    });
  }

  const invitedUsernames = cleanStringArray(args.invitedUsernames).map((username) =>
    username.replace(/^@/, "").toLowerCase(),
  );
  const invitees = await prisma.user.findMany({
    where: {
      username: {
        in: invitedUsernames.length > 0 ? invitedUsernames : ["__none__"],
      },
      status: "ACTIVE",
    },
    select: {
      id: true,
      username: true,
    },
  });
  let createError: string | null = null;
  const created = await createCalendarEvent({
    createdByUserId: requesterUserId,
    description: typeof args.description === "string" ? args.description : undefined,
    endAt,
    invitedUserIds: invitees.map((invitee) => invitee.id),
    location: typeof args.location === "string" ? args.location : undefined,
    startAt,
    title,
  }).catch((error: unknown) => {
    createError = error instanceof Error ? error.message : "Unknown error";
    return null;
  });

  if (!created) {
    return JSON.stringify({
      ok: false,
      reason: "calendar_event_create_failed",
      error: createError,
    });
  }

  return JSON.stringify({
    ok: true,
    calendar: "CyWorld Calendar",
    event: {
      endAt: created.endAt.toISOString(),
      endLocal: formatDateTimeInTimeZone(created.endAt, requesterTimezone, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      id: created.id,
      invitedUsernames: invitees.map((invitee) => invitee.username),
      startAt: created.startAt.toISOString(),
      startLocal: formatDateTimeInTimeZone(created.startAt, requesterTimezone, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      title: created.title,
    },
    timeZone: requesterTimezone,
  });
}

async function handleExternalCalendarInviteTool({
  args,
  objective,
  requesterUserId,
  senderAgentOpenclawId,
  sourceRoomId,
  taskId,
}: {
  args: Record<string, unknown>;
  objective?: string;
  requesterUserId?: string;
  senderAgentOpenclawId: string;
  sourceRoomId?: string;
  taskId?: string | null;
}) {
  if (!requesterUserId) {
    return JSON.stringify({
      ok: false,
      reason: "missing_requester_user",
    });
  }

  const title = typeof args.title === "string" ? args.title.trim() : "";
  const toEmails = cleanEmailArray(args.toEmails);
  const ccEmails = cleanEmailArray(args.ccEmails);
  const startAt = parseDate(args.startAt);
  const endAt = parseDate(args.endAt);
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const location = typeof args.location === "string" ? args.location.trim() : "";
  const requester = await prisma.user.findUnique({
    where: {
      id: requesterUserId,
    },
    select: {
      displayName: true,
      timezone: true,
      username: true,
    },
  });
  const requesterTimezone = normalizeTimeZone(requester?.timezone);

  if (!requester) {
    return JSON.stringify({
      ok: false,
      reason: "requester_not_found",
    });
  }

  if (!title || toEmails.length === 0 || !startAt || !endAt) {
    return JSON.stringify({
      ok: false,
      reason: "missing_or_invalid_toEmails_title_startAt_or_endAt",
    });
  }

  if (endAt.getTime() <= startAt.getTime()) {
    return JSON.stringify({
      ok: false,
      reason: "endAt_must_be_after_startAt",
    });
  }

  if (
    objective &&
    mentionsTodayLikeDate(objective) &&
    dateKeyInTimeZone(startAt, requesterTimezone) !==
      dateKeyInTimeZone(new Date(), requesterTimezone)
  ) {
    return JSON.stringify({
      ok: false,
      reason: "relative_date_does_not_match_today_in_requester_timezone",
      currentDate: dateKeyInTimeZone(new Date(), requesterTimezone),
      requestedStartDate: dateKeyInTimeZone(startAt, requesterTimezone),
      requesterTimezone,
      guidance:
        "The user used today-like language. Recalculate the event date from the current human participant's timezone or ask a clarification before sending the external invite.",
    });
  }

  let createdEvent: Awaited<ReturnType<typeof createCalendarEvent>> | null = null;
  let createError: string | null = null;

  if (args.putOnCyWorldCalendar !== false) {
    createdEvent = await createCalendarEvent({
      createdByUserId: requesterUserId,
      description: description || undefined,
      endAt,
      invitedUserIds: [],
      location: location || undefined,
      startAt,
      title,
    }).catch((error: unknown) => {
      createError = error instanceof Error ? error.message : "Unknown error";
      return null;
    });

    if (!createdEvent) {
      return JSON.stringify({
        ok: false,
        reason: "calendar_event_create_failed",
        error: createError,
      });
    }
  }

  const startLocal = formatDateTimeInTimeZone(startAt, requesterTimezone, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const endLocal = formatDateTimeInTimeZone(endAt, requesterTimezone, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const uid = `cyworld-${createdEvent?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}@cyworld.hjjy.app`;
  const body = [
    `You've been invited to: ${title}`,
    "",
    `Time: ${startLocal} - ${endLocal} (${requesterTimezone})`,
    location ? `Location: ${location}` : null,
    description ? "" : null,
    description || null,
    "",
    `Sent by ${requester.displayName} (@${requester.username}) through CyWorld.`,
    "",
    "Note: this external calendar invite can be added to your calendar app, but CyWorld does not track whether external email recipients accept or decline it.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const ics = buildCalendarInviteIcs({
    description,
    endAt,
    location,
    organizerEmail: null,
    startAt,
    title,
    toEmails,
    uid,
  });
  const result = await sendSharedGmail({
    attachments: [
      {
        content: ics,
        contentType: "text/calendar; charset=utf-8; method=REQUEST",
        filename: safeIcsFilename(title),
      },
    ],
    body,
    cc: ccEmails.join(", ") || null,
    subject: `Calendar invite: ${title}`,
    to: toEmails.join(", "),
  });

  if (!result.ok) {
    return JSON.stringify(result);
  }

  await registerOutboundEmailThread({
    agentId: senderAgentOpenclawId,
    cc: ccEmails.join(", ") || null,
    gmailMessageId: result.messageId,
    gmailThreadId: result.threadId,
    requesterUserId,
    sourceRoomId,
    subject: `Calendar invite: ${title}`,
    taskId,
    to: toEmails.join(", "),
  });

  return JSON.stringify({
    ...result,
    calendar: "CyWorld Calendar",
    cyWorldEvent: createdEvent
      ? {
          endAt: createdEvent.endAt.toISOString(),
          endLocal,
          id: createdEvent.id,
          startAt: createdEvent.startAt.toISOString(),
          startLocal,
          title: createdEvent.title,
        }
      : null,
    externalCalendarInvite: true,
    externalInviteTracking: "not_tracked_in_cyworld",
    explanation:
      "External email recipients receive an .ics invite they can add to Google Calendar, Apple Calendar, Outlook, or another calendar app. CyWorld does not receive or display their accept/decline RSVP status.",
    ccRecipients: ccEmails,
    recipients: toEmails,
    senderPolicy:
      "Invite email is sent through the shared CyWorld Gmail account, not a personal agent address.",
    timeZone: requesterTimezone,
  });
}

async function createToolTask({
  expectReply,
  kind,
  message,
  objective,
  requesterUserId,
  senderAgentOpenclawId,
  sourceRoomId,
  targetUsername,
}: {
  expectReply: boolean;
  kind: "send_dm" | "schedule_dm";
  message: string;
  objective: string;
  requesterUserId: string;
  senderAgentOpenclawId: string;
  sourceRoomId: string;
  targetUsername: string;
}) {
  const targetUser = await prisma.user.findUnique({
    where: {
      username: targetUsername,
    },
    select: {
      id: true,
      username: true,
    },
  });

  if (!targetUser) {
    return null;
  }

  return prisma.agentTask.create({
    data: {
      agentId: senderAgentOpenclawId,
      kind,
      objective,
      requesterUserId,
      sourceRoomId,
      status: "OPEN",
      targetUserId: targetUser.id,
      title: `${kind === "schedule_dm" ? "Schedule" : "Send"} DM to @${targetUser.username}`,
      events: {
        create: [
          {
            type: "AGENT_DECISION",
            summary: `Agent chose to ${kind === "schedule_dm" ? "schedule" : "send"} a CyWorld DM to @${targetUser.username}.`,
            payload: {
              expectReply,
              message,
            },
          },
          {
            type: "OUTBOUND_MESSAGE",
            summary: message,
            payload: {
              targetUsername: targetUser.username,
            },
          },
        ],
      },
    },
  });
}

export async function handleCyWorldAgentToolCall({
  call,
  objective,
  requesterUserId,
  senderAgentOpenclawId,
  sourceRoomId,
  taskId,
}: {
  call: OpenClawFunctionCall;
  objective?: string;
  requesterUserId?: string;
  senderAgentOpenclawId: string;
  sourceRoomId?: string;
  taskId?: string | null;
}) {
  const args = parseToolArguments(call);

  if (!args) {
    return JSON.stringify({
      ok: false,
      reason: "invalid_json_arguments",
    });
  }

  if (call.name === "study_list_calendar") {
    return handleCalendarListTool({
      args,
      requesterUserId,
      senderAgentOpenclawId,
    });
  }

  if (call.name === "study_create_calendar_event") {
    return handleCalendarCreateTool({
      args,
      objective,
      requesterUserId,
    });
  }

  if (call.name === "study_send_calendar_invite_email") {
    return handleExternalCalendarInviteTool({
      args,
      objective,
      requesterUserId,
      senderAgentOpenclawId,
      sourceRoomId,
      taskId,
    });
  }

  if (call.name === "study_send_email") {
    const to = cleanEmail(args.to);
    const cc = cleanEmailListString(args.cc);
    const subject = cleanMessage(args.subject);
    const body = cleanMessage(args.body);

    if (!to || !subject || !body) {
      return JSON.stringify({
        ok: false,
        reason: "missing_or_invalid_to_subject_or_body",
      });
    }

    const result = await sendSharedGmail({
      body,
      cc: cc || null,
      subject,
      to,
    });

    if (result.ok) {
      await registerOutboundEmailThread({
        agentId: senderAgentOpenclawId,
        cc: cc || null,
        gmailMessageId: result.messageId,
        gmailThreadId: result.threadId,
        requesterUserId,
        sourceRoomId,
        subject,
        taskId,
        to,
      });
    }

    return JSON.stringify({
      ...result,
      ccRecipients: cc ? cc.split(", ") : [],
      senderPolicy:
        "Email is sent through the shared CyWorld Gmail account, not a personal agent address.",
    });
  }

  const requestedToUsername = cleanUsername(args.toUsername);
  const toUsername = await resolveDmTargetUsername({
    objective,
    requestedUsername: requestedToUsername,
  });
  const message = cleanMessage(args.message);
  const expectReply = args.expectReply === true;

  if (!requestedToUsername || !toUsername || !message) {
    return JSON.stringify({
      ok: false,
      reason: "missing_toUsername_or_message",
    });
  }

  const createdTask =
    !taskId && requesterUserId && sourceRoomId
      ? await createToolTask({
          expectReply,
          kind: call.name === "study_schedule_dm" ? "schedule_dm" : "send_dm",
          message,
          objective: objective?.trim() || message,
          requesterUserId,
          senderAgentOpenclawId,
          sourceRoomId,
          targetUsername: toUsername,
        })
      : null;
  const effectiveTaskId = taskId ?? createdTask?.id ?? null;

  if (call.name === "study_send_dm") {
    const result = await sendAgentDm({
      message,
      senderAgentOpenclawId,
      taskId: effectiveTaskId,
      toUsername,
    });

    if (createdTask) {
      await prisma.agentTask.update({
        where: {
          id: createdTask.id,
        },
        data: {
          resultSummary: message,
          status: result.ok ? (expectReply ? "WAITING" : "COMPLETED") : "FAILED",
        },
      });
    }

    return JSON.stringify(result);
  }

  if (call.name === "study_schedule_dm") {
    const delayMinutes =
      typeof args.delayMinutes === "number" && Number.isFinite(args.delayMinutes)
        ? Math.max(1, Math.round(args.delayMinutes))
        : null;

    if (!delayMinutes) {
      return JSON.stringify({
        ok: false,
        reason: "invalid_delayMinutes",
      });
    }

    const result = await scheduleAgentDm({
      deliverAt: new Date(Date.now() + delayMinutes * 60 * 1000),
      message,
      senderAgentOpenclawId,
      taskId: effectiveTaskId,
      toUsername,
    });

    if (createdTask) {
      await prisma.agentTask.update({
        where: {
          id: createdTask.id,
        },
        data: {
          resultSummary: message,
          status: result.ok ? "WAITING" : "FAILED",
        },
      });
    }

    return JSON.stringify(result);
  }

  return JSON.stringify({
    ok: false,
    reason: "unknown_tool",
    tool: call.name,
  });
}
