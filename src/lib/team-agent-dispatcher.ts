import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { buildRecentActionReceiptContext } from "@/lib/action-receipts";
import {
  CYWORLD_AGENT_TOOLS,
  handleCyWorldAgentToolCall,
} from "@/lib/cyworld-agent-tools";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

type ArbiterStrictness = "lenient" | "normal" | "strict";
type CandidateStrength = "explicit" | "relevant" | "chain" | "ambient";

type DispatchSettings = {
  arbiterStrictness: ArbiterStrictness;
  chainAgentCooldownTurns: number;
  maxChainTurns: number;
  maxContinuationCandidates: number;
  maxHumanFanout: number;
};

type TeamAgentProposal =
  | {
      action: "speak";
      contributionType: string;
      message: string;
      newValue: string;
      openItem?: string;
    }
  | {
      action: "wait";
      reason?: string;
    };

type ArbiterDecision = {
  reason?: string;
  updatedOpenItems: string[];
  verdict: "accept" | "reject";
};

type DispatchCandidate = {
  roomAgent: {
    agent: {
      displayName: string;
      id: string;
      openclawAgentId: string;
      personaSummary?: string | null;
      soulConfigJson?: unknown;
      user: {
        displayName: string;
        id: string;
        timezone?: string | null;
        username: string;
      };
    };
    lastInvokedAt?: Date | null;
    lastSpokeAt?: Date | null;
    mutedUntil?: Date | null;
    roleNote?: string | null;
  };
  reason: string;
  strength: CandidateStrength;
};

type DispatchRoom = {
  agents: DispatchCandidate["roomAgent"][];
  id: string;
  members: Array<{
    user: {
      displayName: string;
      timezone?: string | null;
      username: string;
    };
  }>;
  name: string;
  purpose?: string | null;
  type: string;
};

type DispatchMessage = {
  agent?: {
    displayName: string;
    openclawAgentId: string;
  } | null;
  agentId?: string | null;
  content: string;
  createdAt: Date;
  id: string;
  role: string;
  user?: {
    displayName: string;
    timezone?: string | null;
    username: string;
  } | null;
  userId?: string | null;
};

const SETTINGS_KEY = "team_agent_dispatch";

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

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias: string) {
  return escapeRegExp(alias.trim().replace(/^@/, "").toLowerCase()).replace(/\s+/g, "\\s+");
}

function textMentionsAnyAlias(text: string, aliases: string[]) {
  const normalized = normalizeText(text);

  return aliases.some((alias) => {
    const pattern = aliasPattern(alias);

    if (!pattern) {
      return false;
    }

    return new RegExp(`(?:^|[^a-z0-9_-])@?${pattern}(?=$|[^a-z0-9_-])`, "i").test(
      normalized,
    );
  });
}

function aliasesForAgent(agent: {
  displayName: string;
  openclawAgentId: string;
  user: {
    displayName: string;
    username: string;
  };
}) {
  return [
    agent.displayName,
    agent.openclawAgentId,
    `${agent.user.username} agent`,
    `${agent.user.username}'s agent`,
    `${agent.user.displayName} agent`,
    `${agent.user.displayName}'s agent`,
    `${agent.user.username}-agent`,
  ].filter(Boolean);
}

function aliasesForOwner(agent: {
  user: {
    displayName: string;
    username: string;
  };
}) {
  return [
    agent.user.username,
    agent.user.displayName,
    agent.user.displayName.split(/\s+/)[0] ?? "",
  ].filter(Boolean);
}

function isAgentMuted(candidate: {
  mutedUntil?: Date | null;
}) {
  return candidate.mutedUntil ? candidate.mutedUntil.getTime() > Date.now() : false;
}

function minutesSince(value?: Date | null) {
  if (!value) {
    return Infinity;
  }

  return (Date.now() - value.getTime()) / 1000 / 60;
}

function safeNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function safeStrictness(value: unknown): ArbiterStrictness {
  return value === "lenient" || value === "strict" || value === "normal" ? value : "normal";
}

async function getDispatchSettings(): Promise<DispatchSettings> {
  const setting = await prisma.appSetting.findUnique({
    where: {
      key: SETTINGS_KEY,
    },
  });
  const value =
    setting?.valueJson && typeof setting.valueJson === "object" && !Array.isArray(setting.valueJson)
      ? (setting.valueJson as Record<string, unknown>)
      : {};

  return {
    arbiterStrictness: safeStrictness(value.arbiterStrictness),
    chainAgentCooldownTurns: safeNumber(value.chainAgentCooldownTurns, 1, 0, 8),
    maxChainTurns: safeNumber(value.maxChainTurns, 8, 1, 24),
    maxContinuationCandidates: safeNumber(value.maxContinuationCandidates, 4, 1, 12),
    maxHumanFanout: safeNumber(value.maxHumanFanout, 4, 1, 12),
  };
}

function parseTeamAgentProposal(value: string): TeamAgentProposal {
  const jsonObject = extractJsonObject(value);

  if (!jsonObject) {
    return {
      action: "wait",
      reason: "No structured decision returned.",
    };
  }

  try {
    const parsed = JSON.parse(jsonObject) as {
      action?: unknown;
      contributionType?: unknown;
      message?: unknown;
      newValue?: unknown;
      openItem?: unknown;
      reason?: unknown;
    };
    const action = typeof parsed.action === "string" ? parsed.action : "";
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    const contributionType =
      typeof parsed.contributionType === "string" ? parsed.contributionType.trim() : "";
    const newValue = typeof parsed.newValue === "string" ? parsed.newValue.trim() : "";

    if (action === "speak" && message && contributionType && newValue) {
      return {
        action,
        contributionType,
        message,
        newValue,
        openItem: typeof parsed.openItem === "string" ? parsed.openItem.trim() : undefined,
      };
    }

    return {
      action: "wait",
      reason: typeof parsed.reason === "string" ? parsed.reason : "No verified contribution.",
    };
  } catch {
    return {
      action: "wait",
      reason: "Malformed decision JSON.",
    };
  }
}

function parseArbiterDecision(value: string): ArbiterDecision {
  const jsonObject = extractJsonObject(value);

  if (!jsonObject) {
    return {
      reason: "No structured arbiter decision returned.",
      updatedOpenItems: [],
      verdict: "reject",
    };
  }

  try {
    const parsed = JSON.parse(jsonObject) as {
      reason?: unknown;
      updatedOpenItems?: unknown;
      verdict?: unknown;
    };

    return {
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      updatedOpenItems: Array.isArray(parsed.updatedOpenItems)
        ? parsed.updatedOpenItems.filter((item): item is string => typeof item === "string")
        : [],
      verdict: parsed.verdict === "accept" ? "accept" : "reject",
    };
  } catch {
    return {
      reason: "Malformed arbiter decision JSON.",
      updatedOpenItems: [],
      verdict: "reject",
    };
  }
}

function formatRecentMessages(messages: DispatchMessage[]) {
  return messages
    .map((message) => {
      const author = message.user
        ? `${message.user.displayName} (@${message.user.username})`
        : (message.agent?.displayName ?? "Agent");

      return `[${message.createdAt.toISOString()}] ${author}: ${message.content}`;
    })
    .join("\n");
}

function formatRoomMembers(room: {
  agents: Array<{
    agent: {
      displayName: string;
      openclawAgentId: string;
      user: {
        username: string;
      };
    };
  }>;
  members: Array<{
    user: {
      displayName: string;
      username: string;
    };
  }>;
}) {
  return [
    ...room.members.map((member) => `- Human: ${member.user.displayName} (@${member.user.username})`),
    ...room.agents.map(
      (member) =>
        `- Agent: ${member.agent.displayName} (${member.agent.user.username}'s agent, openclaw:${member.agent.openclawAgentId})`,
    ),
  ].join("\n");
}

function formatOpenItems(value: unknown) {
  if (!Array.isArray(value)) {
    return "(none yet)";
  }

  const items = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );

  return items.length ? items.map((item) => `- ${item}`).join("\n") : "(none yet)";
}

function tokenize(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9가-힣\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function jaccardSimilarity(left: string, right: string) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function duplicateThreshold(strictness: ArbiterStrictness) {
  if (strictness === "strict") {
    return 0.6;
  }

  if (strictness === "lenient") {
    return 0.82;
  }

  return 0.72;
}

function localNoveltyCheck({
  proposal,
  recentMessages,
  strictness,
}: {
  proposal: Extract<TeamAgentProposal, { action: "speak" }>;
  recentMessages: DispatchMessage[];
  strictness: ArbiterStrictness;
}) {
  const threshold = duplicateThreshold(strictness);
  const recentAgentMessages = recentMessages.filter((message) => message.agentId);

  for (const message of recentAgentMessages.slice(-8)) {
    if (jaccardSimilarity(proposal.message, message.content) >= threshold) {
      return {
        ok: false,
        reason: "The proposed message is too similar to a recent agent message.",
      };
    }
  }

  if (strictness === "strict" && proposal.newValue.length < 12) {
    return {
      ok: false,
      reason: "Strict mode requires a concrete new_value statement.",
    };
  }

  return {
    ok: true,
    reason: null,
  };
}

async function loadDispatchRoom(roomId: string): Promise<DispatchRoom | null> {
  return prisma.room.findUnique({
    where: {
      id: roomId,
    },
    include: {
      agents: {
        where: {
          canRespond: true,
        },
        include: {
          agent: {
            include: {
              user: true,
            },
          },
        },
        orderBy: {
          joinedAt: "asc",
        },
      },
      members: {
        include: {
          user: true,
        },
      },
    },
  });
}

async function loadRecentMessages(roomId: string, take = 24): Promise<DispatchMessage[]> {
  const messages = await prisma.message.findMany({
    where: {
      roomId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take,
    include: {
      agent: true,
      user: true,
    },
  });

  return [...messages].reverse();
}

async function interruptActiveChains(roomId: string, reason: string) {
  await prisma.teamAgentChain.updateMany({
    where: {
      roomId,
      status: "ACTIVE",
    },
    data: {
      status: "INTERRUPTED",
      stopReason: reason,
    },
  });
}

async function createHumanRootChain(roomId: string, messageId: string) {
  await interruptActiveChains(roomId, "Human message preempted the previous chain.");

  return prisma.teamAgentChain.create({
    data: {
      lastMessageId: messageId,
      roomId,
      rootMessageId: messageId,
      status: "ACTIVE",
    },
  });
}

function candidateWeight(strength: CandidateStrength) {
  return {
    explicit: 0,
    relevant: 1,
    chain: 2,
    ambient: 3,
  }[strength];
}

async function selectDispatchCandidates({
  chainId,
  mode,
  room,
  settings,
  triggeringMessage,
}: {
  chainId?: string;
  mode: "human" | "continuation";
  room: DispatchRoom;
  settings: DispatchSettings;
  triggeringMessage: DispatchMessage;
}) {
  const content = triggeringMessage.content;
  const candidates: DispatchCandidate[] = [];
  const chainTurns = chainId
    ? await prisma.teamAgentChainTurn.findMany({
        where: {
          chainId,
          decision: "speak",
        },
        orderBy: {
          createdAt: "desc",
        },
        take: Math.max(8, settings.chainAgentCooldownTurns + 2),
      })
    : [];
  const chainActiveAgentIds = new Set(chainTurns.map((turn) => turn.agentId));
  const chainCooldownAgentIds = new Set(
    chainTurns.slice(0, settings.chainAgentCooldownTurns).map((turn) => turn.agentId),
  );

  for (const roomAgent of room.agents) {
    if (isAgentMuted(roomAgent)) {
      continue;
    }

    const agentMentioned = textMentionsAnyAlias(content, aliasesForAgent(roomAgent.agent));
    const ownerMentioned = textMentionsAnyAlias(content, aliasesForOwner(roomAgent.agent));

    if (mode === "continuation" && chainCooldownAgentIds.has(roomAgent.agent.openclawAgentId)) {
      continue;
    }

    if (agentMentioned) {
      candidates.push({
        roomAgent,
        reason: "The latest message explicitly mentions this agent.",
        strength: "explicit",
      });
      continue;
    }

    if (ownerMentioned) {
      candidates.push({
        roomAgent,
        reason:
          "The latest message mentions this agent's owner; the agent may help from that owner's perspective without impersonating the owner.",
        strength: "relevant",
      });
      continue;
    }

    if (mode === "continuation" && chainActiveAgentIds.has(roomAgent.agent.openclawAgentId)) {
      candidates.push({
        roomAgent,
        reason:
          "This agent has already been active in this chain; continue only if it can add new value.",
        strength: "chain",
      });
      continue;
    }

    const recentlyInvoked = minutesSince(roomAgent.lastInvokedAt) < 2;

    if (!recentlyInvoked) {
      candidates.push({
        roomAgent,
        reason:
          mode === "continuation"
            ? "This agent is a channel participant; speak only if it can resolve an open item or add clearly new information."
            : "This agent is a channel participant; speak only if the contribution is clearly useful.",
        strength: "ambient",
      });
    }
  }

  return candidates.sort((left, right) => {
    const weightDelta = candidateWeight(left.strength) - candidateWeight(right.strength);

    if (weightDelta !== 0) {
      return weightDelta;
    }

    return (
      minutesSince(right.roomAgent.lastSpokeAt) - minutesSince(left.roomAgent.lastSpokeAt)
    );
  });
}

async function askAgentForTeamProposal({
  candidate,
  chain,
  latestMessage,
  mode,
  recentLog,
  room,
  triggeringUser,
}: {
  candidate: DispatchCandidate;
  chain: {
    id: string;
    openItemsJson?: unknown;
    turnCount: number;
  };
  latestMessage: DispatchMessage;
  mode: "human" | "continuation";
  recentLog: string;
  room: DispatchRoom;
  triggeringUser?: DispatchMessage["user"];
}) {
  const roomAgent = candidate.roomAgent;
  const agent = roomAgent.agent;
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
    agentDisplayName: agent.displayName,
    audience: "shared_spaces",
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
    behaviorConfig: agent.soulConfigJson,
    counterpartLabel: triggeringUser
      ? `Team channel "${room.name}" with ${triggeringUser.displayName} (@${triggeringUser.username}) speaking most recently`
      : `Team channel "${room.name}" after another agent spoke`,
    counterpartTimezone: triggeringUser?.timezone ?? agent.user.timezone,
    currentHumanDisplayName: triggeringUser?.displayName ?? null,
    currentHumanUsername: triggeringUser?.username ?? null,
    ownerDisplayName: agent.user.displayName,
    ownerTimezone: agent.user.timezone,
    ownerUsername: agent.user.username,
    personaSummary: agent.personaSummary,
  });
  const actionReceiptContext = await buildRecentActionReceiptContext({
    agentOpenclawId: agent.openclawAgentId,
    roomId: room.id,
  });
  const chainRecord = await prisma.teamAgentChain.findUnique({
    where: {
      id: chain.id,
    },
    select: {
      rootMessageId: true,
    },
  });
  const rootMessage = chainRecord
    ? await prisma.message.findUnique({
        where: {
          id: chainRecord.rootMessageId,
        },
        select: {
          userId: true,
        },
      })
    : null;
  const initiatedByUserId =
    latestMessage.userId ?? rootMessage?.userId ?? agent.user.id;

  const result = await runAgentTurn({
    agentId: agent.openclawAgentId,
    conversationKey: `team:${room.id}:agent:${agent.openclawAgentId}`,
    instructions: `${[instructions, actionReceiptContext]
      .filter((part): part is string => Boolean(part?.trim()))
      .join("\n\n")}

You are participating in a CyWorld Team Chat channel.
- Channel name: ${room.name}
- Channel purpose: ${room.purpose?.trim() || "No explicit purpose has been set yet."}
- Why CyWorld is asking you to evaluate this turn: ${candidate.reason}
- Dispatch mode: ${mode === "continuation" ? "agent-to-agent continuation" : "human-triggered team turn"}
- Your room role note: ${roomAgent.roleNote?.trim() || "No special room-specific role note."}
- Current chain turn count: ${chain.turnCount}
- Current open items:
${formatOpenItems(chain.openItemsJson)}

Decide whether this agent should speak now or stay quiet.
Speak only when your contribution moves the conversation forward with new information, a resolved open item, a surfaced conflict, a concrete action, or a decision.
Do not speak for agreement, restatement, social filler, or to ask a new question that is not needed to advance the current task.
If the latest speaker was another agent, respond only if this agent has a specific new contribution.
If the message is about your owner, help the collaboration from your owner's perspective, but do not impersonate your owner.
If you need to DM, email, schedule, create calendar events, or use a CyWorld tool, use the provided CyWorld tool, then decide whether a channel message is still useful.
Do not mention OpenClaw, gateway pairing, sessions_send, cron, or implementation details.
Return JSON only.

Valid JSON:
{"action":"speak","message":"exact team-channel message","contributionType":"answer|question|conflict|action|decision|handoff","newValue":"what this adds that was not already said","openItem":"remaining issue, if any"}
{"action":"wait","reason":"short reason"}`,
    message: `Channel: ${room.name}

Participants:
${formatRoomMembers(room)}

Recent conversation:
${recentLog || "(no previous messages)"}

Latest ${latestMessage.user ? "human" : "agent"} message:
${latestMessage.content}

Should ${agent.displayName} speak now?`,
    tools: CYWORLD_AGENT_TOOLS,
    onToolCall: (call) =>
      handleCyWorldAgentToolCall({
        call,
        currentHumanUserId: latestMessage.userId,
        objective: latestMessage.content,
        requesterUserId: initiatedByUserId,
        senderAgentOpenclawId: agent.openclawAgentId,
        sourceRoomId: room.id,
        triggerType: latestMessage.userId ? "team_human_message" : "team_agent_message",
      }),
  });

  return parseTeamAgentProposal(result.assistantText);
}

async function validateProposalWithArbiter({
  arbiterAgentId,
  candidate,
  latestMessage,
  proposal,
  recentLog,
  room,
  settings,
}: {
  arbiterAgentId: string;
  candidate: DispatchCandidate;
  latestMessage: DispatchMessage;
  proposal: Extract<TeamAgentProposal, { action: "speak" }>;
  recentLog: string;
  room: DispatchRoom;
  settings: DispatchSettings;
}): Promise<ArbiterDecision> {
  const localCheck = localNoveltyCheck({
    proposal,
    recentMessages: await loadRecentMessages(room.id, 20),
    strictness: settings.arbiterStrictness,
  });

  if (!localCheck.ok) {
    return {
      reason: localCheck.reason ?? "Local novelty check rejected the proposal.",
      updatedOpenItems: [],
      verdict: "reject",
    };
  }

  const result = await runAgentTurn({
    agentId: arbiterAgentId,
    conversationKey: `team:${room.id}:arbiter:${arbiterAgentId}`,
    instructions: `You are the CyWorld team-chat arbiter.
This is an app-mediated validation call, not a DM, not a human conversation, and not a request to act as the arbiter agent's owner.
There is no single current human in this turn. Use only the room, chain, latest message, candidate agent, and proposed contribution shown below.
Your job is to verify whether a proposed agent message actually advances the current team-chat chain.
Strictness setting: ${settings.arbiterStrictness}.

Accept only if the proposal contributes real new value compared with the recent conversation:
- new information
- answer to an unresolved question
- surfaced conflict
- concrete action taken
- decision or convergence
- necessary handoff

Reject if it is agreement, repetition, restatement, vague encouragement, or an unnecessary new question.
Do not trust the speaker's claimed new_value by itself. Compare it against the recent conversation.
Return JSON only.

Valid JSON:
{"verdict":"accept","reason":"why this moves the thread forward","updatedOpenItems":["remaining open item"]}
{"verdict":"reject","reason":"why this does not add verified value","updatedOpenItems":["remaining open item"]}`,
    message: `Room: ${room.name}
Latest triggering message:
${latestMessage.content}

Recent conversation:
${recentLog || "(no previous messages)"}

Candidate agent: ${candidate.roomAgent.agent.displayName}
Proposed contribution_type: ${proposal.contributionType}
Claimed new_value: ${proposal.newValue}
Claimed open_item: ${proposal.openItem || "(none)"}
Proposed message:
${proposal.message}

Should this message be accepted?`,
  });

  return parseArbiterDecision(result.assistantText);
}

async function recordTurn({
  arbiterVerdict,
  chainId,
  decision,
  messageId,
  proposal,
  reason,
  roomAgent,
}: {
  arbiterVerdict?: string;
  chainId: string;
  decision: string;
  messageId?: string;
  proposal?: TeamAgentProposal;
  reason?: string;
  roomAgent: DispatchCandidate["roomAgent"];
}) {
  await prisma.teamAgentChainTurn.create({
    data: {
      agentId: roomAgent.agent.openclawAgentId,
      arbiterVerdict,
      chainId,
      contributionType:
        proposal?.action === "speak" ? proposal.contributionType : undefined,
      decision,
      messageId,
      newValue: proposal?.action === "speak" ? proposal.newValue : undefined,
      openItem: proposal?.action === "speak" ? proposal.openItem : undefined,
      reason,
    },
  });
}

async function createAgentMessage({
  chainId,
  latestMessage,
  proposal,
  roomAgent,
  roomId,
}: {
  chainId: string;
  latestMessage: DispatchMessage;
  proposal: Extract<TeamAgentProposal, { action: "speak" }>;
  roomAgent: DispatchCandidate["roomAgent"];
  roomId: string;
}) {
  const agent = roomAgent.agent;
  const created = await prisma.message.create({
    data: {
      agentId: agent.openclawAgentId,
      content: proposal.message,
      replyToMessageId: latestMessage.id,
      role: "AGENT",
      roomId,
    },
    include: {
      agent: true,
      replyToMessage: {
        include: {
          agent: true,
          user: true,
        },
      },
    },
  });

  await prisma.roomAgent.update({
    where: {
      roomId_agentId: {
        agentId: roomAgent.agent.id,
        roomId,
      },
    },
    data: {
      lastInvokedAt: new Date(),
      lastSeenMessageId: latestMessage.id,
      lastSpokeAt: created.createdAt,
    },
  }).catch(() => null);

  await prisma.teamAgentChain.update({
    where: {
      id: chainId,
    },
    data: {
      lastMessageId: created.id,
      lastSpeakerAgentId: agent.openclawAgentId,
      turnCount: {
        increment: 1,
      },
    },
  });

  return {
    author: created.agent?.displayName ?? agent.displayName,
    content: created.content,
    createdAt: created.createdAt.toISOString(),
    id: created.id,
    replyTo: created.replyToMessage
      ? {
          author:
            created.replyToMessage.user?.displayName ??
            created.replyToMessage.agent?.displayName ??
            "Unknown",
          content: created.replyToMessage.content,
          id: created.replyToMessage.id,
          userId:
            created.replyToMessage.userId ??
            `agent:${created.replyToMessage.agentId ?? "unknown"}`,
        }
      : null,
    senderKey: `agent:${agent.openclawAgentId}`,
    userId: `agent:${agent.openclawAgentId}`,
  };
}

async function runCandidate({
  candidate,
  chain,
  latestMessage,
  mode,
  recentLog,
  room,
  settings,
  triggeringUser,
}: {
  candidate: DispatchCandidate;
  chain: {
    id: string;
    openItemsJson?: unknown;
    turnCount: number;
  };
  latestMessage: DispatchMessage;
  mode: "human" | "continuation";
  recentLog: string;
  room: DispatchRoom;
  settings: DispatchSettings;
  triggeringUser?: DispatchMessage["user"];
}) {
  const proposal = await askAgentForTeamProposal({
    candidate,
    chain,
    latestMessage,
    mode,
    recentLog,
    room,
    triggeringUser,
  });

  await prisma.roomAgent.update({
    where: {
      roomId_agentId: {
        agentId: candidate.roomAgent.agent.id,
        roomId: room.id,
      },
    },
    data: {
      lastInvokedAt: new Date(),
      lastSeenMessageId: latestMessage.id,
    },
  }).catch(() => null);

  if (proposal.action !== "speak") {
    await recordTurn({
      chainId: chain.id,
      decision: "wait",
      proposal,
      reason: proposal.reason,
      roomAgent: candidate.roomAgent,
    });

    return null;
  }

  const arbiterAgent =
    room.agents.find(
      (agent) =>
        agent.agent.openclawAgentId !== candidate.roomAgent.agent.openclawAgentId &&
        !isAgentMuted(agent),
    )?.agent.openclawAgentId ?? candidate.roomAgent.agent.openclawAgentId;
  const arbiterDecision = await validateProposalWithArbiter({
    arbiterAgentId: arbiterAgent,
    candidate,
    latestMessage,
    proposal,
    recentLog,
    room,
    settings,
  });

  if (arbiterDecision.verdict !== "accept") {
    await recordTurn({
      arbiterVerdict: arbiterDecision.reason,
      chainId: chain.id,
      decision: "rejected",
      proposal,
      reason: arbiterDecision.reason,
      roomAgent: candidate.roomAgent,
    });

    return null;
  }

  const created = await createAgentMessage({
    chainId: chain.id,
    latestMessage,
    proposal,
    roomAgent: candidate.roomAgent,
    roomId: room.id,
  });

  await recordTurn({
    arbiterVerdict: arbiterDecision.reason,
    chainId: chain.id,
    decision: "speak",
    messageId: created.id,
    proposal,
    roomAgent: candidate.roomAgent,
  });

  if (arbiterDecision.updatedOpenItems.length > 0) {
    await prisma.teamAgentChain.update({
      where: {
        id: chain.id,
      },
      data: {
        openItemsJson: arbiterDecision.updatedOpenItems,
      },
    });
  }

  return created;
}

async function continueAgentChain({
  chainId,
  roomId,
  settings,
}: {
  chainId: string;
  roomId: string;
  settings: DispatchSettings;
}) {
  const createdMessages: Awaited<ReturnType<typeof createAgentMessage>>[] = [];

  for (;;) {
    const chain = await prisma.teamAgentChain.findUnique({
      where: {
        id: chainId,
      },
    });

    if (!chain || chain.status !== "ACTIVE") {
      break;
    }

    if (chain.turnCount >= settings.maxChainTurns) {
      await prisma.teamAgentChain.update({
        where: {
          id: chain.id,
        },
        data: {
          status: "FUSED",
          stopReason: "Max chain turns reached.",
        },
      });
      break;
    }

    const latestMessage = chain.lastMessageId
      ? await prisma.message.findUnique({
          where: {
            id: chain.lastMessageId,
          },
          include: {
            agent: true,
            user: true,
          },
        })
      : null;

    if (!latestMessage?.agent) {
      await prisma.teamAgentChain.update({
        where: {
          id: chain.id,
        },
        data: {
          status: "STOPPED",
          stopReason: "No agent message available to continue from.",
        },
      });
      break;
    }

    const newerHumanMessage = await prisma.message.findFirst({
      where: {
        roomId,
        createdAt: {
          gt: latestMessage.createdAt,
        },
        userId: {
          not: null,
        },
      },
      select: {
        id: true,
      },
    });

    if (newerHumanMessage) {
      await prisma.teamAgentChain.update({
        where: {
          id: chain.id,
        },
        data: {
          status: "INTERRUPTED",
          stopReason: "Human message preempted the agent chain.",
        },
      });
      break;
    }

    const room = await loadDispatchRoom(roomId);

    if (!room || room.type !== "TEAM" || room.agents.length === 0) {
      break;
    }

    const recentMessages = await loadRecentMessages(roomId);
    const candidates = (
      await selectDispatchCandidates({
        chainId,
        mode: "continuation",
        room,
        settings,
        triggeringMessage: latestMessage,
      })
    ).slice(0, settings.maxContinuationCandidates);
    const recentLog = formatRecentMessages(recentMessages);

    let nextMessage: Awaited<ReturnType<typeof createAgentMessage>> | null = null;

    for (const candidate of candidates) {
      nextMessage = await runCandidate({
        candidate,
        chain: {
          id: chain.id,
          openItemsJson: chain.openItemsJson,
          turnCount: chain.turnCount,
        },
        latestMessage,
        mode: "continuation",
        recentLog,
        room,
        settings,
      });

      if (nextMessage) {
        break;
      }
    }

    if (!nextMessage) {
      await prisma.teamAgentChain.update({
        where: {
          id: chain.id,
        },
        data: {
          status: "STOPPED",
          stopReason: "No candidate added verified new value.",
        },
      });
      break;
    }

    createdMessages.push(nextMessage);
  }

  return createdMessages;
}

export async function runTeamAgentDispatch({
  roomId,
  triggeringMessageId,
}: {
  roomId: string;
  triggeringMessageId: string;
}) {
  const settings = await getDispatchSettings();
  const room = await loadDispatchRoom(roomId);

  if (!room || room.type !== "TEAM" || room.agents.length === 0) {
    return [];
  }

  const triggeringMessage = await prisma.message.findUnique({
    where: {
      id: triggeringMessageId,
    },
    include: {
      agent: true,
      user: true,
    },
  });

  if (!triggeringMessage) {
    return [];
  }

  const createdMessages: Awaited<ReturnType<typeof createAgentMessage>>[] = [];
  const recentMessages = await loadRecentMessages(roomId);
  const recentLog = formatRecentMessages(recentMessages);

  if (triggeringMessage.user) {
    const chain = await createHumanRootChain(roomId, triggeringMessage.id);
    const candidates = (
      await selectDispatchCandidates({
        chainId: chain.id,
        mode: "human",
        room,
        settings,
        triggeringMessage,
      })
    ).slice(0, settings.maxHumanFanout);

    for (const candidate of candidates) {
      const created = await runCandidate({
        candidate,
        chain,
        latestMessage: triggeringMessage,
        mode: "human",
        recentLog,
        room,
        settings,
        triggeringUser: triggeringMessage.user,
      });

      if (created) {
        createdMessages.push(created);
      }
    }

    if (createdMessages.length === 0) {
      await prisma.teamAgentChain.update({
        where: {
          id: chain.id,
        },
        data: {
          status: "STOPPED",
          stopReason: "No candidate spoke after the human message.",
        },
      });

      return [];
    }

    const continuation = await continueAgentChain({
      chainId: chain.id,
      roomId,
      settings,
    });
    createdMessages.push(...continuation);
  } else if (triggeringMessage.agent) {
    const activeChain = await prisma.teamAgentChain.findFirst({
      where: {
        lastMessageId: triggeringMessage.id,
        roomId,
        status: "ACTIVE",
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (activeChain) {
      const continuation = await continueAgentChain({
        chainId: activeChain.id,
        roomId,
        settings,
      });
      createdMessages.push(...continuation);
    }
  }

  if (createdMessages.length > 0) {
    await prisma.room.update({
      where: {
        id: roomId,
      },
      data: {},
    });
  }

  return createdMessages;
}
