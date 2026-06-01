import { listCalendarMonth, type CalendarEventView } from "@/lib/calendar";
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
            "Optional CyWorld username. For privacy, this must be omitted or match the current human participant.",
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
