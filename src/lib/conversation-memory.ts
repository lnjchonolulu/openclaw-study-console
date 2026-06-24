import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import type { CyWorldExecutionContext } from "@/lib/cyworld-execution-context";
import { prisma } from "@/lib/prisma";

const MAX_RECALL_RESULTS = 30;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanUsername(value: unknown) {
  return cleanText(value).replace(/^@/, "").toLowerCase();
}

function clampLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 12;
  }

  return Math.max(1, Math.min(MAX_RECALL_RESULTS, Math.round(value)));
}

function messageAuthor(message: {
  agent?: { displayName: string } | null;
  role: string;
  user?: { displayName: string; username: string } | null;
}) {
  if (message.role === "AGENT") {
    return message.agent?.displayName ?? "Agent";
  }

  return message.user
    ? `${message.user.displayName} (@${message.user.username})`
    : "System";
}

function formatMessages(
  messages: {
    agent?: { displayName: string } | null;
    content: string;
    createdAt: Date;
    id: string;
    role: string;
    user?: { displayName: string; username: string } | null;
  }[],
) {
  return messages
    .slice()
    .reverse()
    .map((message) => ({
      author: messageAuthor(message),
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      messageId: message.id,
    }));
}

async function currentAgent(openclawAgentId: string) {
  return prisma.agent.findUnique({
    where: {
      openclawAgentId,
    },
    include: {
      user: true,
    },
  });
}

async function userIsRoomMember(roomId: string, userId: string) {
  const membership = await prisma.roomMember.findUnique({
    where: {
      roomId_userId: {
        roomId,
        userId,
      },
    },
    select: {
      userId: true,
    },
  });

  return Boolean(membership);
}

async function agentIsRoomMember(roomId: string, agentId: string) {
  const membership = await prisma.roomAgent.findUnique({
    where: {
      roomId_agentId: {
        agentId,
        roomId,
      },
    },
    select: {
      agentId: true,
    },
  });

  return Boolean(membership);
}

async function resolveRecallRoom({
  agentId,
  context,
  teamChannelName,
  withUsername,
}: {
  agentId: string;
  context: CyWorldExecutionContext;
  teamChannelName: string;
  withUsername: string;
}) {
  if (!teamChannelName && !withUsername) {
    return context.originRoomId
      ? prisma.room.findUnique({
          where: {
            id: context.originRoomId,
          },
        })
      : null;
  }

  if (teamChannelName) {
    return prisma.room.findFirst({
      where: {
        type: "TEAM",
        name: {
          equals: teamChannelName,
          mode: "insensitive",
        },
        agents: {
          some: {
            agentId,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  const counterpart = await prisma.user.findUnique({
    where: {
      username: withUsername,
    },
    select: {
      id: true,
    },
  });

  if (!counterpart) {
    return null;
  }

  return prisma.room.findFirst({
    where: {
      type: "PERSONAL",
      ownerUserId: counterpart.id,
      agents: {
        some: {
          agentId,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function recallConversationHistory({
  args,
  context,
}: {
  args: Record<string, unknown>;
  context: CyWorldExecutionContext;
}) {
  const agent = await currentAgent(context.actingAgentOpenclawId);

  if (!agent) {
    return {
      ok: false,
      reason: "acting_agent_not_found",
    };
  }

  const teamChannelName = cleanText(args.teamChannelName);
  const withUsername = cleanUsername(args.withUsername);
  const query = cleanText(args.query);
  const room = await resolveRecallRoom({
    agentId: agent.id,
    context,
    teamChannelName,
    withUsername,
  });

  if (!room || !(await agentIsRoomMember(room.id, agent.id))) {
    return {
      ok: false,
      reason: "conversation_not_found_or_agent_not_a_participant",
    };
  }

  const currentHuman = context.currentHumanUserId
    ? await prisma.user.findUnique({
        where: {
          id: context.currentHumanUserId,
        },
        select: {
          id: true,
          username: true,
        },
      })
    : null;
  const currentHumanIsOwner = currentHuman?.id === agent.userId;
  const currentHumanCanSeeRoom = currentHuman
    ? await userIsRoomMember(room.id, currentHuman.id)
    : false;
  const isCurrentRoom = room.id === context.originRoomId;

  if (currentHuman && !currentHumanCanSeeRoom) {
    const policy = normalizeAgentBehaviorConfig(
      agent.soulConfigJson,
    ).conversationMemorySharingPolicy;

    if (!currentHumanIsOwner) {
      return {
        ok: false,
        reason:
          policy === "never"
            ? "owner_conversation_memory_sharing_disabled"
            : policy === "ask_each_time"
              ? "owner_conversation_memory_permission_required"
              : "requester_is_not_a_member_of_that_conversation",
        ownerUsername: agent.user.username,
        policy,
      };
    }
  }

  if (currentHuman && !currentHumanIsOwner && !isCurrentRoom && !currentHumanCanSeeRoom) {
    return {
      ok: false,
      reason: "requester_is_not_a_member_of_that_conversation",
    };
  }

  const messages = await prisma.message.findMany({
    where: {
      roomId: room.id,
      role: {
        in: ["USER", "AGENT"],
      },
      ...(query
        ? {
            content: {
              contains: query,
              mode: "insensitive",
            },
          }
        : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    take: clampLimit(args.limit),
    include: {
      agent: {
        select: {
          displayName: true,
        },
      },
      user: {
        select: {
          displayName: true,
          username: true,
        },
      },
    },
  });

  return {
    ok: true,
    conversation: {
      name: room.name,
      purpose: room.purpose,
      roomId: room.id,
      type: room.type,
    },
    query: query || null,
    messages: formatMessages(messages),
  };
}

export async function updateOwnerSharingPolicies({
  args,
  context,
}: {
  args: Record<string, unknown>;
  context: CyWorldExecutionContext;
}) {
  const agent = await currentAgent(context.actingAgentOpenclawId);

  if (!agent || context.currentHumanUserId !== agent.userId) {
    return {
      ok: false,
      reason: "only_the_agent_owner_can_update_sharing_policies",
    };
  }

  const calendarSharingPolicy = cleanText(args.calendarSharingPolicy);
  const conversationMemorySharingPolicy = cleanText(
    args.conversationMemorySharingPolicy,
  );
  const allowed = new Set(["never", "ask_each_time", "always"]);

  if (
    (calendarSharingPolicy && !allowed.has(calendarSharingPolicy)) ||
    (conversationMemorySharingPolicy &&
      !allowed.has(conversationMemorySharingPolicy)) ||
    (!calendarSharingPolicy && !conversationMemorySharingPolicy)
  ) {
    return {
      ok: false,
      reason: "invalid_or_missing_sharing_policy",
    };
  }

  const next = normalizeAgentBehaviorConfig(agent.soulConfigJson);

  if (calendarSharingPolicy) {
    next.calendarSharingPolicy =
      calendarSharingPolicy as typeof next.calendarSharingPolicy;
  }

  if (conversationMemorySharingPolicy) {
    next.conversationMemorySharingPolicy =
      conversationMemorySharingPolicy as typeof next.conversationMemorySharingPolicy;
  }

  await prisma.agent.update({
    where: {
      id: agent.id,
    },
    data: {
      soulConfigJson: next,
    },
  });

  return {
    ok: true,
    calendarSharingPolicy: next.calendarSharingPolicy,
    conversationMemorySharingPolicy: next.conversationMemorySharingPolicy,
  };
}

export async function buildTeamRoomMemoryContext(roomId: string) {
  const [room, tasks, chain, recentMessages] = await Promise.all([
    prisma.room.findUnique({
      where: {
        id: roomId,
      },
      include: {
        agents: {
          include: {
            agent: {
              select: {
                displayName: true,
              },
            },
          },
        },
        members: {
          include: {
            user: {
              select: {
                displayName: true,
                username: true,
              },
            },
          },
        },
      },
    }),
    prisma.agentTask.findMany({
      where: {
        sourceRoomId: roomId,
        status: {
          in: ["OPEN", "WAITING", "RUNNING"],
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 12,
      select: {
        id: true,
        objective: true,
        status: true,
        title: true,
        updatedAt: true,
      },
    }),
    prisma.teamAgentChain.findFirst({
      where: {
        roomId,
        status: "ACTIVE",
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        openItemsJson: true,
        turnCount: true,
      },
    }),
    prisma.message.findMany({
      where: {
        roomId,
        role: {
          in: ["USER", "AGENT"],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 16,
      include: {
        agent: {
          select: {
            displayName: true,
          },
        },
        user: {
          select: {
            displayName: true,
            username: true,
          },
        },
      },
    }),
  ]);

  if (!room) {
    return "";
  }

  const participants = [
    ...room.members.map(
      (member) => `${member.user.displayName} (@${member.user.username})`,
    ),
    ...room.agents.map((member) => member.agent.displayName),
  ];
  const openItems = Array.isArray(chain?.openItemsJson)
    ? chain.openItemsJson.filter((item): item is string => typeof item === "string")
    : [];

  return `CyWorld shared room memory
This is a read-only, room-scoped memory generated from CyWorld's canonical records. Every agent in this room receives the same room facts. Do not treat it as private owner memory.
- Room: ${room.name}
- Purpose: ${room.purpose?.trim() || "No explicit purpose has been set."}
- Participants: ${participants.join(", ") || "(none)"}
- Active chain: ${chain ? `${chain.id}, ${chain.turnCount} turns` : "(none)"}
- Open items: ${openItems.length ? openItems.join("; ") : "(none)"}
- Active tasks:
${tasks.length ? tasks.map((task) => `  - [${task.status}] ${task.title}: ${task.objective}`).join("\n") : "  - (none)"}
- Recent room record:
${formatMessages(recentMessages)
  .map((message) => `  - ${message.createdAt} ${message.author}: ${message.content}`)
  .join("\n") || "  - (none)"}`;
}

export async function buildRecentRoomConversationContext({
  limit = 12,
  roomId,
}: {
  limit?: number;
  roomId: string;
}) {
  const normalizedLimit = Math.max(1, Math.min(24, Math.round(limit)));
  const messages = await prisma.message.findMany({
    where: {
      roomId,
      role: {
        in: ["USER", "AGENT"],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: normalizedLimit,
    include: {
      agent: {
        select: {
          displayName: true,
        },
      },
      user: {
        select: {
          displayName: true,
          username: true,
        },
      },
    },
  });

  const formatted = formatMessages(messages);

  return `## Recent CyWorld Conversation Flow

These messages are recent conversation flow only.
Use them to resolve references like "that", "above", "the file", or "what you just said".
Do not treat prior assistant statements as durable truth about owner preferences, agent identity, permissions, completed actions, workspace files, or whether a preference has been defined.
Durable owner preferences come from USER.md and SOUL.md.
Agent identity comes from IDENTITY.md and SOUL.md.
Completed CyWorld actions come from tool receipts.
Ongoing work comes from WORKLOG.md.

${
    formatted.length
      ? formatted
          .map(
            (message) =>
              `- ${message.createdAt} ${message.author}: ${message.content}`,
          )
          .join("\n")
      : "- (no recent messages)"
  }`;
}
