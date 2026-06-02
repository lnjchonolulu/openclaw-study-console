import { type Prisma } from "@prisma/client";
import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { scheduleAgentDm, sendAgentDm } from "@/lib/internal-agent-actions";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

type TaskDeliveryKind = "send_dm" | "schedule_dm";
type AgentNextTaskAction =
  | {
      action: "report_to_requester";
      message: string;
    }
  | {
      action: "ask_followup";
      message: string;
    }
  | {
      action: "wait";
      reason?: string;
    }
  | {
      action: "complete_no_message";
      reason?: string;
    };

type WaitingTaskSnapshot = {
  latestOutboundMessage: {
    content: string;
    createdAt: Date;
    id: string;
  };
  task: {
    events: {
      createdAt: Date;
      summary: string;
      type: string;
    }[];
    id: string;
    objective: string;
    requester: {
      username: string;
    };
    status: string;
    targetUserId: string | null;
    title: string;
  };
};

type TaskResolution =
  | {
      kind: "matched";
      matchedOutboundMessageId: string;
      task: WaitingTaskSnapshot["task"];
    }
  | {
      acknowledgement: string;
      kind: "ambiguous";
    }
  | {
      kind: "none";
    };

export type CreateOutboundAgentTaskInput = {
  agentDisplayName: string;
  agentOpenclawId: string;
  behaviorConfig: unknown;
  delayMinutes?: number;
  explicitMessage?: string | null;
  kind: TaskDeliveryKind;
  ownerDisplayName: string;
  ownerTimezone?: string | null;
  ownerUsername: string;
  personaSummary?: string | null;
  requesterDisplayName: string;
  requesterTimezone?: string | null;
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

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

function parseAgentNextTaskAction(value: string): AgentNextTaskAction {
  const jsonObject = extractJsonObject(value);

  if (!jsonObject) {
    return {
      action: "wait",
      reason: "The agent did not return a structured next action.",
    };
  }

  try {
    const parsed = JSON.parse(jsonObject) as {
      action?: unknown;
      message?: unknown;
      reason?: unknown;
    };
    const action = typeof parsed.action === "string" ? parsed.action : "";
    const message = typeof parsed.message === "string" ? cleanComposedMessage(parsed.message) : "";
    const reason = typeof parsed.reason === "string" ? parsed.reason : undefined;

    if (action === "report_to_requester" && message) {
      return {
        action,
        message,
      };
    }

    if (action === "ask_followup" && message) {
      return {
        action,
        message,
      };
    }

    if (action === "complete_no_message") {
      return {
        action,
        reason,
      };
    }

    return {
      action: "wait",
      reason: reason ?? "The agent chose to wait or returned an incomplete action.",
    };
  } catch {
    return {
      action: "wait",
      reason: "The agent returned malformed JSON.",
    };
  }
}

function tokenizeForTaskMatch(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, " ")
      .split(/\s+/)
      .filter(
        (token) =>
          token.length >= 2 &&
          !new Set([
            "the",
            "and",
            "for",
            "that",
            "with",
            "this",
            "from",
            "have",
            "will",
            "your",
            "about",
            "next",
            "just",
            "they",
            "them",
            "their",
            "reply",
            "message",
            "okay",
            "ok",
            "sure",
            "yeah",
          ]).has(token),
      ),
  );
}

function hasScheduleSignal(value: string) {
  return /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|week|meeting|calendar|available|availability|time)\b/i.test(
    value,
  );
}

function scoreTaskCandidate(candidate: WaitingTaskSnapshot, replyMessage: string) {
  const candidateContext = [
    candidate.task.title,
    candidate.task.objective,
    candidate.latestOutboundMessage.content,
    ...candidate.task.events.slice(-4).map((event) => event.summary),
  ].join("\n");
  const replyTokens = tokenizeForTaskMatch(replyMessage);
  const candidateTokens = tokenizeForTaskMatch(candidateContext);
  let overlap = 0;

  replyTokens.forEach((token) => {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  });

  let score = overlap * 2;

  if (hasScheduleSignal(replyMessage) && hasScheduleSignal(candidateContext)) {
    score += 3;
  }

  return score;
}

function buildAmbiguousTaskReply(candidates: WaitingTaskSnapshot[]) {
  const lines = candidates.slice(0, 3).map((candidate, index) => {
    const snippet = cleanComposedMessage(candidate.latestOutboundMessage.content)
      .replace(/\s+/g, " ")
      .slice(0, 90);

    return `${index + 1}. ${snippet}${snippet.length >= 90 ? "..." : ""}`;
  });

  return `I have more than one open thread with you right now, so I do not want to attach your reply to the wrong task.\n\nPlease reply to the specific message you mean, or tell me which one you are answering:\n${lines.join("\n")}`;
}

function extractTaskChoice(value: string) {
  const jsonObject = extractJsonObject(value);

  if (!jsonObject) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonObject) as {
      reason?: unknown;
      taskId?: unknown;
    };

    return {
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      taskId: typeof parsed.taskId === "string" ? parsed.taskId : null,
    };
  } catch {
    return null;
  }
}

async function resolveInboundTaskReply({
  agentDisplayName,
  agentOpenclawId,
  behaviorConfig,
  inboundMessageCreatedAt,
  ownerDisplayName,
  ownerUsername,
  personaSummary,
  replyMessage,
  replyingDisplayName,
  replyingUserId,
  replyingUsername,
  roomId,
  selectedReplyToMessage,
}: {
  agentDisplayName: string;
  agentOpenclawId: string;
  behaviorConfig: unknown;
  inboundMessageCreatedAt: Date;
  ownerDisplayName: string;
  ownerUsername: string;
  personaSummary?: string | null;
  replyMessage: string;
  replyingDisplayName: string;
  replyingUserId: string;
  replyingUsername: string;
  roomId: string;
  selectedReplyToMessage:
    | {
        agentId: string | null;
        id: string;
        task:
          | {
              events: {
                createdAt: Date;
                summary: string;
                type: string;
              }[];
              id: string;
              objective: string;
              requester: {
                username: string;
              };
              status: string;
              targetUserId: string | null;
              title: string;
            }
          | null;
      }
    | null
    | undefined;
}): Promise<TaskResolution> {
  if (
    selectedReplyToMessage?.task &&
    selectedReplyToMessage.agentId === agentOpenclawId &&
    selectedReplyToMessage.task.status === "WAITING" &&
    selectedReplyToMessage.task.targetUserId === replyingUserId
  ) {
    return {
      kind: "matched",
      matchedOutboundMessageId: selectedReplyToMessage.id,
      task: selectedReplyToMessage.task,
    };
  }

  const outboundCandidates = await prisma.message.findMany({
    where: {
      roomId,
      role: "AGENT",
      agentId: agentOpenclawId,
      taskId: {
        not: null,
      },
      createdAt: {
        lt: inboundMessageCreatedAt,
      },
      task: {
        status: "WAITING",
        targetUserId: replyingUserId,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 12,
    include: {
      task: {
        include: {
          events: {
            orderBy: {
              createdAt: "asc",
            },
          },
          requester: true,
        },
      },
    },
  });

  const candidateMap = new Map<string, WaitingTaskSnapshot>();

  outboundCandidates.forEach((message) => {
    if (!message.taskId || !message.task || candidateMap.has(message.taskId)) {
      return;
    }

    candidateMap.set(message.taskId, {
      latestOutboundMessage: {
        content: message.content,
        createdAt: message.createdAt,
        id: message.id,
      },
      task: {
        events: message.task.events.map((event) => ({
          createdAt: event.createdAt,
          summary: event.summary,
          type: event.type,
        })),
        id: message.task.id,
        objective: message.task.objective,
        requester: {
          username: message.task.requester.username,
        },
        status: message.task.status,
        targetUserId: message.task.targetUserId,
        title: message.task.title,
      },
    });
  });

  const candidates = Array.from(candidateMap.values());

  if (candidates.length === 0) {
    return {
      kind: "none",
    };
  }

  if (candidates.length === 1) {
    return {
      kind: "matched",
      matchedOutboundMessageId: candidates[0].latestOutboundMessage.id,
      task: candidates[0].task,
    };
  }

  const scoredCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreTaskCandidate(candidate, replyMessage),
    }))
    .sort((left, right) => right.score - left.score);

  const best = scoredCandidates[0];
  const runnerUp = scoredCandidates[1];

  if (best && best.score >= 4 && best.score - (runnerUp?.score ?? 0) >= 2) {
    return {
      kind: "matched",
      matchedOutboundMessageId: best.candidate.latestOutboundMessage.id,
      task: best.candidate.task,
    };
  }

  const instructions = buildAgentRuntimeInstructions({
    agentDisplayName,
    audience: "shared_spaces",
    availableHumanUsernames: [ownerUsername, replyingUsername],
    behaviorConfig,
    counterpartLabel: `${replyingDisplayName} (@${replyingUsername}), who is replying in a Study Console DM`,
    counterpartTimezone: null,
    ownerDisplayName,
    ownerTimezone: null,
    ownerUsername,
    personaSummary,
  });

  const decision = await runAgentTurn({
    agentId: agentOpenclawId,
    conversationKey: `task-match:${roomId}:${replyingUserId}`,
    instructions: `${instructions}

You are matching a new human reply to one of several open Study Console tasks.
- Return JSON only.
- Choose a task only if the reply clearly belongs to it.
- If the reply is too ambiguous, return null taskId.

Return exactly one of:
{"taskId":"candidate-task-id","reason":"short explanation"}
{"taskId":null,"reason":"why the reply is ambiguous"}`,
    message: `Latest reply from ${replyingDisplayName} (@${replyingUsername}):
${replyMessage}

Open candidate tasks:
${candidates
  .map(
    (candidate, index) => `Candidate ${index + 1}
taskId: ${candidate.task.id}
title: ${candidate.task.title}
objective: ${candidate.task.objective}
latest outbound message:
${candidate.latestOutboundMessage.content}
recent task events:
${candidate.task.events
  .slice(-4)
  .map((event) => `- ${event.type}: ${event.summary}`)
  .join("\n") || "(none)"}`,
  )
  .join("\n\n")}`,
  });

  const taskChoice = extractTaskChoice(decision.assistantText);

  if (taskChoice?.taskId) {
    const matched = candidates.find((candidate) => candidate.task.id === taskChoice.taskId);

    if (matched) {
      return {
        kind: "matched",
        matchedOutboundMessageId: matched.latestOutboundMessage.id,
        task: matched.task,
      };
    }
  }

  return {
    acknowledgement: buildAmbiguousTaskReply(candidates),
    kind: "ambiguous",
  };
}

function shouldAskForMissingBody(input: CreateOutboundAgentTaskInput) {
  if (input.explicitMessage?.trim()) {
    return false;
  }

  const normalized = input.sourceMessage.toLowerCase();
  const hasFollowupBodyHint =
    /\b(tell|say|let them know|let her know|let him know|update|confirm|reply)\b/.test(
      normalized,
    ) ||
    /(전해|말해|알려|답장|확정|확인해줘)/.test(input.sourceMessage);
  const hasDelegatedQuestion =
    /\b(ask|get their opinion|get her opinion|get his opinion|find out|check with)\b/.test(
      normalized,
    ) || /(물어|의견|확인해|확인해줘|어떻게 생각)/.test(input.sourceMessage);

  if (hasFollowupBodyHint) {
    return false;
  }

  return !hasDelegatedQuestion;
}

function shouldWaitForReply(input: CreateOutboundAgentTaskInput) {
  return !input.explicitMessage?.trim() && !shouldAskForMissingBody(input);
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
    counterpartTimezone: input.requesterTimezone,
    ownerDisplayName: input.ownerDisplayName,
    ownerTimezone: input.ownerTimezone,
    ownerUsername: input.ownerUsername,
    personaSummary: input.personaSummary,
  });

  const result = await runAgentTurn({
    agentId: input.agentOpenclawId,
    conversationKey: `task:${taskId}:compose-outbound`,
    instructions: `${instructions}

You are composing a Study Console outbound DM.
- You are writing as ${input.agentDisplayName}, not as ${input.requesterDisplayName}.
- Return only the exact message body that should be delivered to @${input.targetUsername}.
- Do not impersonate the requester. Never write "${input.requesterDisplayName} here", "this is ${input.requesterDisplayName}", or similar unless the requester gave that exact quoted text.
- If context is needed, say that ${input.requesterDisplayName} asked you to check or ask something, while keeping ${input.agentDisplayName} as the speaker.
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
          taskId: task.id,
          toUsername: targetUser.username,
        })
      : await sendAgentDm({
          message: composed.message,
          senderAgentOpenclawId: input.agentOpenclawId,
          taskId: task.id,
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
      status: delivery.ok
        ? input.kind === "schedule_dm" || shouldWaitForReply(input)
          ? "WAITING"
          : "COMPLETED"
        : "FAILED",
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

export async function handleInboundTaskReply({
  agentDisplayName,
  agentOpenclawId,
  behaviorConfig,
  ownerDisplayName,
  ownerTimezone,
  ownerUsername,
  personaSummary,
  replyingDisplayName,
  replyingTimezone,
  roomId,
  replyingUserId,
  userMessageId,
  replyingUsername,
  replyMessage,
}: {
  agentDisplayName: string;
  agentOpenclawId: string;
  behaviorConfig: unknown;
  ownerDisplayName: string;
  ownerTimezone?: string | null;
  ownerUsername: string;
  personaSummary?: string | null;
  replyingDisplayName: string;
  replyingTimezone?: string | null;
  roomId: string;
  replyingUserId: string;
  userMessageId: string;
  replyingUsername: string;
  replyMessage: string;
}) {
  const inboundMessage = await prisma.message.findUnique({
    where: {
      id: userMessageId,
    },
    include: {
      replyToMessage: {
        include: {
          task: {
            include: {
              events: {
                orderBy: {
                  createdAt: "asc",
                },
              },
              requester: true,
            },
          },
        },
      },
    },
  });

  if (!inboundMessage) {
    return null;
  }

  const resolution = await resolveInboundTaskReply({
    agentDisplayName,
    agentOpenclawId,
    behaviorConfig,
    inboundMessageCreatedAt: inboundMessage.createdAt,
    ownerDisplayName,
    ownerUsername,
    personaSummary,
    replyMessage,
    replyingDisplayName,
    replyingUserId,
    replyingUsername,
    roomId,
    selectedReplyToMessage: inboundMessage.replyToMessage
      ? {
          agentId: inboundMessage.replyToMessage.agentId,
          id: inboundMessage.replyToMessage.id,
          task: inboundMessage.replyToMessage.task
            ? {
                events: inboundMessage.replyToMessage.task.events.map((event) => ({
                  createdAt: event.createdAt,
                  summary: event.summary,
                  type: event.type,
                })),
                id: inboundMessage.replyToMessage.task.id,
                objective: inboundMessage.replyToMessage.task.objective,
                requester: {
                  username: inboundMessage.replyToMessage.task.requester.username,
                },
                status: inboundMessage.replyToMessage.task.status,
                targetUserId: inboundMessage.replyToMessage.task.targetUserId,
                title: inboundMessage.replyToMessage.task.title,
              }
            : null,
        }
      : null,
  });

  if (resolution.kind === "none") {
    return null;
  }

  if (resolution.kind === "ambiguous") {
    return {
      acknowledgement: resolution.acknowledgement,
      nextAction: {
        action: "wait" as const,
        reason: "Ambiguous reply-to match",
      },
      taskId: null,
    };
  }

  const task = resolution.task;

  await prisma.message.update({
    where: {
      id: userMessageId,
    },
    data: {
      replyToMessageId: inboundMessage.replyToMessageId ?? resolution.matchedOutboundMessageId,
      taskId: task.id,
    },
  });

  await prisma.agentTaskEvent.create({
    data: {
      taskId: task.id,
      type: "INBOUND_REPLY",
      summary: `${replyingDisplayName} (@${replyingUsername}) replied: ${replyMessage}`,
      payload: {
        replyMessage,
        replyingUsername,
      } satisfies Prisma.InputJsonValue,
    },
  });

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
    agentDisplayName,
    audience: "shared_spaces",
    availableHumanUsernames: activeHumans.map((human) => human.username),
    behaviorConfig,
    counterpartLabel: `${replyingDisplayName} (@${replyingUsername}), who is replying to a Study Console task`,
    counterpartTimezone: replyingTimezone,
    ownerDisplayName,
    ownerTimezone,
    ownerUsername,
    personaSummary,
  });

  const eventLog = task.events
    .map((event) => `- ${event.type}: ${event.summary}`)
    .join("\n");

  const decision = await runAgentTurn({
    agentId: agentOpenclawId,
    conversationKey: `task:${task.id}:decide-next-action`,
    instructions: `${instructions}

You are deciding the next action in a Study Console task loop.
- A participant has replied to something you asked on behalf of the requester.
- Decide autonomously what should happen next.
- Do not mention OpenClaw, gateway pairing, sessions_send, cron, tools, or implementation details.
- The app backend will execute your selected Study Console action.
- Return only JSON. No markdown. No extra text.

Valid JSON shapes:
{"action":"report_to_requester","message":"exact DM to send to @${task.requester.username}"}
{"action":"ask_followup","message":"exact follow-up DM to send to @${replyingUsername}"}
{"action":"wait","reason":"why no action should be taken yet"}
{"action":"complete_no_message","reason":"why the task is complete without another message"}

Choose report_to_requester when the reply answers the request sufficiently.
Choose ask_followup when the reply is ambiguous or insufficient and a follow-up would help.
Choose wait only when the best next step is to wait for more context.
Choose complete_no_message only when no further message is useful.`,
    message: `Task objective:
${task.objective}

Prior task events:
${eventLog || "(none)"}

Latest reply from ${replyingDisplayName} (@${replyingUsername}):
${replyMessage}

Decide the next action.`,
  });

  const nextAction = parseAgentNextTaskAction(decision.assistantText);

  await prisma.agentTaskEvent.create({
    data: {
      taskId: task.id,
      type: "AGENT_DECISION",
      summary: `Chose next action: ${nextAction.action}.`,
      payload: {
        raw: decision.assistantText,
        nextAction,
      } satisfies Prisma.InputJsonValue,
    },
  });

  if (nextAction.action === "report_to_requester") {
    const delivery = await sendAgentDm({
      message: nextAction.message,
      senderAgentOpenclawId: agentOpenclawId,
      taskId: task.id,
      toUsername: task.requester.username,
    });

    await prisma.agentTaskEvent.create({
      data: {
        taskId: task.id,
        type: "OUTBOUND_MESSAGE",
        summary: delivery.ok
          ? `Reported task result to @${task.requester.username}.`
          : `Report-back delivery failed: ${delivery.reason}.`,
        payload: {
          delivery,
          message: nextAction.message,
        } satisfies Prisma.InputJsonValue,
      },
    });

    await prisma.agentTask.update({
      where: {
        id: task.id,
      },
      data: {
        resultSummary: nextAction.message,
        status: delivery.ok ? "COMPLETED" : "FAILED",
      },
    });

    return {
      acknowledgement: delivery.ok
        ? `Thanks. I'll let @${task.requester.username} know.`
        : `I got your reply, but I could not report it back: ${delivery.reason}.`,
      nextAction,
      taskId: task.id,
    };
  }

  if (nextAction.action === "ask_followup") {
    const delivery = await sendAgentDm({
      message: nextAction.message,
      replyToMessageId: userMessageId,
      senderAgentOpenclawId: agentOpenclawId,
      taskId: task.id,
      toUsername: replyingUsername,
    });

    await prisma.agentTaskEvent.create({
      data: {
        taskId: task.id,
        type: "OUTBOUND_MESSAGE",
        summary: delivery.ok
          ? `Asked follow-up to @${replyingUsername}.`
          : `Follow-up delivery failed: ${delivery.reason}.`,
        payload: {
          delivery,
          message: nextAction.message,
        } satisfies Prisma.InputJsonValue,
      },
    });

    await prisma.agentTask.update({
      where: {
        id: task.id,
      },
      data: {
        resultSummary: nextAction.message,
        status: delivery.ok ? "WAITING" : "FAILED",
      },
    });

    return {
      acknowledgement: delivery.ok
        ? "Thanks. I asked a follow-up."
        : `I got your reply, but I could not send the follow-up: ${delivery.reason}.`,
      nextAction,
      taskId: task.id,
    };
  }

  await prisma.agentTask.update({
    where: {
      id: task.id,
    },
    data: {
      resultSummary: nextAction.reason ?? null,
      status: nextAction.action === "complete_no_message" ? "COMPLETED" : "WAITING",
    },
  });

  return {
    acknowledgement:
      nextAction.action === "complete_no_message"
        ? "Thanks. That completes the task."
        : "Thanks. I'll keep that in mind for now.",
    nextAction,
    taskId: task.id,
  };
}
