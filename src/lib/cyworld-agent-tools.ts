import {
  AgentTaskEventType,
  Prisma,
} from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createCalendarEvent,
  deleteCalendarEventForUser,
  listCalendarMonth,
  respondToCalendarInvitation,
  updateCalendarEvent,
  type CalendarEventView,
} from "@/lib/calendar";
import { runAgentHandoff } from "@/lib/agent-handoff";
import { recordAgentActionReceipt } from "@/lib/action-receipts";
import {
  normalizeChatAttachments,
  saveGeneratedChatImageAttachment,
} from "@/lib/chat-attachments";
import {
  markTaskWaitingForReview,
  nextTaskReviewAt,
  normalizeReviewMinutes,
} from "@/lib/agent-task-review-schedule";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { updateOwnerRelationshipGuidance } from "@/lib/agent-relationships";
import {
  recallConversationHistory,
  updateOwnerSharingPolicies,
} from "@/lib/conversation-memory";
import type { CyWorldExecutionContext } from "@/lib/cyworld-execution-context";
import {
  inspectGoogleFileReview,
  inspectSharedGoogleDocs,
  inspectSharedGoogleSheets,
  inspectSharedGoogleSlides,
  extractGoogleWorkspaceFileId,
  requestGoogleFileReview,
  replySharedGmail,
  sendSharedGmail,
  updateGoogleFileReview,
  updateSharedGoogleDocs,
  updateSharedGoogleSheets,
  updateSharedGoogleSlides,
  writeSharedGoogleDocsText,
} from "@/lib/google-integration";
import {
  authorizeGoogleWorkspaceFileForAgent,
  createGoogleWorkspaceEntryForAgent,
  getAgentEmailAttachments,
} from "@/lib/files";
import { scheduleAgentDm, sendAgentDm } from "@/lib/internal-agent-actions";
import type { OpenClawFunctionCall, OpenClawFunctionTool } from "@/lib/openclaw";
import { listPendingAgentTasks } from "@/lib/pending-agent-tasks";
import { prisma } from "@/lib/prisma";
import {
  editOpenAiImage,
  generateOpenAiImage,
} from "@/lib/openai-images";
import {
  dateKeyInTimeZone,
  formatDateTimeInTimeZone,
  normalizeTimeZone,
} from "@/lib/timezone";
import { scheduleVideoCall } from "@/lib/video-calls";

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
    name: "study_manage_current_task",
    description:
      "Update the lifecycle of the current CyWorld task after reviewing its durable history. Use wait when external input or a later re-check is still needed, and provide reviewAfterMinutes. Use complete only when the objective is actually finished or no further action is useful. This tool only operates on the active task supplied by CyWorld.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["wait", "complete"],
        },
        reviewAfterMinutes: {
          type: "number",
          description:
            "Required for wait. Choose when this agent should wake and reconsider the task if no new input arrives.",
        },
        summary: {
          type: "string",
          description:
            "A concise durable note explaining the current task state and next expected step.",
        },
      },
      required: ["action", "summary"],
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
    name: "study_generate_image",
    description:
      "Generate a new image and share it into the current CyWorld DM or Team Chat as an image attachment. Use it when the user asks this agent to draw, create, generate, mock up, render, visualize, or make an image. Do not claim the image was created unless this tool returns ok:true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        filename: {
          type: "string",
          description:
            "Optional filename for the generated image, such as concept.png. CyWorld will sanitize it.",
        },
        prompt: {
          type: "string",
          description:
            "The full image prompt. Include visual style, subject, composition, and constraints from the conversation.",
        },
        size: {
          type: "string",
          enum: ["auto", "1024x1024", "1024x1536", "1536x1024"],
          description:
            "Optional output size. Use auto unless the user requested square, portrait, or landscape.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "study_edit_image",
    description:
      "Edit an image that was shared in the current CyWorld conversation and post the edited result back into the same DM or Team Chat. Prefer sourceMessageId when the user replied to a specific image message; otherwise omit it and CyWorld will use the most recent image attachment in this room. Do not claim the edit succeeded unless this tool returns ok:true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        filename: {
          type: "string",
          description:
            "Optional filename for the edited image, such as edited-concept.png. CyWorld will sanitize it.",
        },
        prompt: {
          type: "string",
          description:
            "The requested edit. Preserve important source-image details unless the user asked to change them.",
        },
        size: {
          type: "string",
          enum: ["auto", "1024x1024", "1024x1536", "1536x1024"],
          description:
            "Optional output size. Use auto unless the user requested square, portrait, or landscape.",
        },
        sourceMessageId: {
          type: "string",
          description:
            "Optional CyWorld message ID containing the source image, especially when editing a replied-to image.",
        },
      },
      required: ["prompt"],
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
        reviewAfterMinutes: {
          type: "number",
          description:
            "When expectReply is true, choose how many minutes to wait before this agent automatically re-checks the task if no reply arrives. Omit for the configurable CyWorld default.",
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
    name: "study_schedule_video_call",
    description:
      "Reserve a future CyWorld Video Call for human participants. Use it when the user asks to schedule, reserve, arrange, or set up a video call in CyWorld. This does not start a live call: humans must start or join the live room from the Video Call tab. Agents cannot attend, watch, listen to, speak in, start, or control live video calls. The current human participant becomes the organizer, and the invited human participants receive pending CyWorld Calendar invitations.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        endAt: {
          type: "string",
          description:
            "Video call end as an ISO 8601 datetime string with the correct timezone offset for the current human participant unless another timezone was specified.",
        },
        invitedUsernames: {
          type: "array",
          description:
            "CyWorld human usernames to invite, without @. Do not include agents. The current human organizer is automatically included in the scheduled call.",
          items: {
            type: "string",
          },
        },
        name: {
          type: "string",
          description: "Video call name.",
        },
        startAt: {
          type: "string",
          description:
            "Video call start as an ISO 8601 datetime string with the correct timezone offset for the current human participant unless another timezone was specified.",
        },
      },
      required: ["name", "startAt", "endAt", "invitedUsernames"],
    },
  },
  {
    name: "study_update_calendar_event",
    description:
      "Update an existing event visible in the current human participant's CyWorld Calendar. First use study_list_calendar and use the exact eventId it returns; never guess an event from its title alone. Omitted fields are preserved. If invitedUsernames is provided, it replaces the current internal CyWorld invitee list. Time changes send fresh pending invitations to internal invitees.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: {
          type: "string",
          description:
            "Optional replacement notes or agenda. Pass an empty string to clear it.",
        },
        endAt: {
          type: "string",
          description:
            "Optional replacement end as an ISO 8601 datetime with the correct timezone offset.",
        },
        eventId: {
          type: "string",
          description:
            "Exact CyWorld event ID returned by study_list_calendar.",
        },
        invitedUsernames: {
          type: "array",
          description:
            "Optional complete replacement list of internal CyWorld invitees. Omit to preserve invitees; pass an empty array to remove all invitees.",
          items: {
            type: "string",
          },
        },
        location: {
          type: "string",
          description:
            "Optional replacement location or meeting link. Pass an empty string to clear it.",
        },
        startAt: {
          type: "string",
          description:
            "Optional replacement start as an ISO 8601 datetime with the correct timezone offset.",
        },
        title: {
          type: "string",
          description:
            "Optional title shown to the current human participant. CyWorld titles can be personalized per participant.",
        },
      },
      required: ["eventId"],
    },
  },
  {
    name: "study_delete_calendar_event",
    description:
      "Remove an existing event from the current human participant's CyWorld Calendar. First use study_list_calendar and use the exact eventId it returns. mode=hide removes only this participant's calendar view without changing RSVP. mode=decline changes this participant's internal CyWorld RSVP to declined and removes their access; for an event they created or were not invited to, CyWorld safely falls back to hiding it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        eventId: {
          type: "string",
          description:
            "Exact CyWorld event ID returned by study_list_calendar.",
        },
        mode: {
          type: "string",
          enum: ["hide", "decline"],
          description:
            "Use hide to remove only from this calendar, or decline to decline an internal invitation and remove access.",
        },
      },
      required: ["eventId", "mode"],
    },
  },
  {
    name: "study_update_calendar_rsvp",
    description:
      "Accept or decline an internal CyWorld Calendar invitation for the current human participant. First use study_list_calendar and use the exact invitationId returned for the event or pending invitation. This can change an already accepted invitation to declined, or a previously declined invitation back to accepted when its invitation ID is known. CyWorld updates calendar access together with the RSVP.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        invitationId: {
          type: "string",
          description:
            "Exact internal invitation ID returned by study_list_calendar.",
        },
        status: {
          type: "string",
          enum: ["accepted", "declined"],
        },
      },
      required: ["invitationId", "status"],
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
        reviewAfterMinutes: {
          type: "number",
          description:
            "When a reply is expected, choose how many minutes after delivery to wait before this agent automatically re-checks the task. Omit for the configurable CyWorld default.",
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
    name: "study_list_email_threads",
    description:
      "List Shared Gmail threads that belong to this personal agent. Use this to find the exact CyWorld emailThreadId before replying to an earlier email conversation. This never exposes unrelated messages from the shared inbox.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "number",
          description: "Optional maximum number of threads to return, from 1 to 20.",
        },
        query: {
          type: "string",
          description:
            "Optional text to search in this agent's tracked email subject, To, or CC fields.",
        },
      },
      required: [],
    },
  },
  {
    name: "study_send_email",
    description:
      "Send a new email through Shared Gmail, the one Gmail account shared by CyWorld agents. Use only when a user explicitly asks or approves sending mail, including ordinary wording such as 'email them', 'send this to that address', or 'CC'. It is not this agent's personal address. Optional attachments must be exact accessible CyWorld Drive file paths.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        attachmentPaths: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Optional exact CyWorld Drive file paths to attach, such as /Personals/hyungjun/report.pdf. CyWorld validates this agent's access before reading them.",
        },
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
    name: "study_reply_email_thread",
    description:
      "Reply in an existing Shared Gmail thread that belongs to this personal agent. First obtain the exact emailThreadId from study_list_email_threads, the current routed email-reply context, or a pending task. CyWorld derives the real recipients and Gmail threading headers from the tracked thread; do not invent a recipient. Optional attachments must be exact accessible CyWorld Drive file paths.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        attachmentPaths: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "Optional exact CyWorld Drive file paths to attach. CyWorld validates this agent's access before reading them.",
        },
        body: {
          type: "string",
          description: "The reply body.",
        },
        emailThreadId: {
          type: "string",
          description:
            "The exact internal CyWorld email thread ID returned by study_list_email_threads or supplied in routed email context.",
        },
        replyAll: {
          type: "boolean",
          description:
            "Set true only when the user asks to include the other To and CC participants from the tracked thread.",
        },
      },
      required: ["emailThreadId", "body"],
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
      "Create a new blank Google Slides, Docs, or Sheets file owned by the shared CyWorld Google account and register it in CyWorld Drive. Use this when the user asks for a new Google presentation, document, or spreadsheet. Set cyworldFolderPath when the user names a visible CyWorld Drive folder; otherwise the file is placed in the owner's personal folder. CyWorld validates folder access. After creation, use the matching Google update tool to add content.",
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
        cyworldFolderPath: {
          type: "string",
          description:
            "Optional CyWorld Drive folder path such as /Personals/hyungjun or /Research. If omitted, the file is created in the owner's personal CyWorld Drive folder.",
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
    name: "study_write_google_docs_text",
    description:
      "Write plain text content into a Google Docs document through the shared CyWorld Google account. Use this for normal requests like filling a blank document, drafting content into a document, replacing the document body, or appending text. Inspect first when you need the current revision ID. Prefer this over study_update_google_docs unless you need precise native Google Docs formatting or structural edits. Do not claim the document was filled or updated unless this tool returns ok:true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        document: {
          type: "string",
          description: "A Google Docs URL or document ID.",
        },
        content: {
          type: "string",
          description:
            "The complete plain text to write into the Google Docs document.",
        },
        mode: {
          enum: ["replace", "append"],
          type: "string",
          description:
            "Use replace to overwrite the body, or append to add this text to the end. Defaults to replace.",
        },
        requiredRevisionId: {
          type: "string",
          description:
            "Optional revision ID returned by study_inspect_google_docs. Include it when editing an existing document.",
        },
      },
      required: ["document", "content"],
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
    "study_list_email_threads",
    "study_list_pending_tasks",
    "study_manage_current_task",
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

    if (
      result.videoCall &&
      typeof result.videoCall === "object" &&
      !Array.isArray(result.videoCall)
    ) {
      const name = (result.videoCall as { name?: unknown }).name;
      return `CyWorld tool ${toolName} succeeded${typeof name === "string" ? ` for "${name}"` : ""}.`;
    }

    if (result.entry && typeof result.entry === "object" && !Array.isArray(result.entry)) {
      const filename = (result.entry as { filename?: unknown }).filename;
      return `CyWorld tool ${toolName} succeeded${typeof filename === "string" ? ` for "${filename}"` : ""}.`;
    }

    if (
      result.document &&
      typeof result.document === "object" &&
      !Array.isArray(result.document)
    ) {
      const title = (result.document as { title?: unknown }).title;
      const insertedChars = result.insertedChars;
      return `CyWorld tool ${toolName} succeeded${
        typeof title === "string" ? ` for "${title}"` : ""
      }${typeof insertedChars === "number" ? ` (${insertedChars} chars)` : ""}.`;
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
    (
      call.name === "study_send_email" ||
      call.name === "study_reply_email_thread" ||
      call.name === "study_send_calendar_invite_email"
    ) &&
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

function generatedImageFilename(value: unknown, fallback: string) {
  const cleaned = cleanMessage(value);

  if (!cleaned) {
    return fallback;
  }

  return cleaned.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)
    ? cleaned
    : `${cleaned}.png`;
}

async function createAgentImageMessage({
  agentOpenclawId,
  attachment,
  content,
  roomId,
  taskId,
}: {
  agentOpenclawId: string;
  attachment: Prisma.InputJsonValue;
  content: string;
  roomId: string;
  taskId?: string | null;
}) {
  const message = await prisma.message.create({
    data: {
      agentId: agentOpenclawId,
      attachmentsJson: [attachment],
      content,
      role: "AGENT",
      roomId,
      taskId: taskId ?? null,
    },
  });

  await prisma.room.update({
    where: {
      id: roomId,
    },
    data: {},
  });

  return message;
}

async function readChatImageAttachment(attachment: {
  filename: string;
  mimeType: string;
  url: string;
}) {
  if (!attachment.url.startsWith("/uploads/chat/")) {
    return null;
  }

  const relativePath = attachment.url.replace(/^\/+/, "");
  const filePath = path.join(process.cwd(), "public", relativePath);
  const buffer = await readFile(filePath).catch(() => null);

  if (!buffer) {
    return null;
  }

  return {
    buffer,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
  };
}

async function findEditableImageInRoom({
  roomId,
  sourceMessageId,
}: {
  roomId: string;
  sourceMessageId?: string;
}) {
  const messages = sourceMessageId
    ? await prisma.message.findMany({
        where: {
          id: sourceMessageId,
          roomId,
        },
        take: 1,
      })
    : await prisma.message.findMany({
        where: {
          roomId,
          attachmentsJson: {
            not: Prisma.JsonNull,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 30,
      });

  for (const message of messages) {
    const image = normalizeChatAttachments(message.attachmentsJson)[0];

    if (!image) {
      continue;
    }

    const source = await readChatImageAttachment(image);

    if (!source) {
      continue;
    }

    return {
      messageId: message.id,
      source,
    };
  }

  return null;
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

function cleanDrivePaths(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 10);
}

async function loadEmailAttachments(
  agentOpenclawId: string,
  value: unknown,
) {
  const drivePaths = cleanDrivePaths(value);
  const result = await getAgentEmailAttachments({
    agentOpenclawId,
    drivePaths,
  });

  if (!result.ok) {
    return result;
  }

  return {
    attachedPaths: result.attachments.map((attachment) => attachment.path),
    attachments: result.attachments.map((attachment) => ({
      content: attachment.content,
      contentType: attachment.contentType,
      filename: attachment.filename,
    })),
    ok: true as const,
    totalBytes: result.totalBytes,
  };
}

async function listAgentEmailThreads({
  agentOpenclawId,
  limit,
  query,
}: {
  agentOpenclawId: string;
  limit?: number;
  query?: string;
}) {
  const normalizedLimit = Math.max(1, Math.min(20, Math.floor(limit ?? 10)));
  const cleanedQuery = query?.trim() ?? "";
  const threads = await prisma.emailThread.findMany({
    where: {
      agentId: agentOpenclawId,
      status: "OPEN",
      ...(cleanedQuery
        ? {
            OR: [
              { cc: { contains: cleanedQuery, mode: "insensitive" } },
              { subject: { contains: cleanedQuery, mode: "insensitive" } },
              { to: { contains: cleanedQuery, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: normalizedLimit,
    include: {
      messages: {
        orderBy: {
          createdAt: "desc",
        },
        take: 4,
        select: {
          body: true,
          cc: true,
          createdAt: true,
          direction: true,
          from: true,
          subject: true,
          to: true,
        },
      },
    },
  });

  return {
    ok: true,
    threads: threads.map((thread) => ({
      cc: thread.cc,
      emailThreadId: thread.id,
      latestMessages: thread.messages.reverse(),
      status: thread.status,
      subject: thread.subject,
      taskId: thread.taskId,
      to: thread.to,
      updatedAt: thread.updatedAt.toISOString(),
    })),
  };
}

async function registerOutboundEmailThread({
  agentId,
  attachmentPaths = [],
  body,
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
  attachmentPaths?: string[];
  body?: string;
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

  const thread = await prisma.emailThread.upsert({
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

  if (gmailMessageId) {
    await prisma.emailMessage.upsert({
      where: {
        gmailMessageId,
      },
      update: {
        body: body ?? undefined,
        cc: cc || null,
        direction: "OUTBOUND",
        emailThreadId: thread.id,
        payloadJson: {
          attachmentPaths,
          gmailThreadId,
        },
        subject,
        to,
      },
      create: {
        body: body ?? null,
        cc: cc || null,
        direction: "OUTBOUND",
        emailThreadId: thread.id,
        gmailMessageId,
        payloadJson: {
          attachmentPaths,
          gmailThreadId,
        },
        subject,
        to,
      },
    });
  }

  return thread;
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
    id: event.id,
    invitees: event.invitees.map((invitee) => ({
      invitationId: invitee.id,
      invitedUserId: invitee.invitedUserId,
      status: invitee.status,
      username: invitee.username,
    })),
    location: event.location,
    originalTitle: event.originalTitle,
    ownerUserId: event.ownerUserId,
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
        invitationId: invitation.id,
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
      invitationId: invitation.id,
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

async function handleVideoCallScheduleTool({
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
      reason: "video_call_schedule_requires_current_human",
      guidance:
        "Do not schedule a CyWorld Video Call from an internal handoff or background context. Ask the relevant human to approve it in their own conversation.",
    });
  }

  const name = cleanMessage(args.name);
  const startAt = parseDate(args.startAt);
  const endAt = parseDate(args.endAt);
  const organizer = await prisma.user.findUnique({
    where: {
      id: currentHumanUserId,
    },
    select: {
      id: true,
      timezone: true,
      username: true,
    },
  });

  if (!organizer) {
    return JSON.stringify({
      ok: false,
      reason: "current_human_not_found",
    });
  }

  const requesterTimezone = normalizeTimeZone(organizer.timezone);

  if (!name || !startAt || !endAt) {
    return JSON.stringify({
      ok: false,
      reason: "missing_or_invalid_name_startAt_or_endAt",
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
        "The user used today-like language. Recalculate the video call date from the current human participant's timezone or ask a clarification before scheduling it.",
    });
  }

  const requestedUsernames = Array.from(
    new Set(
      cleanStringArray(args.invitedUsernames)
        .map((username) => cleanUsername(username))
        .filter(Boolean)
        .filter((username) => username !== organizer.username),
    ),
  );

  const invitees = await prisma.user.findMany({
    where: {
      username: {
        in: requestedUsernames.length > 0 ? requestedUsernames : ["__none__"],
      },
      status: "ACTIVE",
    },
    select: {
      id: true,
      username: true,
    },
  });
  const foundUsernames = new Set(invitees.map((invitee) => invitee.username));
  const missingUsernames = requestedUsernames.filter(
    (username) => !foundUsernames.has(username),
  );

  if (missingUsernames.length > 0) {
    return JSON.stringify({
      ok: false,
      reason: "unknown_or_inactive_video_call_invitees",
      missingUsernames,
      guidance:
        "Ask the user to confirm the human participants. Agents cannot be invited to live CyWorld Video Calls.",
    });
  }

  let scheduleError: string | null = null;
  const scheduled = await scheduleVideoCall({
    createdByUserId: organizer.id,
    endAt,
    invitedUserIds: invitees.map((invitee) => invitee.id),
    name,
    startAt,
  }).catch((error: unknown) => {
    scheduleError = error instanceof Error ? error.message : "Unknown error";
    return null;
  });

  if (!scheduled) {
    return JSON.stringify({
      ok: false,
      reason: "video_call_schedule_failed",
      error: scheduleError,
    });
  }

  return JSON.stringify({
    ok: true,
    videoCall: {
      endAt: endAt.toISOString(),
      endLocal: formatDateTimeInTimeZone(endAt, requesterTimezone, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      id: scheduled.id,
      invitedUsernames: invitees.map((invitee) => invitee.username),
      name: scheduled.name,
      organizerUsername: organizer.username,
      startAt: startAt.toISOString(),
      startLocal: formatDateTimeInTimeZone(startAt, requesterTimezone, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      status: scheduled.status,
    },
    toolNote:
      "The CyWorld Video Call is scheduled. The organizer is accepted, invited human participants receive pending CyWorld Calendar invitations, and agents cannot attend the live call.",
    timeZone: requesterTimezone,
  });
}

async function requireCurrentHumanCalendarMutation(
  currentHumanUserId: string | undefined,
) {
  if (!currentHumanUserId) {
    return {
      error: JSON.stringify({
        ok: false,
        reason: "calendar_mutation_requires_current_human",
        guidance:
          "Do not modify a person's calendar from an internal agent handoff. Ask the relevant human for approval in their own conversation.",
      }),
      user: null,
    };
  }

  const user = await prisma.user.findUnique({
    where: {
      id: currentHumanUserId,
    },
    select: {
      id: true,
      teamId: true,
      timezone: true,
      username: true,
    },
  });

  if (!user) {
    return {
      error: JSON.stringify({
        ok: false,
        reason: "current_human_not_found",
      }),
      user: null,
    };
  }

  return {
    error: null,
    user,
  };
}

async function handleCalendarUpdateTool({
  args,
  currentHumanUserId,
  objective,
}: {
  args: Record<string, unknown>;
  currentHumanUserId?: string;
  objective?: string;
}) {
  const mutationContext =
    await requireCurrentHumanCalendarMutation(currentHumanUserId);

  if (!mutationContext.user) {
    return mutationContext.error;
  }

  const eventId = cleanMessage(args.eventId);
  const hasTitle = Object.hasOwn(args, "title");
  const hasDescription = Object.hasOwn(args, "description");
  const hasLocation = Object.hasOwn(args, "location");
  const hasStartAt = Object.hasOwn(args, "startAt");
  const hasEndAt = Object.hasOwn(args, "endAt");
  const hasInvitees = Object.hasOwn(args, "invitedUsernames");

  if (
    !eventId ||
    !(
      hasTitle ||
      hasDescription ||
      hasLocation ||
      hasStartAt ||
      hasEndAt ||
      hasInvitees
    )
  ) {
    return JSON.stringify({
      ok: false,
      reason: "eventId_and_at_least_one_update_are_required",
    });
  }

  const parsedStartAt = hasStartAt ? parseDate(args.startAt) : undefined;
  const parsedEndAt = hasEndAt ? parseDate(args.endAt) : undefined;

  if ((hasStartAt && !parsedStartAt) || (hasEndAt && !parsedEndAt)) {
    return JSON.stringify({
      ok: false,
      reason: "invalid_startAt_or_endAt",
    });
  }

  const startAt = parsedStartAt ?? undefined;
  const endAt = parsedEndAt ?? undefined;
  const requesterTimezone = normalizeTimeZone(mutationContext.user.timezone);

  if (
    startAt &&
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
        "The user used today-like language. Recalculate the event date from the current human participant's timezone or ask a clarification before updating it.",
    });
  }

  const requestedUsernames = hasInvitees
    ? cleanStringArray(args.invitedUsernames).map((username) =>
        username.replace(/^@/, "").toLowerCase(),
      )
    : undefined;
  const invitees =
    requestedUsernames === undefined
      ? undefined
      : await prisma.user.findMany({
          where: {
            teamId: mutationContext.user.teamId,
            username: {
              in:
                requestedUsernames.length > 0
                  ? requestedUsernames
                  : ["__none__"],
            },
            status: "ACTIVE",
          },
          select: {
            id: true,
            username: true,
          },
        });
  let updateError: string | null = null;

  await updateCalendarEvent({
    description:
      hasDescription && typeof args.description === "string"
        ? args.description
        : undefined,
    endAt,
    eventId,
    invitedUserIds: invitees?.map((invitee) => invitee.id),
    location:
      hasLocation && typeof args.location === "string"
        ? args.location
        : undefined,
    startAt,
    title:
      hasTitle && typeof args.title === "string" ? args.title : undefined,
    userId: mutationContext.user.id,
  }).catch((error: unknown) => {
    updateError = error instanceof Error ? error.message : "Unknown error";
  });

  if (updateError) {
    return JSON.stringify({
      ok: false,
      reason: "calendar_event_update_failed",
      error: updateError,
    });
  }

  const unresolvedInvitedUsernames =
    requestedUsernames?.filter(
      (username) => !invitees?.some((invitee) => invitee.username === username),
    ) ?? [];

  return JSON.stringify({
    ok: true,
    calendar: "CyWorld Calendar",
    event: {
      description:
        hasDescription && typeof args.description === "string"
          ? args.description
          : undefined,
      endAt: endAt?.toISOString(),
      eventId,
      invitedUsernames: invitees?.map((invitee) => invitee.username),
      location:
        hasLocation && typeof args.location === "string"
          ? args.location
          : undefined,
      startAt: startAt?.toISOString(),
      title:
        hasTitle && typeof args.title === "string" ? args.title : undefined,
    },
    preservedOmittedFields: true,
    timeZone: requesterTimezone,
    unresolvedInvitedUsernames,
  });
}

async function handleCalendarDeleteTool({
  args,
  currentHumanUserId,
}: {
  args: Record<string, unknown>;
  currentHumanUserId?: string;
}) {
  const mutationContext =
    await requireCurrentHumanCalendarMutation(currentHumanUserId);

  if (!mutationContext.user) {
    return mutationContext.error;
  }

  const eventId = cleanMessage(args.eventId);
  const requestedMode = cleanMessage(args.mode);

  if (!eventId || !["hide", "decline"].includes(requestedMode)) {
    return JSON.stringify({
      ok: false,
      reason: "missing_or_invalid_eventId_or_mode",
    });
  }

  let deleteError: string | null = null;
  const result = await deleteCalendarEventForUser({
    eventId,
    mode: requestedMode === "decline" ? "DECLINE" : "HIDE",
    userId: mutationContext.user.id,
  }).catch((error: unknown) => {
    deleteError = error instanceof Error ? error.message : "Unknown error";
    return null;
  });

  if (!result) {
    return JSON.stringify({
      ok: false,
      reason: "calendar_event_delete_failed",
      error: deleteError,
    });
  }

  return JSON.stringify({
    ok: true,
    calendar: "CyWorld Calendar",
    eventId,
    requestedMode,
    result: result.action === "DECLINED" ? "rsvp_declined" : "hidden_for_current_human",
  });
}

async function handleCalendarRsvpTool({
  args,
  currentHumanUserId,
}: {
  args: Record<string, unknown>;
  currentHumanUserId?: string;
}) {
  const mutationContext =
    await requireCurrentHumanCalendarMutation(currentHumanUserId);

  if (!mutationContext.user) {
    return mutationContext.error;
  }

  const invitationId = cleanMessage(args.invitationId);
  const requestedStatus = cleanMessage(args.status);

  if (
    !invitationId ||
    !["accepted", "declined"].includes(requestedStatus)
  ) {
    return JSON.stringify({
      ok: false,
      reason: "missing_or_invalid_invitationId_or_status",
    });
  }

  let rsvpError: string | null = null;
  const result = await respondToCalendarInvitation({
    invitationId,
    status: requestedStatus === "accepted" ? "ACCEPTED" : "DECLINED",
    userId: mutationContext.user.id,
  }).catch((error: unknown) => {
    rsvpError = error instanceof Error ? error.message : "Unknown error";
    return null;
  });

  if (!result) {
    return JSON.stringify({
      ok: false,
      reason: "calendar_rsvp_update_failed",
      error: rsvpError,
    });
  }

  return JSON.stringify({
    ok: true,
    calendar: "CyWorld Calendar",
    eventId: result.eventId,
    invitationId: result.invitationId,
    status: result.status,
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
    attachmentPaths: [safeIcsFilename(title)],
    body,
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
  const authorizeGoogleFile = async (value: string) => {
    const fileId = extractGoogleWorkspaceFileId(value);

    if (!fileId) {
      return {
        allowed: false as const,
        reason: "invalid_google_workspace_file_url_or_id",
      };
    }

    return authorizeGoogleWorkspaceFileForAgent({
      agentOpenclawId: senderAgentOpenclawId,
      fileId,
      sourceRoomId,
    });
  };

  if (call.name === "study_list_email_threads") {
    return JSON.stringify(
      await listAgentEmailThreads({
        agentOpenclawId: senderAgentOpenclawId,
        limit:
          typeof args.limit === "number" && Number.isFinite(args.limit)
            ? args.limit
            : undefined,
        query: cleanMessage(args.query) || undefined,
      }),
    );
  }

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

  if (call.name === "study_manage_current_task") {
    if (!taskId) {
      return JSON.stringify({
        ok: false,
        reason: "no_active_task",
      });
    }

    const task = await prisma.agentTask.findFirst({
      where: {
        id: taskId,
        agentId: senderAgentOpenclawId,
        status: {
          in: ["OPEN", "RUNNING", "WAITING"],
        },
      },
      select: {
        id: true,
      },
    });

    if (!task) {
      return JSON.stringify({
        ok: false,
        reason: "active_task_not_found",
      });
    }

    const action = args.action === "complete" ? "complete" : "wait";
    const summary = cleanMessage(args.summary);

    if (!summary) {
      return JSON.stringify({
        ok: false,
        reason: "missing_summary",
      });
    }

    if (action === "complete") {
      await prisma.$transaction([
        prisma.agentTask.update({
          where: {
            id: task.id,
          },
          data: {
            lastReviewedAt: new Date(),
            nextReviewAt: null,
            resultSummary: summary,
            reviewLeaseUntil: null,
            status: "COMPLETED",
          },
        }),
        prisma.agentTaskEvent.create({
          data: {
            taskId: task.id,
            type: "AGENT_DECISION",
            summary,
            payload: {
              action,
            },
          },
        }),
      ]);

      return JSON.stringify({
        action,
        ok: true,
        taskId: task.id,
      });
    }

    const reviewAfterMinutes = normalizeReviewMinutes(args.reviewAfterMinutes);
    const nextReviewAt = await markTaskWaitingForReview({
      afterMinutes: reviewAfterMinutes,
      resultSummary: summary,
      taskId: task.id,
    });

    await prisma.agentTaskEvent.create({
      data: {
        taskId: task.id,
        type: "AGENT_DECISION",
        summary,
        payload: {
          action,
          nextReviewAt: nextReviewAt.toISOString(),
          reviewAfterMinutes,
        },
      },
    });

    return JSON.stringify({
      action,
      nextReviewAt: nextReviewAt.toISOString(),
      ok: true,
      reviewAfterMinutes,
      taskId: task.id,
    });
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

  if (call.name === "study_generate_image") {
    const prompt = cleanMessage(args.prompt);

    if (!prompt) {
      return JSON.stringify({
        ok: false,
        reason: "missing_image_prompt",
      });
    }

    if (!sourceRoomId) {
      return JSON.stringify({
        ok: false,
        reason: "no_current_cyworld_room",
      });
    }

    const generated = await generateOpenAiImage({
      prompt,
      size: args.size,
    });
    const attachment = await saveGeneratedChatImageAttachment({
      buffer: generated.buffer,
      filename: generatedImageFilename(args.filename, "generated-image.png"),
      mimeType: generated.mimeType,
    });
    const message = await createAgentImageMessage({
      agentOpenclawId: senderAgentOpenclawId,
      attachment: attachment as Prisma.InputJsonValue,
      content: "Generated image.",
      roomId: sourceRoomId,
      taskId,
    });

    return JSON.stringify({
      attachment,
      messageId: message.id,
      ok: true,
      roomId: sourceRoomId,
      toolNote:
        "The generated image has already been posted into the current CyWorld conversation as an attachment.",
    });
  }

  if (call.name === "study_edit_image") {
    const prompt = cleanMessage(args.prompt);

    if (!prompt) {
      return JSON.stringify({
        ok: false,
        reason: "missing_image_edit_prompt",
      });
    }

    if (!sourceRoomId) {
      return JSON.stringify({
        ok: false,
        reason: "no_current_cyworld_room",
      });
    }

    const source = await findEditableImageInRoom({
      roomId: sourceRoomId,
      sourceMessageId: cleanMessage(args.sourceMessageId) || undefined,
    });

    if (!source) {
      return JSON.stringify({
        ok: false,
        reason: "no_editable_image_found_in_current_room",
        guidance:
          "Ask the user to attach or reply to the image they want edited, then call this tool again.",
      });
    }

    const edited = await editOpenAiImage({
      image: source.source,
      prompt,
      size: args.size,
    });
    const attachment = await saveGeneratedChatImageAttachment({
      buffer: edited.buffer,
      filename: generatedImageFilename(args.filename, "edited-image.png"),
      mimeType: edited.mimeType,
    });
    const message = await createAgentImageMessage({
      agentOpenclawId: senderAgentOpenclawId,
      attachment: attachment as Prisma.InputJsonValue,
      content: "Edited image.",
      roomId: sourceRoomId,
      taskId,
    });

    return JSON.stringify({
      attachment,
      messageId: message.id,
      ok: true,
      roomId: sourceRoomId,
      sourceMessageId: source.messageId,
      toolNote:
        "The edited image has already been posted into the current CyWorld conversation as an attachment.",
    });
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

  if (call.name === "study_schedule_video_call") {
    return handleVideoCallScheduleTool({
      args,
      currentHumanUserId: context.currentHumanUserId ?? undefined,
      objective,
    });
  }

  if (call.name === "study_update_calendar_event") {
    return handleCalendarUpdateTool({
      args,
      currentHumanUserId: context.currentHumanUserId ?? undefined,
      objective,
    });
  }

  if (call.name === "study_delete_calendar_event") {
    return handleCalendarDeleteTool({
      args,
      currentHumanUserId: context.currentHumanUserId ?? undefined,
    });
  }

  if (call.name === "study_update_calendar_rsvp") {
    return handleCalendarRsvpTool({
      args,
      currentHumanUserId: context.currentHumanUserId ?? undefined,
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

    const attachmentResult = await loadEmailAttachments(
      senderAgentOpenclawId,
      args.attachmentPaths,
    );

    if (!attachmentResult.ok) {
      return JSON.stringify(attachmentResult);
    }

    const result = await sendSharedGmail({
      attachments: attachmentResult.attachments,
      body,
      cc: cc || null,
      subject,
      to,
    });

    if (result.ok) {
      await registerOutboundEmailThread({
        agentId: senderAgentOpenclawId,
        attachmentPaths: attachmentResult.attachedPaths,
        body,
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
      attachedPaths: attachmentResult.attachedPaths,
      ccRecipients: cc ? cc.split(", ") : [],
      senderPolicy:
        "Email is sent through the shared CyWorld Gmail account, not a personal agent address.",
    });
  }

  if (call.name === "study_reply_email_thread") {
    const emailThreadId = cleanMessage(args.emailThreadId);
    const body = cleanMessage(args.body);

    if (!emailThreadId || !body) {
      return JSON.stringify({
        ok: false,
        reason: "missing_email_thread_id_or_body",
      });
    }

    const thread = await prisma.emailThread.findFirst({
      where: {
        agentId: senderAgentOpenclawId,
        id: emailThreadId,
        status: "OPEN",
      },
    });

    if (!thread) {
      return JSON.stringify({
        ok: false,
        reason: "email_thread_not_found_or_not_owned_by_agent",
      });
    }

    if (!thread.lastGmailMessageId) {
      return JSON.stringify({
        ok: false,
        reason: "email_thread_has_no_message_to_reply_to",
      });
    }

    const attachmentResult = await loadEmailAttachments(
      senderAgentOpenclawId,
      args.attachmentPaths,
    );

    if (!attachmentResult.ok) {
      return JSON.stringify(attachmentResult);
    }

    const result = await replySharedGmail({
      attachments: attachmentResult.attachments,
      body,
      fallbackCc: thread.cc,
      fallbackSubject: thread.subject,
      fallbackTo: thread.to,
      gmailThreadId: thread.gmailThreadId,
      lastGmailMessageId: thread.lastGmailMessageId,
      replyAll: args.replyAll === true,
    });

    if (result.ok && result.messageId) {
      await prisma.emailThread.update({
        where: {
          id: thread.id,
        },
        data: {
          cc: result.cc || null,
          lastGmailMessageId: result.messageId,
          subject: result.subject,
          to: result.to,
        },
      });
      await prisma.emailMessage.upsert({
        where: {
          gmailMessageId: result.messageId,
        },
        update: {
          body,
          cc: result.cc || null,
          direction: "OUTBOUND",
          emailThreadId: thread.id,
          payloadJson: {
            attachmentPaths: attachmentResult.attachedPaths,
            gmailThreadId: thread.gmailThreadId,
            replyAll: args.replyAll === true,
          },
          subject: result.subject,
          to: result.to,
        },
        create: {
          body,
          cc: result.cc || null,
          direction: "OUTBOUND",
          emailThreadId: thread.id,
          gmailMessageId: result.messageId,
          payloadJson: {
            attachmentPaths: attachmentResult.attachedPaths,
            gmailThreadId: thread.gmailThreadId,
            replyAll: args.replyAll === true,
          },
          subject: result.subject,
          to: result.to,
        },
      });
    }

    return JSON.stringify({
      ...result,
      attachedPaths: attachmentResult.attachedPaths,
      emailThreadId: thread.id,
      taskId: thread.taskId,
      senderPolicy:
        "This reply is sent through the shared CyWorld Gmail account in the agent's tracked thread.",
    });
  }

  if (call.name === "study_create_google_workspace_file") {
    const fileType = cleanMessage(args.fileType);
    const title = cleanMessage(args.title);
    const cyworldFolderPath = cleanMessage(args.cyworldFolderPath);

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
      await createGoogleWorkspaceEntryForAgent({
        agentOpenclawId: senderAgentOpenclawId,
        fileType: fileType as "slides" | "docs" | "sheets",
        folderPath: cyworldFolderPath || null,
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

    const authorization = await authorizeGoogleFile(presentation);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
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

    const authorization = await authorizeGoogleFile(presentation);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
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

    const authorization = await authorizeGoogleFile(document);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
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

    const authorization = await authorizeGoogleFile(document);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
    }

    return JSON.stringify(
      await updateSharedGoogleDocs({
        document,
        requestsJson,
        requiredRevisionId: requiredRevisionId || null,
      }),
    );
  }

  if (call.name === "study_write_google_docs_text") {
    const document = cleanMessage(args.document);
    const content = cleanMessage(args.content);
    const mode = cleanMessage(args.mode);
    const requiredRevisionId = cleanMessage(args.requiredRevisionId);

    if (!document || !content) {
      return JSON.stringify({
        ok: false,
        reason: "missing_google_docs_url_or_id_or_content",
      });
    }

    const authorization = await authorizeGoogleFile(document);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
    }

    return JSON.stringify(
      await writeSharedGoogleDocsText({
        content,
        document,
        mode: mode === "append" ? "append" : "replace",
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

    const authorization = await authorizeGoogleFile(spreadsheet);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
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

    const authorization = await authorizeGoogleFile(spreadsheet);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
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

    const authorization = await authorizeGoogleFile(file);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
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

    const authorization = await authorizeGoogleFile(file);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
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

    const authorization = await authorizeGoogleFile(file);
    if (!authorization.allowed) {
      return JSON.stringify(authorization);
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
  const reviewAfterMinutes = normalizeReviewMinutes(args.reviewAfterMinutes);

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
      const nextReview =
        result.ok && expectReply
          ? nextTaskReviewAt({
              afterMinutes: reviewAfterMinutes,
            })
          : null;

      await prisma.agentTask.update({
        where: {
          id: createdTask.id,
        },
        data: {
          resultSummary: message,
          nextReviewAt: nextReview,
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
      const deliverAt = new Date(Date.now() + delayMinutes * 60 * 1000);
      await prisma.agentTask.update({
        where: {
          id: createdTask.id,
        },
        data: {
          resultSummary: message,
          nextReviewAt: result.ok
            ? nextTaskReviewAt({
                afterMinutes: reviewAfterMinutes,
                from: deliverAt,
              })
            : null,
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
