import { type Prisma } from "@prisma/client";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { scheduleAgentDm, sendAgentDm } from "@/lib/internal-agent-actions";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

type TaskDeliveryKind = "send_dm" | "schedule_dm";

export type CreateOutboundAgentTaskInput = {
  agentDisplayName: string;
  agentOpenclawId: string;
  behaviorConfig: unknown;
  delayMinutes?: number;
  explicitMessage?: string | null;
  kind: TaskDeliveryKind;
  ownerDisplayName: string;
  ownerUsername: string;
  personaSummary?: string | null;
  requesterDisplayName: string;
  requesterUserId: string;
  requesterUsername: string;
  sourceMessage: string;
  sourceRoomId: string;
  targetUsername: string;
};

function compactWhitespace(value: string) {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanComposedMessage(value: string) {
  return compactWhitespace(value)
    .replace(/^```(?:text|md|markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^["“]|["”]$/g, "")
    .trim();
}

function shouldAskForMissingBody(input: CreateOutboundAgentTaskInput) {
  if (input.explicitMessage?.trim()) {
    return false;
  }

  const normalized = input.sourceMessage.toLowerCase();
  const hasDelegatedQuestion =
    /\b(ask|get their opinion|get her opinion|get his opinion|find out|check with)\b/.test(
      normalized,
    ) || /(물어|의견|확인해|확인해줘|어떻게 생각)/.test(input.sourceMessage);

  return !hasDelegatedQuestion;
}

async function composeOutboundMessage({
  input,
  taskId,
}: {
  input: CreateOutboundAgentTaskInput;
  taskId: string;
}) {
  if (input.explicitMessage?.trim()) {
    return {
      message: input.explicitMessage.trim(),
      mode: "explicit",
    };
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
    agentDisplayName: input.agentDisplayName,
    audience:
      input.ownerUsername === input.requesterUsername ? "direct_line" : "shared_spaces",
    availableHumanUsernames: activeHumans.map((human) => human.username),
    behaviorConfig: input.behaviorConfig,
    counterpartLabel:
      input.ownerUsername === input.requesterUsername
        ? `${input.requesterDisplayName} (@${input.requesterUsername})`
        : `${input.requesterDisplayName} (@${input.requesterUsername}), who is not the owner of this agent`,
    ownerDisplayName: input.ownerDisplayName,
    ownerUsername: input.ownerUsername,
    personaSummary: input.personaSummary,
  });

  const result = await runAgentTurn({
    agentId: input.agentOpenclawId,
    conversationKey: `task:${taskId}:compose-outbound`,
    instructions: `${instructions}

You are composing a Study Console outbound DM.
- Return only the exact message body that should be delivered to @${input.targetUsername}.
- Do not mention OpenClaw, gateway pairing, sessions_send, cron, tools, or implementation details.
- Do not wrap the message in quotes or markdown fences.
- Make the message natural, concise, and appropriate for the relationship.
- Preserve the requester's intent, but do not mechanically copy their wording unless they gave exact quoted text.`,
    message: `Requester: ${input.requesterDisplayName} (@${input.requesterUsername})
Recipient: @${input.targetUsername}
Original request:
${input.sourceMessage}

Write the DM that ${input.agentDisplayName} should send to @${input.targetUsername}.`,
  });

  return {
    message: cleanComposedMessage(result.assistantText),
    mode: "composed",
  };
}

export async function createAndRunOutboundAgentTask(input: CreateOutboundAgentTaskInput) {
  if (shouldAskForMissingBody(input)) {
    return {
      ok: false as const,
      needsClarification: true as const,
      question:
        input.kind === "schedule_dm"
          ? `What message should I send to @${input.targetUsername} later?`
          : `What message should I send to @${input.targetUsername}?`,
    };
  }

  const targetUser = await prisma.user.findUnique({
    where: {
      username: input.targetUsername.toLowerCase(),
    },
    select: {
      id: true,
      username: true,
    },
  });

  if (!targetUser) {
    return {
      ok: false as const,
      needsClarification: false as const,
      reason: "recipient_not_found",
    };
  }

  const task = await prisma.agentTask.create({
    data: {
      agentId: input.agentOpenclawId,
      kind: input.kind,
      objective: input.sourceMessage,
      requesterUserId: input.requesterUserId,
      sourceRoomId: input.sourceRoomId,
      status: "OPEN",
      targetUserId: targetUser.id,
      title: `${input.kind === "schedule_dm" ? "Schedule" : "Send"} DM to @${targetUser.username}`,
      events: {
        create: {
          type: "USER_REQUEST",
          summary: input.sourceMessage,
          payload: {
            delayMinutes: input.delayMinutes ?? null,
            explicitMessage: input.explicitMessage ?? null,
            targetUsername: targetUser.username,
          } satisfies Prisma.InputJsonValue,
        },
      },
    },
  });

  const composed = await composeOutboundMessage({
    input: {
      ...input,
      targetUsername: targetUser.username,
    },
    taskId: task.id,
  });

  await prisma.agentTaskEvent.create({
    data: {
      taskId: task.id,
      type: "AGENT_DECISION",
      summary: `Prepared outbound DM to @${targetUser.username}.`,
      payload: {
        compositionMode: composed.mode,
        message: composed.message,
      } satisfies Prisma.InputJsonValue,
    },
  });

  const delivery =
    input.kind === "schedule_dm"
      ? await scheduleAgentDm({
          deliverAt: new Date(Date.now() + (input.delayMinutes ?? 1) * 60 * 1000),
          message: composed.message,
          senderAgentOpenclawId: input.agentOpenclawId,
          toUsername: targetUser.username,
        })
      : await sendAgentDm({
          message: composed.message,
          senderAgentOpenclawId: input.agentOpenclawId,
          toUsername: targetUser.username,
        });

  await prisma.agentTaskEvent.create({
    data: {
      taskId: task.id,
      type: input.kind === "schedule_dm" ? "SCHEDULED_MESSAGE" : "OUTBOUND_MESSAGE",
      summary: delivery.ok
        ? input.kind === "schedule_dm"
          ? `Scheduled outbound DM to @${targetUser.username}.`
          : `Delivered outbound DM to @${targetUser.username}.`
        : `Delivery failed: ${delivery.reason}.`,
      payload: {
        delivery,
        message: composed.message,
      } satisfies Prisma.InputJsonValue,
    },
  });

  await prisma.agentTask.update({
    where: {
      id: task.id,
    },
    data: {
      resultSummary: delivery.ok ? composed.message : delivery.reason,
      status: delivery.ok ? (input.kind === "schedule_dm" ? "WAITING" : "COMPLETED") : "FAILED",
    },
  });

  return {
    ok: delivery.ok,
    delivery,
    message: composed.message,
    taskId: task.id,
    toUsername: targetUser.username,
  };
}
