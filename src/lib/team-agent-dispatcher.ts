import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import {
  CYWORLD_AGENT_TOOLS,
  handleCyWorldAgentToolCall,
} from "@/lib/cyworld-agent-tools";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

type TeamAgentDecision =
  | {
      action: "speak";
      message: string;
    }
  | {
      action: "wait";
      reason?: string;
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
  strength: "explicit" | "relevant" | "ambient";
};

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

function selectDispatchCandidates({
  room,
  triggeringMessage,
}: {
  room: {
    agents: DispatchCandidate["roomAgent"][];
  };
  triggeringMessage: {
    content: string;
  };
}) {
  const content = triggeringMessage.content;
  const candidates: DispatchCandidate[] = [];

  for (const roomAgent of room.agents) {
    if (isAgentMuted(roomAgent)) {
      continue;
    }

    const agentMentioned = textMentionsAnyAlias(content, aliasesForAgent(roomAgent.agent));
    const ownerMentioned = textMentionsAnyAlias(content, aliasesForOwner(roomAgent.agent));

    if (agentMentioned) {
      candidates.push({
        roomAgent,
        reason: "The message explicitly mentions this agent.",
        strength: "explicit",
      });
      continue;
    }

    if (ownerMentioned) {
      candidates.push({
        roomAgent,
        reason:
          "The message mentions this agent's owner; the agent may help as that owner's personal agent without speaking as the owner.",
        strength: "relevant",
      });
      continue;
    }

    const recentlyInvoked = minutesSince(roomAgent.lastInvokedAt) < 2;

    if (!recentlyInvoked) {
      candidates.push({
        roomAgent,
        reason:
          "This agent is a channel participant; speak only if the contribution is clearly useful.",
        strength: "ambient",
      });
    }
  }

  return candidates.sort((left, right) => {
    const weight = { explicit: 0, relevant: 1, ambient: 2 };
    return weight[left.strength] - weight[right.strength];
  });
}

function parseTeamAgentDecision(value: string): TeamAgentDecision {
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
      message?: unknown;
      reason?: unknown;
    };
    const action = typeof parsed.action === "string" ? parsed.action : "";
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";

    if (action === "speak" && message) {
      return {
        action,
        message,
      };
    }

    return {
      action: "wait",
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    };
  } catch {
    return {
      action: "wait",
      reason: "Malformed decision JSON.",
    };
  }
}

function formatRecentMessages(
  messages: Array<{
    agent?: {
      displayName: string;
    } | null;
    content: string;
    createdAt: Date;
    user?: {
      displayName: string;
      username: string;
    } | null;
  }>,
) {
  return messages
    .map((message) => {
      const author = message.user
        ? `${message.user.displayName} (@${message.user.username})`
        : (message.agent?.displayName ?? "Agent");

      return `[${message.createdAt.toISOString()}] ${author}: ${message.content}`;
    })
    .join("\n");
}

function formatRoomMembers(
  room: {
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
  },
) {
  return [
    ...room.members.map((member) => `- Human: ${member.user.displayName} (@${member.user.username})`),
    ...room.agents.map(
      (member) =>
        `- Agent: ${member.agent.displayName} (${member.agent.user.username}'s agent, openclaw:${member.agent.openclawAgentId})`,
    ),
  ].join("\n");
}

export async function runTeamAgentDispatch({
  roomId,
  triggeringMessageId,
}: {
  roomId: string;
  triggeringMessageId: string;
}) {
  const room = await prisma.room.findUnique({
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
        take: 8,
      },
      members: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!room || room.type !== "TEAM" || room.agents.length === 0) {
    return [];
  }

  const triggeringMessage = await prisma.message.findUnique({
    where: {
      id: triggeringMessageId,
    },
    include: {
      user: true,
    },
  });

  if (!triggeringMessage?.user) {
    return [];
  }

  const triggeringUser = triggeringMessage.user;
  const recentMessages = await prisma.message.findMany({
    where: {
      roomId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 16,
    include: {
      agent: true,
      user: true,
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
  const createdMessages = [];
  const recentLog = formatRecentMessages([...recentMessages].reverse());
  const memberList = formatRoomMembers(room);
  const dispatchCandidates = selectDispatchCandidates({
    room,
    triggeringMessage,
  }).slice(0, 4);

  for (const candidate of dispatchCandidates) {
    const roomAgent = candidate.roomAgent;
    const agent = roomAgent.agent;
    const instructions = buildAgentRuntimeInstructions({
      agentDisplayName: agent.displayName,
      audience: "shared_spaces",
      availableHumanUsernames: activeHumans.map((human) => human.username),
      behaviorConfig: agent.soulConfigJson,
      counterpartLabel: `Team channel "${room.name}" with ${triggeringMessage.user.displayName} (@${triggeringMessage.user.username}) speaking most recently`,
      counterpartTimezone: triggeringUser.timezone,
      ownerDisplayName: agent.user.displayName,
      ownerTimezone: agent.user.timezone,
      ownerUsername: agent.user.username,
      personaSummary: agent.personaSummary,
    });

    const result = await runAgentTurn({
      agentId: agent.openclawAgentId,
      conversationKey: `team:${room.id}:agent:${agent.openclawAgentId}`,
      instructions: `${instructions}

You are participating in a CyWorld Team Chat channel.
- Channel name: ${room.name}
- Channel purpose: ${room.purpose?.trim() || "No explicit purpose has been set yet."}
- Why CyWorld is asking you to evaluate this turn: ${candidate.reason}
- Your room role note: ${roomAgent.roleNote?.trim() || "No special room-specific role note."}
- Decide whether this agent should speak now or stay quiet.
- Speak only when your contribution is clearly useful, context-aware, and not duplicative.
- If the message is about your owner, help the collaboration from your owner's perspective, but do not impersonate your owner.
- If you speak, write the exact message that should appear in the team channel.
- If you need to DM or schedule a DM to a human participant, use the provided CyWorld tool, then decide whether a channel message is still useful.
- Do not mention OpenClaw, gateway pairing, sessions_send, cron, or implementation details.
- Return JSON only.

Valid JSON:
{"action":"speak","message":"exact team-channel message"}
{"action":"wait","reason":"short reason"}`,
      message: `Channel: ${room.name}

Participants:
${memberList}

Recent conversation:
${recentLog || "(no previous messages)"}

Latest human message from ${triggeringMessage.user.displayName} (@${triggeringMessage.user.username}):
${triggeringMessage.content}

Should ${agent.displayName} speak now?`,
      tools: CYWORLD_AGENT_TOOLS,
      onToolCall: (call) =>
        handleCyWorldAgentToolCall({
          call,
          objective: triggeringMessage.content,
          requesterUserId: triggeringMessage.userId ?? triggeringUser.id,
          senderAgentOpenclawId: agent.openclawAgentId,
          sourceRoomId: room.id,
        }),
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
        lastSeenMessageId: triggeringMessage.id,
      },
    }).catch(() => null);

    const decision = parseTeamAgentDecision(result.assistantText);

    if (decision.action !== "speak") {
      continue;
    }

    const created = await prisma.message.create({
      data: {
        agentId: agent.openclawAgentId,
        content: decision.message,
        role: "AGENT",
        roomId,
      },
      include: {
        agent: true,
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
        lastSpokeAt: created.createdAt,
      },
    }).catch(() => null);

    createdMessages.push({
      author: created.agent?.displayName ?? agent.displayName,
      content: created.content,
      createdAt: created.createdAt.toISOString(),
      id: created.id,
      replyTo: null,
      senderKey: `agent:${agent.openclawAgentId}`,
      userId: `agent:${agent.openclawAgentId}`,
    });
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
