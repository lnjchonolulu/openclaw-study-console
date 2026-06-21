import { AgentTaskEventType } from "@prisma/client";

import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import {
  buildRecentActionReceiptContext,
  recordAgentActionReceipt,
} from "@/lib/action-receipts";
import { deliverAgentReport } from "@/lib/agent-report-delivery";
import {
  CYWORLD_AGENT_TOOLS,
  handleCyWorldAgentToolCall,
} from "@/lib/cyworld-agent-tools";
import {
  createAgentTurnContext,
  formatAgentTurnContextInstruction,
} from "@/lib/agent-turn-context";
import {
  listSharedGmailInboxMessages,
  type GmailMessageView,
} from "@/lib/google-integration";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

function summarizeEmailForAgent(
  message: GmailMessageView,
  emailThreadId: string,
) {
  return [
    "A reply arrived in a shared CyWorld Gmail thread that belongs to you.",
    `CyWorld email thread ID: ${emailThreadId}`,
    "",
    `From: ${message.from ?? "(unknown)"}`,
    `To: ${message.to ?? "(unknown)"}`,
    message.cc ? `Cc: ${message.cc}` : null,
    `Subject: ${message.subject ?? "(no subject)"}`,
    "",
    "Reply body:",
    message.body || message.snippet || "(empty)",
    "",
    "Decide the appropriate follow-up. To answer this email, use study_reply_email_thread with the exact CyWorld email thread ID above. You may also report to your human, send a CyWorld DM, schedule a CyWorld DM, or create/check CyWorld Calendar items when appropriate. Do not claim you can see the full shared inbox; CyWorld has routed only this thread reply to you.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function processEmailReply(message: GmailMessageView) {
  const thread = await prisma.emailThread.findUnique({
    where: {
      gmailThreadId: message.threadId,
    },
    include: {
      agent: {
        include: {
          user: true,
        },
      },
      requester: true,
      sourceRoom: true,
      task: true,
    },
  });

  if (!thread || thread.status !== "OPEN") {
    return {
      gmailMessageId: message.id,
      ok: false,
      reason: "untracked_or_closed_thread",
    };
  }

  const existing = await prisma.emailMessage.findUnique({
    where: {
      gmailMessageId: message.id,
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return {
      gmailMessageId: message.id,
      ok: true,
      reason: "already_processed",
    };
  }

  await prisma.emailMessage.create({
    data: {
      body: message.body || null,
      cc: message.cc,
      direction: "INBOUND",
      emailThreadId: thread.id,
      from: message.from,
      gmailMessageId: message.id,
      payloadJson: {
        messageIdHeader: message.messageIdHeader,
        references: message.references,
        replyTo: message.replyTo,
        snippet: message.snippet,
        threadId: message.threadId,
      },
      receivedAt: message.internalDate ?? message.date,
      snippet: message.snippet,
      subject: message.subject,
      to: message.to,
    },
  });

  await prisma.emailThread.update({
    where: {
      id: thread.id,
    },
    data: {
      lastGmailMessageId: message.id,
    },
  });

  if (thread.taskId) {
    await recordAgentActionReceipt({
      action: "email_reply_received",
      agentOpenclawId: thread.agent.openclawAgentId,
      eventType: AgentTaskEventType.INBOUND_REPLY,
      payload: {
        from: message.from,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        snippet: message.snippet,
        subject: message.subject,
      },
      status: "success",
      summary: `Email reply received from ${message.from ?? "unknown sender"}.`,
      taskId: thread.taskId,
    });
  }

  const activeHumans = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      username: "asc",
    },
    select: {
      agent: {
        select: {
          displayName: true,
          openclawAgentId: true,
        },
      },
      username: true,
    },
  });
  const instructions = buildAgentRuntimeInstructions({
    agentDisplayName: thread.agent.displayName,
    audience: thread.requesterUserId === thread.agent.userId ? "direct_line" : "shared_spaces",
    availableAgents: activeHumans.flatMap((human) =>
      human.agent
        ? [
            {
              displayName: human.agent.displayName,
              openclawAgentId: human.agent.openclawAgentId,
              ownerUsername: human.username,
            },
          ]
        : [],
    ),
    availableHumanUsernames: activeHumans.map((human) => human.username),
    behaviorConfig: thread.agent.soulConfigJson,
    counterpartLabel: `${thread.requester.displayName} (@${thread.requester.username}) via an email follow-up event`,
    counterpartTimezone: thread.requester.timezone,
    currentHumanDisplayName: thread.requester.displayName,
    currentHumanUsername: thread.requester.username,
    ownerDisplayName: thread.agent.user.displayName,
    ownerTimezone: thread.agent.user.timezone,
    ownerUsername: thread.agent.user.username,
    personaSummary: thread.agent.personaSummary,
  });
  const actionReceiptContext = await buildRecentActionReceiptContext({
    agentOpenclawId: thread.agent.openclawAgentId,
    requesterUserId: thread.requesterUserId,
    roomId: thread.sourceRoomId,
  });
  const objective = `Follow up on email reply in thread "${thread.subject}".`;
  const turnContext = await createAgentTurnContext({
    agentOpenclawId: thread.agent.openclawAgentId,
    currentHumanUserId: null,
    objective,
    requesterUserId: thread.requesterUserId,
    sourceRoomId: thread.sourceRoomId,
    taskId: thread.taskId,
    triggerType: "email_reply",
  });
  const result = await runAgentTurn({
    agentId: thread.agent.openclawAgentId,
    conversationKey: `email-thread:${thread.id}`,
    instructions: [
      instructions,
      formatAgentTurnContextInstruction(turnContext.id),
      actionReceiptContext,
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join("\n\n"),
    message: summarizeEmailForAgent(message, thread.id),
    tools: CYWORLD_AGENT_TOOLS,
    onToolCall: (call) =>
      handleCyWorldAgentToolCall({
        call,
        currentHumanUserId: null,
        objective,
        requesterUserId: thread.requesterUserId,
        senderAgentOpenclawId: thread.agent.openclawAgentId,
        sourceRoomId: thread.sourceRoomId ?? undefined,
        taskId: thread.taskId,
        triggerType: "email_reply",
      }),
  });

  if (result.assistantText.trim()) {
    await deliverAgentReport({
      agentOpenclawId: thread.agent.openclawAgentId,
      message: result.assistantText,
      requesterUserId: thread.requesterUserId,
      requesterUsername: thread.requester.username,
      sourceRoomId: thread.sourceRoomId,
      taskId: thread.taskId,
    });
  }

  return {
    gmailMessageId: message.id,
    ok: true,
    threadId: thread.id,
  };
}

export async function pollTrackedEmailReplies() {
  let inbox;

  try {
    inbox = await listSharedGmailInboxMessages({
      maxResults: 50,
      query: "in:inbox newer_than:14d",
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      reason: "gmail_poll_failed",
    };
  }

  if (!inbox.ok) {
    return inbox;
  }

  const results = [];

  for (const message of inbox.messages) {
    results.push(await processEmailReply(message));
  }

  return {
    ok: true,
    processed: results.filter((result) => result.ok && result.reason !== "already_processed")
      .length,
    results,
  };
}
