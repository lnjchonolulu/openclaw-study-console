import {
  createCalendarEvent,
  listCalendarMonth,
  type CalendarEventView,
} from "@/lib/calendar";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { scheduleAgentDm, sendAgentDm } from "@/lib/internal-agent-actions";
import type { OpenClawFunctionCall, OpenClawFunctionTool } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

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
          description: "Event end as an ISO 8601 datetime string.",
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
          description: "Event start as an ISO 8601 datetime string.",
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

function summarizeCalendarEvent(event: CalendarEventView) {
  return {
    createdBy: event.createdBy,
    description: event.description,
    endAt: event.endAt,
    invitees: event.invitees.map((invitee) => ({
      status: invitee.status,
      username: invitee.username,
    })),
    location: event.location,
    startAt: event.startAt,
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
        username: requester.username,
      },
      sharedFrom: {
        displayName: senderAgent.user.displayName,
        username: senderAgent.user.username,
      },
      sharingPolicy: policy,
      month: ownerView.month,
      events: ownerView.events.slice(0, 40).map((event) => summarizeCalendarEvent(event)),
      pendingInvitations: ownerView.invitations.slice(0, 20).map((invitation) => ({
        event: summarizeCalendarEvent(invitation.event),
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
      username: requester.username,
    },
    month: view.month,
    events: view.events.slice(0, 40).map((event) => summarizeCalendarEvent(event)),
    pendingInvitations: view.invitations.slice(0, 20).map((invitation) => ({
      event: summarizeCalendarEvent(invitation.event),
      invitedBy: invitation.invitedBy,
      status: invitation.status,
    })),
    totalEvents: view.events.length,
    totalPendingInvitations: view.invitations.length,
  });
}

async function handleCalendarCreateTool({
  args,
  requesterUserId,
}: {
  args: Record<string, unknown>;
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
      id: created.id,
      invitedUsernames: invitees.map((invitee) => invitee.username),
      startAt: created.startAt.toISOString(),
      title: created.title,
    },
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
      requesterUserId,
    });
  }

  const toUsername = cleanUsername(args.toUsername);
  const message = cleanMessage(args.message);
  const expectReply = args.expectReply === true;

  if (!toUsername || !message) {
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
