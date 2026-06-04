import { AgentTaskEventType } from "@prisma/client";

import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { recordAgentActionReceipt } from "@/lib/action-receipts";
import {
  CYWORLD_AGENT_TOOLS,
  handleCyWorldAgentToolCall,
} from "@/lib/cyworld-agent-tools";
import {
  listSharedGmailInboxMessages,
  type GmailMessageView,
} from "@/lib/google-integration";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

function summarizeEmailForAgent(message: GmailMessageView) {
  return [
    "A reply arrived in a shared CyWorld Gmail thread that belongs to you.",
    "",
    `From: ${message.from ?? "(unknown)"}`,
    `To: ${message.to ?? "(unknown)"}`,
    message.cc ? `Cc: ${message.cc}` : null,
    `Subject: ${message.subject ?? "(no subject)"}`,
    "",
    "Reply body:",
    message.body || message.snippet || "(empty)",
    "",
    "Decide the appropriate follow-up. You may report to your human, send a CyWorld DM, schedule a CyWorld DM, create/check CyWorld Calendar items, or send another email when appropriate. Do not claim you can see the full shared inbox; CyWorld has routed only this thread reply to you.",
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
      username: true,
    },
  });
  const instructions = buildAgentRuntimeInstructions({
    agentDisplayName: thread.agent.displayName,
    audience: "direct_line",
    availableHumanUsernames: activeHumans.map((human) => human.username),
    behaviorConfig: thread.agent.soulConfigJson,
    counterpartLabel: `${thread.requester.displayName} (@${thread.requester.username}) via an email follow-up event`,
    counterpartTimezone: thread.requester.timezone,
    ownerDisplayName: thread.agent.user.displayName,
    ownerTimezone: thread.agent.user.timezone,
    ownerUsername: thread.agent.user.username,
    personaSummary: thread.agent.personaSummary,
  });
  const result = await runAgentTurn({
    agentId: thread.agent.openclawAgentId,
    conversationKey: `email-thread:${thread.id}`,
    instructions,
    message: summarizeEmailForAgent(message),
    tools: CYWORLD_AGENT_TOOLS,
    onToolCall: (call) =>
      handleCyWorldAgentToolCall({
        call,
        objective: `Follow up on email reply in thread "${thread.subject}".`,
        requesterUserId: thread.requesterUserId,
        senderAgentOpenclawId: thread.agent.openclawAgentId,
        sourceRoomId: thread.sourceRoomId ?? undefined,
        taskId: thread.taskId,
      }),
  });

  if (thread.sourceRoomId && result.assistantText.trim()) {
    await prisma.message.create({
      data: {
        agentId: thread.agent.openclawAgentId,
        content: result.assistantText,
        role: "AGENT",
        roomId: thread.sourceRoomId,
        taskId: thread.taskId,
      },
    });

    await prisma.room.update({
      where: {
        id: thread.sourceRoomId,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    if (thread.taskId) {
      await recordAgentActionReceipt({
        action: "email_followup_report",
        agentOpenclawId: thread.agent.openclawAgentId,
        eventType: AgentTaskEventType.OUTBOUND_MESSAGE,
        payload: {
          message: result.assistantText,
          sourceRoomId: thread.sourceRoomId,
        },
        status: "success",
        summary: "Reported shared Gmail reply follow-up into the source CyWorld room.",
        taskId: thread.taskId,
      });
    }
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
