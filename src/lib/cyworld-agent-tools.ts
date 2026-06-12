import {
  AgentTaskEventType,
  type Prisma,
} from "@prisma/client";
import {
  createCalendarEvent,
  listCalendarMonth,
  type CalendarEventView,
} from "@/lib/calendar";
import { runAgentHandoff } from "@/lib/agent-handoff";
import { recordAgentActionReceipt } from "@/lib/action-receipts";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { updateOwnerRelationshipGuidance } from "@/lib/agent-relationships";
import {
  recallConversationHistory,
  updateOwnerSharingPolicies,
} from "@/lib/conversation-memory";
import type { CyWorldExecutionContext } from "@/lib/cyworld-execution-context";
import {
  createGoogleWorkspaceFile,
  inspectGoogleFileReview,
  inspectSharedGoogleDocs,
  inspectSharedGoogleSheets,
  inspectSharedGoogleSlides,
  requestGoogleFileReview,
  sendSharedGmail,
  updateGoogleFileReview,
  updateSharedGoogleDocs,
  updateSharedGoogleSheets,
  updateSharedGoogleSlides,
} from "@/lib/google-integration";
import { scheduleAgentDm, sendAgentDm } from "@/lib/internal-agent-actions";
import type { OpenClawFunctionCall, OpenClawFunctionTool } from "@/lib/openclaw";
import { listPendingAgentTasks } from "@/lib/pending-agent-tasks";
import { prisma } from "@/lib/prisma";
import {
  dateKeyInTimeZone,
  formatDateTimeInTimeZone,
  normalizeTimeZone,
} from "@/lib/timezone";

export const CYWORLD_AGENT_TOOLS: OpenClawFunctionTool[] = [
  {
    name: "study_recall_conversation",
    description:
      "Recall CyWorld conversation history that this agent is allowed to use. Omit withUsername and teamChannelName for the current DM or Team Chat. Set withUsername to recall this agent's DM with a specific human, or teamChannelName to recall a Team Chat. Use this only when older conversation context is actually needed. CyWorld enforces room membership and the owner's conversation-memory sharing policy.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "number",
          description: "Maximum matching messages to return, from 1 to 30.",
        },
        query: {
          type: "string",
          description:
            "Optional text to search for. Omit it to retrieve the most recent messages in the selected conversation.",
        },
        teamChannelName: {
          type: "string",
          description:
            "Optional CyWorld Team Chat channel name. Do not combine with withUsername.",
        },
        withUsername: {
          type: "string",
          description:
            "Optional CyWorld username whose DM with this agent should be recalled, without @. Do not combine with teamChannelName.",
        },
      },
      required: [],
    },
  },
  {
    name: "study_update_owner_sharing_policies",
    description:
      "Save the owner's choices for calendar sharing and remembered-conversation sharing. Use only while speaking directly with this agent's owner, especially during bootstrap after the owner has clearly chosen Never, Ask every time, or Always allowed. Omit a field that the owner has not decided.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        calendarSharingPolicy: {
          type: "string",
          enum: ["never", "ask_each_time", "always"],
        },
        conversationMemorySharingPolicy: {
          type: "string",
          enum: ["never", "ask_each_time", "always"],
        },
      },
      required: [],
    },
  },
  {
    name: "study_set_relationship_guidance",
    description:
      "Save whether the owner wants one general Shared Spaces approach or person-specific social guidance. Use only while speaking directly with this agent's owner. Person-specific entries are free-text owner preferences for how this agent should relate to known CyWorld users; they are not permissions and must not be invented.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["general", "person_specific"],
        },
        relationships: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              interactionGuidance: {
                type: "string",
                description:
                  "Optional natural-language guidance for tone, distance, candor, or social stance with this person.",
              },
              relationshipLabel: {
                type: "string",
                description:
                  "Optional owner-authored description such as senior colleague or close friend.",
              },
              username: {
                type: "string",
                description:
                  "Existing active CyWorld username, without @.",
              },
            },
            required: ["username"],
          },
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "study_list_pending_tasks",
    description:
      "Inspect this agent's unfinished CyWorld tasks and their latest durable events. Use it during heartbeat or when recovering work after a delay, restart, email reply, handoff, scheduled message, or interrupted action. The result distinguishes new input, stalled execution, and ordinary waiting. Do not repeat an action merely because its task remains pending.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "number",
          description:
            "Optional maximum number of pending tasks to return, from 1 to 50.",
        },
      },
      required: [],
    },
  },
  {
    name: "study_request_agent_action",
    description:
      "Ask another CyWorld personal agent to contribute owner-specific context, perspective, or work to the current task. This creates a traceable Agent Handoff and returns that agent's response in this turn. If a necessary follow-up remains, call it again with the returned handoffTaskId as continueTaskId so the same agents can continue the exchange. Stop when the result is sufficient; do not continue for agreement, repetition, or social filler. Use it only when another agent is genuinely relevant; do not use it to contact a human participant or for work this agent can complete itself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        continueTaskId: {
          type: "string",
          description:
            "Optional handoffTaskId from an earlier handoff when this is a follow-up in the same piece of work.",
        },
        request: {
          type: "string",
          description:
            "A self-contained, natural-language request for the target agent. Include the context needed to act without impersonating any human.",
        },
        targetOwnerUsername: {
          type: "string",
          description:
            "The CyWorld username of the person whose personal agent should receive this handoff, without @.",
        },
      },
      required: ["targetOwnerUsername", "request"],
    },
  },
  {
    name: "study_send_dm",
    description:
      "Send a CyWorld DM from this agent to another human participant. Use it when the conversation clearly asks this agent to contact, ask, tell, update, remind, or message a different CyWorld person, even if the user does not say 'DM'. Do not use it for ordinary replies to the current conversational partner or phrases such as 'tell me'.",
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
      "Create an event in the current human participant's CyWorld Calendar. Use it for clear requests to add, create, schedule, block, remember, or put an appointment/event on their calendar, regardless of whether they say 'CyWorld Calendar'. Do not create an event when they are only discussing possible times.",
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
      "Inspect CyWorld Calendar events and pending invitations visible to the current human participant. Use it when the user asks about a schedule, availability, appointments, events, invitations, free time, or what someone is doing, even if they never say 'calendar'. CyWorld permissions and the owner's sharing policy still apply.",
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
      "Schedule a future CyWorld DM from this agent to a human participant. Use it when the user clearly wants another CyWorld person, or themselves, to receive a message later. This is message delivery, not a calendar event.",
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
      "Send email through Shared Gmail, the one Gmail account shared by CyWorld agents. Use only when a user explicitly asks or approves sending mail, including ordinary wording such as 'email them', 'send this to that address', or 'CC'. It is not this agent's personal address.",
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
      "Send an external calendar invitation email with an .ics attachment through Shared Gmail. Use when the user wants an outside email address to receive an invite or wants the event usable in Google Calendar, Apple Calendar, Outlook, or another outside calendar, even if they simply say 'invite this email'. External acceptance or decline is not tracked inside CyWorld.",
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
  {
    name: "study_create_google_workspace_file",
    description:
      "Create a new blank Google Slides, Docs, or Sheets file owned by the shared CyWorld Google account. Use this when the user asks for a new Google presentation, document, or spreadsheet. After creation, use the matching Google update tool to add content. Files created this way are covered by CyWorld's drive.file permission.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        fileType: {
          type: "string",
          enum: ["slides", "docs", "sheets"],
          description: "The Google Workspace file type to create.",
        },
        title: {
          type: "string",
          description: "The new file title.",
        },
      },
      required: ["fileType", "title"],
    },
  },
  {
    name: "study_inspect_google_slides",
    description:
      "Inspect a Google Slides presentation before editing it. Accepts a Google Slides URL or presentation ID and returns the title, revision ID, slide object IDs, page-element object IDs, element types, and visible text. All CyWorld agents use the one Google account connected by the administrator. If access fails, explain that the file must be shared with the account email returned by this tool and granted Editor access.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        presentation: {
          type: "string",
          description: "A Google Slides URL or presentation ID.",
        },
      },
      required: ["presentation"],
    },
  },
  {
    name: "study_update_google_slides",
    description:
      "Modify a Google Slides presentation through the shared CyWorld Google account. Inspect the presentation first, then pass a JSON array of native Google Slides presentations.batchUpdate request objects. Prefer requiredRevisionId from the inspection result so concurrent changes are not overwritten. Examples: [{\"replaceAllText\":{\"containsText\":{\"text\":\"Old\",\"matchCase\":true},\"replaceText\":\"New\"}}], [{\"insertText\":{\"objectId\":\"shapeId\",\"text\":\"Added text\",\"insertionIndex\":0}}], or [{\"createSlide\":{\"insertionIndex\":2,\"slideLayoutReference\":{\"predefinedLayout\":\"TITLE_AND_BODY\"}}}]. Do not claim the edit succeeded unless this tool returns ok:true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        presentation: {
          type: "string",
          description: "A Google Slides URL or presentation ID.",
        },
        requestsJson: {
          type: "string",
          description:
            "A JSON array containing 1 to 50 native Google Slides batchUpdate request objects.",
        },
        requiredRevisionId: {
          type: "string",
          description:
            "Optional revision ID returned by study_inspect_google_slides. Include it when editing an existing presentation.",
        },
      },
      required: ["presentation", "requestsJson"],
    },
  },
  {
    name: "study_inspect_google_docs",
    description:
      "Inspect a Google Docs document before editing it. Accepts a Google Docs URL or document ID and returns the title, revision ID, tabs, structural element indices, visible text, and native suggestion IDs/locations. Native suggestions can be inspected, but Google's public API cannot create, accept, or reject suggestion-mode edits. All CyWorld agents use the one Google account connected by the administrator.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        document: {
          type: "string",
          description: "A Google Docs URL or document ID.",
        },
      },
      required: ["document"],
    },
  },
  {
    name: "study_update_google_docs",
    description:
      "Modify a Google Docs document through the shared CyWorld Google account. Inspect the document first, then pass a JSON array of native Google Docs documents.batchUpdate request objects. Prefer requiredRevisionId from the inspection result so concurrent changes are not overwritten. Examples: [{\"insertText\":{\"location\":{\"index\":1},\"text\":\"New opening paragraph\\n\"}}] or [{\"replaceAllText\":{\"containsText\":{\"text\":\"Old\",\"matchCase\":true},\"replaceText\":\"New\"}}]. Do not claim the edit succeeded unless this tool returns ok:true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        document: {
          type: "string",
          description: "A Google Docs URL or document ID.",
        },
        requestsJson: {
          type: "string",
          description:
            "A JSON array containing 1 to 50 native Google Docs batchUpdate request objects.",
        },
        requiredRevisionId: {
          type: "string",
          description:
            "Optional revision ID returned by study_inspect_google_docs. Include it when editing an existing document.",
        },
      },
      required: ["document", "requestsJson"],
    },
  },
  {
    name: "study_inspect_google_sheets",
    description:
      "Inspect a Google Sheets spreadsheet before editing it. Accepts a Google Sheets URL or spreadsheet ID and returns spreadsheet metadata and sheet IDs. Optionally pass rangesJson as a JSON array of up to 20 A1 ranges, such as [\"Sheet1!A1:D20\"], to retrieve only the values needed for the task instead of loading the entire spreadsheet. All CyWorld agents use the one Google account connected by the administrator. If access fails, explain that the file must be shared with the account email returned by this tool and granted Editor access.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        spreadsheet: {
          type: "string",
          description: "A Google Sheets URL or spreadsheet ID.",
        },
        rangesJson: {
          type: "string",
          description:
            "Optional JSON array of up to 20 A1 notation ranges to inspect, for example [\"Sheet1!A1:D20\"].",
        },
      },
      required: ["spreadsheet"],
    },
  },
  {
    name: "study_update_google_sheets",
    description:
      "Modify a Google Sheets spreadsheet through the shared CyWorld Google account. Inspect the spreadsheet and the relevant ranges first, then pass a JSON array of native Google Sheets spreadsheets.batchUpdate request objects. Example: [{\"updateCells\":{\"range\":{\"sheetId\":0,\"startRowIndex\":0,\"endRowIndex\":1,\"startColumnIndex\":0,\"endColumnIndex\":2},\"rows\":[{\"values\":[{\"userEnteredValue\":{\"stringValue\":\"Name\"}},{\"userEnteredValue\":{\"stringValue\":\"Status\"}}]}],\"fields\":\"userEnteredValue\"}}]. Do not claim the edit succeeded unless this tool returns ok:true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        spreadsheet: {
          type: "string",
          description: "A Google Sheets URL or spreadsheet ID.",
        },
        requestsJson: {
          type: "string",
          description:
            "A JSON array containing 1 to 50 native Google Sheets batchUpdate request objects.",
        },
      },
      required: ["spreadsheet", "requestsJson"],
    },
  },
  {
    name: "study_inspect_google_file_review",
    description:
      "Inspect Drive comments and replies on a Google Slides, Docs, or Sheets file. This uses drive.file access, so the file must have been created by CyWorld or explicitly authorized for the connected shared Google account. Use study_inspect_google_docs separately when native Docs suggestion details are also needed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        file: {
          type: "string",
          description: "A Google Slides, Docs, Sheets, or Drive file URL or ID.",
        },
        includeResolved: {
          type: "boolean",
          description:
            "Whether resolved comment threads should be included. Defaults to true.",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "study_update_google_file_review",
    description:
      "Add a Drive comment, reply to a comment, or resolve a comment thread on a Google Slides, Docs, or Sheets file. Inspect review comments first when replying or resolving. This does not create or accept native Google Docs suggestion-mode edits.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["add_comment", "reply", "resolve"],
        },
        commentId: {
          type: "string",
          description: "Required for reply and resolve actions.",
        },
        content: {
          type: "string",
          description:
            "Required when adding a comment or reply. Optional when resolving.",
        },
        file: {
          type: "string",
          description: "A Google Slides, Docs, Sheets, or Drive file URL or ID.",
        },
      },
      required: ["file", "action"],
    },
  },
  {
    name: "study_request_google_file_review",
    description:
      "Mark a Google Slides, Docs, or Sheets file for review by adding a CyWorld review-request comment to the file. This does not send email, use Google's native request-review UI, notify a specific person, or grant file access.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        file: {
          type: "string",
          description: "A Google Slides, Docs, Sheets, or Drive file URL or ID.",
        },
        message: {
          type: "string",
          description: "What the reviewers should review or respond to.",
        },
      },
      required: ["file", "message"],
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

function parseToolResult(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toolReceiptEventType(toolName: string, ok: boolean) {
  if (!ok) {
    return AgentTaskEventType.SYSTEM_NOTE;
  }

  if (toolName === "study_send_dm") {
    return AgentTaskEventType.OUTBOUND_MESSAGE;
  }

  if (toolName === "study_schedule_dm") {
    return AgentTaskEventType.SCHEDULED_MESSAGE;
  }

  return AgentTaskEventType.SYSTEM_NOTE;
}

function shouldRecordToolReceipt(toolName: string) {
  return ![
    "study_list_pending_tasks",
    "study_recall_conversation",
  ].includes(toolName);
}

function toolReceiptSummary(toolName: string, result: Record<string, unknown> | null) {
  const ok = result?.ok === true;
  const reason = typeof result?.reason === "string" ? result.reason : null;

  if (!result) {
    return `CyWorld tool ${toolName} returned a non-JSON result.`;
  }

  if (ok) {
    if (typeof result.toUsername === "string") {
      return `CyWorld tool ${toolName} succeeded for @${result.toUsername}.`;
    }

    if (result.event && typeof result.event === "object" && !Array.isArray(result.event)) {
      const title = (result.event as { title?: unknown }).title;
      return `CyWorld tool ${toolName} succeeded${typeof title === "string" ? ` for "${title}"` : ""}.`;
    }

    return `CyWorld tool ${toolName} succeeded.`;
  }

  return `CyWorld tool ${toolName} failed${reason ? `: ${reason}` : ""}.`;
}

async function userIdForUsername(username: unknown) {
  const cleaned = cleanUsername(username);

  if (!cleaned) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: {
      username: cleaned,
    },
    select: {
      id: true,
    },
  });

  return user?.id ?? null;
}

async function recordToolCallReceipt({
  args,
  call,
  objective,
  requesterUserId,
  resultText,
  senderAgentOpenclawId,
  sourceRoomId,
  taskId,
}: {
  args: Record<string, unknown> | null;
  call: OpenClawFunctionCall;
  objective?: string;
  requesterUserId?: string;
  resultText: string;
  senderAgentOpenclawId: string;
  sourceRoomId?: string;
  taskId?: string | null;
}) {
  const result = parseToolResult(resultText);
  const ok = result?.ok === true;
  const effectiveTaskId =
    (typeof result?.taskId === "string" && result.taskId.trim()) ||
    (typeof result?.handoffTaskId === "string" && result.handoffTaskId.trim()) ||
    taskId ||
    null;
  const targetUserId =
    call.name === "study_send_dm" || call.name === "study_schedule_dm"
      ? await userIdForUsername(result?.toUsername ?? args?.toUsername)
      : call.name === "study_request_agent_action"
        ? await userIdForUsername(
            (result?.targetAgent as { ownerUsername?: unknown } | undefined)?.ownerUsername ??
              args?.targetOwnerUsername,
          )
      : null;

  const receipt = await recordAgentActionReceipt({
    action: call.name,
    agentOpenclawId: senderAgentOpenclawId,
    eventType: toolReceiptEventType(call.name, ok),
    objective,
    payload: {
      args: (args ?? null) as Prisma.InputJsonValue,
      result: (result ?? resultText) as Prisma.InputJsonValue,
      toolName: call.name,
    } satisfies Prisma.InputJsonValue,
    requesterUserId,
    resultSummary: toolReceiptSummary(call.name, result),
    sourceRoomId,
    status: ok ? "success" : "failure",
    summary: toolReceiptSummary(call.name, result),
    targetUserId,
    taskId: effectiveTaskId,
    title: `CyWorld tool ${call.name}`,
  });

  if (
    receipt?.taskId &&
    result &&
    (call.name === "study_send_email" || call.name === "study_send_calendar_invite_email") &&
    typeof result.threadId === "string"
  ) {
    await prisma.emailThread.updateMany({
      where: {
        gmailThreadId: result.threadId,
        taskId: null,
      },
      data: {
        taskId: receipt.taskId,
      },
    });
  }

  return receipt;
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

type HumanRecipientCandidate = {
  aliases: string[];
  displayName: string;
  username: string;
};

type DmRecipientResolution =
  | {
      status: "accepted";
      toUsername: string;
    }
  | {
      explicitUsername: string;
      requestedUsername: string;
      status: "conflict";
    }
  | {
      candidates: string[];
      requestedUsername: string;
      status: "ambiguous";
    };

function aliasesForUser(user: { displayName: string; username: string }) {
  return [
    user.username,
    user.displayName,
    user.displayName.split(/\s+/)[0] ?? "",
  ].filter((value) => value.trim().length > 0);
}

function mentionsCandidate(text: string, candidate: HumanRecipientCandidate) {
  const normalized = text.toLowerCase();

  return candidate.aliases.some((alias) => {
    const pattern = aliasPattern(alias);

    if (!pattern) {
      return false;
    }

    return new RegExp(`(?:^|[^a-z0-9_-])@?${pattern}(?=$|[^a-z0-9_-])`, "i").test(
      normalized,
    );
  });
}

function explicitRecipientMatches(text: string, candidates: HumanRecipientCandidate[]) {
  return candidates.filter((candidate) => matchesRecipientCommand(text, candidate.aliases));
}

function mentionedRecipients(text: string, candidates: HumanRecipientCandidate[]) {
  return candidates.filter((candidate) => mentionsCandidate(text, candidate));
}

async function listHumanRecipientCandidates() {
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

  return users.map((user) => ({
    aliases: aliasesForUser(user),
    displayName: user.displayName,
    username: user.username,
  }));
}

async function resolveDmTargetUsername({
  objective,
  requestedUsername,
}: {
  objective?: string;
  requestedUsername: string;
}): Promise<DmRecipientResolution> {
  if (!objective?.trim()) {
    return {
      status: "accepted",
      toUsername: requestedUsername,
    };
  }

  const candidates = await listHumanRecipientCandidates();
  const explicitMatches = explicitRecipientMatches(objective, candidates);

  if (explicitMatches.length === 1) {
    const explicitUsername = explicitMatches[0].username;

    if (explicitUsername !== requestedUsername) {
      return {
        explicitUsername,
        requestedUsername,
        status: "conflict",
      };
    }

    return {
      status: "accepted",
      toUsername: requestedUsername,
    };
  }

  const mentioned = mentionedRecipients(objective, candidates);

  if (explicitMatches.length > 1 || mentioned.length > 1) {
    return {
      candidates: [...new Set(mentioned.map((candidate) => candidate.username))],
      requestedUsername,
      status: "ambiguous",
    };
  }

  return {
    status: "accepted",
    toUsername: requestedUsername,
  };
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
  currentHumanUserId,
  initiatedByUserId,
  senderAgentOpenclawId,
  triggerType,
}: {
  args: Record<string, unknown>;
  currentHumanUserId?: string;
  initiatedByUserId?: string;
  senderAgentOpenclawId: string;
  triggerType?: string | null;
}) {
  const [currentHuman, initiator, senderAgent] = await Promise.all([
    currentHumanUserId
      ? prisma.user.findUnique({
          where: {
            id: currentHumanUserId,
          },
          select: {
            displayName: true,
            id: true,
            timezone: true,
            username: true,
          },
        })
      : null,
    initiatedByUserId
      ? prisma.user.findUnique({
          where: {
            id: initiatedByUserId,
          },
          select: {
            displayName: true,
            id: true,
            timezone: true,
            username: true,
          },
        })
      : null,
    prisma.agent.findUnique({
      where: {
        openclawAgentId: senderAgentOpenclawId,
      },
      include: {
        user: true,
      },
    }),
  ]);

  if (!senderAgent) {
    return JSON.stringify({
      ok: false,
      reason: "acting_agent_not_found",
    });
  }

  const requestedUsername = cleanUsername(args.username);
  const actingOwner = senderAgent.user;
  const viewer = currentHuman ?? initiator ?? actingOwner;
  const effectiveUsername =
    requestedUsername || currentHuman?.username || actingOwner.username;

  if (effectiveUsername === actingOwner.username) {
    const ownerIsCurrentHuman = currentHuman?.id === actingOwner.id;
    const autonomousOwnerWork = !currentHuman && triggerType !== "agent_handoff";
    const policy = normalizeAgentBehaviorConfig(
      senderAgent.soulConfigJson,
    ).calendarSharingPolicy;

    if (!ownerIsCurrentHuman && !autonomousOwnerWork && policy !== "always") {
      return JSON.stringify({
        ok: false,
        reason:
          policy === "never"
            ? "owner_calendar_sharing_disabled"
            : "owner_calendar_permission_required",
        owner: {
          displayName: actingOwner.displayName,
          username: actingOwner.username,
        },
        requestedUsername: effectiveUsername,
      });
    }

    const ownerView = await listCalendarMonth(actingOwner.id, cleanMonth(args.month));

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
        displayName: viewer.displayName,
        timezone: normalizeTimeZone(viewer.timezone),
        username: viewer.username,
      },
      sharedFrom: {
        displayName: actingOwner.displayName,
        username: actingOwner.username,
      },
      sharingPolicy: ownerIsCurrentHuman || autonomousOwnerWork ? "owner_access" : policy,
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

  if (!currentHuman || effectiveUsername !== currentHuman.username) {
    return JSON.stringify({
      ok: false,
      reason: "calendar_access_is_limited_to_current_human_or_acting_agent_owner",
      currentHuman: currentHuman
        ? {
            displayName: currentHuman.displayName,
            username: currentHuman.username,
          }
        : null,
      requestedUsername: effectiveUsername,
    });
  }

  const view = await listCalendarMonth(currentHuman.id, cleanMonth(args.month));

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
      displayName: currentHuman.displayName,
      timezone: view.timeZone,
      username: currentHuman.username,
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
  currentHumanUserId,
  objective,
}: {
  args: Record<string, unknown>;
  currentHumanUserId?: string;
  objective?: string;
}) {
  if (!currentHumanUserId) {
    return JSON.stringify({
      ok: false,
      reason: "calendar_mutation_requires_current_human",
      guidance:
        "Do not create or modify a person's calendar from an internal agent handoff. Ask the relevant human for approval in their own conversation.",
    });
  }

  const title = typeof args.title === "string" ? args.title.trim() : "";
  const startAt = parseDate(args.startAt);
  const endAt = parseDate(args.endAt);
  const requester = await prisma.user.findUnique({
    where: {
      id: currentHumanUserId,
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
    createdByUserId: currentHumanUserId,
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
  currentHumanUserId,
  objective,
  senderAgentOpenclawId,
  sourceRoomId,
  taskId,
}: {
  args: Record<string, unknown>;
  currentHumanUserId?: string;
  objective?: string;
  senderAgentOpenclawId: string;
  sourceRoomId?: string;
  taskId?: string | null;
}) {
  if (!currentHumanUserId) {
    return JSON.stringify({
      ok: false,
      reason: "external_calendar_invite_requires_current_human",
      guidance:
        "Do not create or send an external calendar invitation from an internal agent handoff. Ask the relevant human for approval in their own conversation.",
    });
  }
  const requesterUserId = currentHumanUserId;

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
        create: {
          type: "AGENT_DECISION",
          summary: `Agent chose to ${kind === "schedule_dm" ? "schedule" : "send"} a CyWorld DM to @${targetUser.username}.`,
          payload: {
            expectReply,
            message,
          },
        },
      },
    },
  });
}

export async function handleCyWorldAgentToolCall({
  call,
  currentHumanUserId,
  objective,
  requesterUserId,
  senderAgentOpenclawId,
  sourceRoomId,
  taskId,
  triggerType,
}: {
  call: OpenClawFunctionCall;
  currentHumanUserId?: string | null;
  objective?: string;
  requesterUserId?: string;
  senderAgentOpenclawId: string;
  sourceRoomId?: string;
  taskId?: string | null;
  triggerType?: string | null;
}) {
  const context: CyWorldExecutionContext = {
    actingAgentOpenclawId: senderAgentOpenclawId,
    currentHumanUserId: currentHumanUserId ?? null,
    initiatedByUserId: requesterUserId ?? null,
    originRoomId: sourceRoomId ?? null,
    taskId: taskId ?? null,
    triggerType: triggerType ?? null,
  };
  const idempotencyKey = [
    context.actingAgentOpenclawId,
    context.taskId ?? context.originRoomId ?? context.initiatedByUserId ?? "system",
    call.callId,
  ].join(":");
  const existingExecution = await prisma.agentToolExecution.findUnique({
    where: {
      idempotencyKey,
    },
  });

  if (existingExecution?.resultText) {
    return existingExecution.resultText;
  }

  if (existingExecution?.status === "RUNNING") {
    return JSON.stringify({
      ok: false,
      reason: "tool_call_already_in_progress",
    });
  }

  let executionId: string;

  try {
    const execution = await prisma.agentToolExecution.create({
      data: {
        actingAgentId: context.actingAgentOpenclawId,
        callId: call.callId,
        idempotencyKey,
        status: "RUNNING",
        taskId: context.taskId,
        toolName: call.name,
      },
    });
    executionId = execution.id;
  } catch {
    const racedExecution = await prisma.agentToolExecution.findUnique({
      where: {
        idempotencyKey,
      },
    });

    if (racedExecution?.resultText) {
      return racedExecution.resultText;
    }

    return JSON.stringify({
      ok: false,
      reason: "tool_call_already_in_progress",
    });
  }

  const args = parseToolArguments(call);
  let resultText: string;

  try {
    if (!args) {
      resultText = JSON.stringify({
        ok: false,
        reason: "invalid_json_arguments",
      });
    } else {
      resultText = await executeCyWorldAgentToolCall({
        args,
        call,
        context,
        objective,
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown CyWorld tool error.";
    resultText = JSON.stringify({
      ok: false,
      reason: "cyworld_tool_execution_failed",
      error: reason,
    });

    await prisma.agentToolExecution.update({
      where: {
        id: executionId,
      },
      data: {
        error: reason,
        resultText,
        status: "FAILED",
      },
    });
  }

  if (shouldRecordToolReceipt(call.name)) {
    try {
      await recordToolCallReceipt({
        args,
        call,
        objective,
        requesterUserId,
        resultText,
        senderAgentOpenclawId,
        sourceRoomId,
        taskId,
      });
    } catch (error) {
      console.error("[action-receipt] failed to record CyWorld tool receipt", {
        error,
        toolName: call.name,
      });
    }
  }

  const parsedResult = parseToolResult(resultText);
  const resultingTaskId =
    (typeof parsedResult?.taskId === "string" && parsedResult.taskId.trim()) ||
    (typeof parsedResult?.handoffTaskId === "string" &&
      parsedResult.handoffTaskId.trim()) ||
    context.taskId ||
    null;

  await prisma.agentToolExecution.update({
    where: {
      id: executionId,
    },
    data: {
      error: parsedResult?.ok === false ? toolReceiptSummary(call.name, parsedResult) : null,
      resultText,
      status: parsedResult?.ok === false ? "FAILED" : "SUCCEEDED",
      taskId: resultingTaskId,
    },
  });

  return resultText;
}

async function executeCyWorldAgentToolCall({
  args,
  call,
  context,
  objective,
}: {
  args: Record<string, unknown>;
  call: OpenClawFunctionCall;
  context: CyWorldExecutionContext;
  objective?: string;
}) {
  const requesterUserId = context.initiatedByUserId ?? undefined;
  const senderAgentOpenclawId = context.actingAgentOpenclawId;
  const sourceRoomId = context.originRoomId ?? undefined;
  const taskId = context.taskId;

  if (call.name === "study_list_pending_tasks") {
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit)
        ? args.limit
        : undefined;

    return JSON.stringify(
      await listPendingAgentTasks({
        agentOpenclawId: senderAgentOpenclawId,
        limit,
      }),
    );
  }

  if (call.name === "study_recall_conversation") {
    return JSON.stringify(
      await recallConversationHistory({
        args,
        context,
      }),
    );
  }

  if (call.name === "study_update_owner_sharing_policies") {
    return JSON.stringify(
      await updateOwnerSharingPolicies({
        args,
        context,
      }),
    );
  }

  if (call.name === "study_set_relationship_guidance") {
    return JSON.stringify(
      await updateOwnerRelationshipGuidance({
        args,
        context,
      }),
    );
  }

  if (call.name === "study_request_agent_action") {
    const handoffTools = CYWORLD_AGENT_TOOLS.filter(
      (tool) => tool.name !== "study_request_agent_action",
    );
    const result = await runAgentHandoff({
      input: {
        continueTaskId: args.continueTaskId,
        request: args.request,
        targetOwnerUsername: args.targetOwnerUsername,
      },
      parentTaskId: taskId,
      requesterUserId,
      sourceAgentOpenclawId: senderAgentOpenclawId,
      sourceRoomId,
      targetTools: handoffTools,
      onTargetToolCall: (targetCall, context) =>
        handleCyWorldAgentToolCall({
          call: targetCall,
          currentHumanUserId: null,
          objective: cleanMessage(args.request),
          requesterUserId: context.requesterUserId,
          senderAgentOpenclawId: context.targetAgentOpenclawId,
          sourceRoomId: context.sourceRoomId,
          taskId: context.taskId,
          triggerType: "agent_handoff",
        }),
    });

    return JSON.stringify(result);
  }

  if (call.name === "study_list_calendar") {
    return handleCalendarListTool({
      args,
      currentHumanUserId: context.currentHumanUserId ?? undefined,
      initiatedByUserId: requesterUserId,
      senderAgentOpenclawId,
      triggerType: context.triggerType,
    });
  }

  if (call.name === "study_create_calendar_event") {
    return handleCalendarCreateTool({
      args,
      currentHumanUserId: context.currentHumanUserId ?? undefined,
      objective,
    });
  }

  if (call.name === "study_send_calendar_invite_email") {
    return handleExternalCalendarInviteTool({
      args,
      currentHumanUserId: context.currentHumanUserId ?? undefined,
      objective,
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

  if (call.name === "study_create_google_workspace_file") {
    const fileType = cleanMessage(args.fileType);
    const title = cleanMessage(args.title);

    if (
      !title ||
      !["slides", "docs", "sheets"].includes(fileType)
    ) {
      return JSON.stringify({
        ok: false,
        reason: "missing_or_invalid_google_workspace_file_type_or_title",
      });
    }

    return JSON.stringify(
      await createGoogleWorkspaceFile({
        fileType: fileType as "slides" | "docs" | "sheets",
        title,
      }),
    );
  }

  if (call.name === "study_inspect_google_slides") {
    const presentation = cleanMessage(args.presentation);

    if (!presentation) {
      return JSON.stringify({
        ok: false,
        reason: "missing_google_slides_url_or_id",
      });
    }

    return JSON.stringify(await inspectSharedGoogleSlides(presentation));
  }

  if (call.name === "study_update_google_slides") {
    const presentation = cleanMessage(args.presentation);
    const requestsJson = cleanMessage(args.requestsJson);
    const requiredRevisionId = cleanMessage(args.requiredRevisionId);

    if (!presentation || !requestsJson) {
      return JSON.stringify({
        ok: false,
        reason: "missing_google_slides_url_or_id_or_requests",
      });
    }

    return JSON.stringify(
      await updateSharedGoogleSlides({
        presentation,
        requestsJson,
        requiredRevisionId: requiredRevisionId || null,
      }),
    );
  }

  if (call.name === "study_inspect_google_docs") {
    const document = cleanMessage(args.document);

    if (!document) {
      return JSON.stringify({
        ok: false,
        reason: "missing_google_docs_url_or_id",
      });
    }

    return JSON.stringify(await inspectSharedGoogleDocs(document));
  }

  if (call.name === "study_update_google_docs") {
    const document = cleanMessage(args.document);
    const requestsJson = cleanMessage(args.requestsJson);
    const requiredRevisionId = cleanMessage(args.requiredRevisionId);

    if (!document || !requestsJson) {
      return JSON.stringify({
        ok: false,
        reason: "missing_google_docs_url_or_id_or_requests",
      });
    }

    return JSON.stringify(
      await updateSharedGoogleDocs({
        document,
        requestsJson,
        requiredRevisionId: requiredRevisionId || null,
      }),
    );
  }

  if (call.name === "study_inspect_google_sheets") {
    const spreadsheet = cleanMessage(args.spreadsheet);
    const rangesJson = cleanMessage(args.rangesJson);

    if (!spreadsheet) {
      return JSON.stringify({
        ok: false,
        reason: "missing_google_sheets_url_or_id",
      });
    }

    return JSON.stringify(
      await inspectSharedGoogleSheets({
        rangesJson: rangesJson || null,
        spreadsheet,
      }),
    );
  }

  if (call.name === "study_update_google_sheets") {
    const spreadsheet = cleanMessage(args.spreadsheet);
    const requestsJson = cleanMessage(args.requestsJson);

    if (!spreadsheet || !requestsJson) {
      return JSON.stringify({
        ok: false,
        reason: "missing_google_sheets_url_or_id_or_requests",
      });
    }

    return JSON.stringify(
      await updateSharedGoogleSheets({
        requestsJson,
        spreadsheet,
      }),
    );
  }

  if (call.name === "study_inspect_google_file_review") {
    const file = cleanMessage(args.file);

    if (!file) {
      return JSON.stringify({
        ok: false,
        reason: "missing_google_drive_file_url_or_id",
      });
    }

    return JSON.stringify(
      await inspectGoogleFileReview({
        file,
        includeResolved: args.includeResolved !== false,
      }),
    );
  }

  if (call.name === "study_update_google_file_review") {
    const action = cleanMessage(args.action);
    const file = cleanMessage(args.file);
    const commentId = cleanMessage(args.commentId);
    const content = cleanMessage(args.content);

    if (
      !file ||
      !["add_comment", "reply", "resolve"].includes(action)
    ) {
      return JSON.stringify({
        ok: false,
        reason: "missing_or_invalid_google_review_file_or_action",
      });
    }

    return JSON.stringify(
      await updateGoogleFileReview({
        action: action as "add_comment" | "reply" | "resolve",
        commentId: commentId || null,
        content: content || null,
        file,
      }),
    );
  }

  if (call.name === "study_request_google_file_review") {
    const file = cleanMessage(args.file);
    const message = cleanMessage(args.message);

    if (!file || !message) {
      return JSON.stringify({
        ok: false,
        reason: "missing_review_file_or_message",
      });
    }

    return JSON.stringify(
      await requestGoogleFileReview({
        file,
        message,
      }),
    );
  }

  const requestedToUsername = cleanUsername(args.toUsername);
  const recipientResolution = await resolveDmTargetUsername({
    objective,
    requestedUsername: requestedToUsername,
  });
  const toUsername =
    recipientResolution.status === "accepted" ? recipientResolution.toUsername : "";
  const message = cleanMessage(args.message);
  const expectReply = args.expectReply === true;

  if (!requestedToUsername || !toUsername || !message) {
    if (recipientResolution.status === "conflict") {
      return JSON.stringify({
        ok: false,
        reason: "dm_recipient_conflict",
        explicitRecipient: `@${recipientResolution.explicitUsername}`,
        requestedToUsername: recipientResolution.requestedUsername,
        guidance:
          "The user's request names a different recipient than the tool call. Do not send yet. If the named recipient is correct, call the same CyWorld DM tool again with that exact toUsername.",
      });
    }

    if (recipientResolution.status === "ambiguous") {
      return JSON.stringify({
        ok: false,
        reason: "ambiguous_dm_recipient",
        candidates: recipientResolution.candidates.map((username) => `@${username}`),
        requestedToUsername: recipientResolution.requestedUsername,
        guidance:
          "Do not send yet. Ask the user which human participant should receive the DM, then call study_send_dm again with that exact username.",
      });
    }

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

    return JSON.stringify({
      ...result,
      recipientResolution,
      taskId: effectiveTaskId,
    });
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

    return JSON.stringify({
      ...result,
      recipientResolution,
      taskId: effectiveTaskId,
    });
  }

  return JSON.stringify({
    ok: false,
    reason: "unknown_tool",
    tool: call.name,
  });
}
