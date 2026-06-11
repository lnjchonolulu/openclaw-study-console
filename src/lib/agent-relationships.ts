import { prisma } from "@/lib/prisma";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import type { CyWorldExecutionContext } from "@/lib/cyworld-execution-context";

export type AgentRelationshipContext = {
  interactionGuidance: string | null;
  relationshipLabel: string | null;
  targetDisplayName: string;
  targetTimezone: string;
  targetUsername: string;
};

function cleanOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

export function normalizeRelationshipGuidanceInput(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return [];
    }

    const source = candidate as Record<string, unknown>;
    const targetUserId =
      typeof source.targetUserId === "string" ? source.targetUserId.trim() : "";

    if (!targetUserId) {
      return [];
    }

    return [
      {
        interactionGuidance: cleanOptionalText(source.interactionGuidance, 2000),
        relationshipLabel: cleanOptionalText(source.relationshipLabel, 160),
        targetUserId,
      },
    ];
  });
}

export async function getAgentRelationshipContext({
  agentDatabaseId,
  agentOpenclawId,
  targetUserId,
  targetUsername,
}: {
  agentDatabaseId?: string | null;
  agentOpenclawId?: string | null;
  targetUserId?: string | null;
  targetUsername?: string | null;
}): Promise<AgentRelationshipContext | null> {
  if (
    (!agentDatabaseId && !agentOpenclawId) ||
    (!targetUserId && !targetUsername)
  ) {
    return null;
  }

  const guidance = await prisma.agentRelationshipGuidance.findFirst({
    where: {
      agent: agentDatabaseId
        ? {
            id: agentDatabaseId,
          }
        : {
            openclawAgentId: agentOpenclawId ?? undefined,
          },
      targetUser: targetUserId
        ? {
            id: targetUserId,
            status: "ACTIVE",
          }
        : {
            username: targetUsername?.replace(/^@/, ""),
            status: "ACTIVE",
          },
    },
    select: {
      interactionGuidance: true,
      relationshipLabel: true,
      targetUser: {
        select: {
          displayName: true,
          timezone: true,
          username: true,
        },
      },
    },
  });

  if (!guidance) {
    return null;
  }

  return {
    interactionGuidance: guidance.interactionGuidance,
    relationshipLabel: guidance.relationshipLabel,
    targetDisplayName: guidance.targetUser.displayName,
    targetTimezone: guidance.targetUser.timezone,
    targetUsername: guidance.targetUser.username,
  };
}

export async function updateOwnerRelationshipGuidance({
  args,
  context,
}: {
  args: Record<string, unknown>;
  context: CyWorldExecutionContext;
}) {
  const agent = await prisma.agent.findUnique({
    where: {
      openclawAgentId: context.actingAgentOpenclawId,
    },
    select: {
      id: true,
      soulConfigJson: true,
      userId: true,
    },
  });

  if (!agent || context.currentHumanUserId !== agent.userId) {
    return {
      ok: false,
      reason: "only_the_agent_owner_can_update_relationship_guidance",
    };
  }

  const mode =
    args.mode === "general" || args.mode === "person_specific"
      ? args.mode
      : null;
  const entries = Array.isArray(args.relationships) ? args.relationships : [];

  if (!mode) {
    return {
      ok: false,
      reason: "invalid_relationship_guidance_mode",
    };
  }

  const usernames = entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const username = (entry as Record<string, unknown>).username;
    return typeof username === "string"
      ? [username.trim().replace(/^@/, "").toLowerCase()]
      : [];
  });
  const targets = await prisma.user.findMany({
    where: {
      id: {
        not: agent.userId,
      },
      status: "ACTIVE",
      username: {
        in: usernames,
      },
    },
    select: {
      id: true,
      username: true,
    },
  });
  const targetByUsername = new Map(
    targets.map((target) => [target.username.toLowerCase(), target]),
  );
  const normalizedEntries = entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const source = entry as Record<string, unknown>;
    const username =
      typeof source.username === "string"
        ? source.username.trim().replace(/^@/, "").toLowerCase()
        : "";
    const target = targetByUsername.get(username);

    if (!target) {
      return [];
    }

    return [
      {
        interactionGuidance: cleanOptionalText(
          source.interactionGuidance,
          2000,
        ),
        relationshipLabel: cleanOptionalText(
          source.relationshipLabel,
          160,
        ),
        target,
      },
    ];
  });
  const nextBehavior = normalizeAgentBehaviorConfig(agent.soulConfigJson);
  nextBehavior.relationshipGuidanceMode = mode;

  await prisma.$transaction([
    prisma.agent.update({
      where: {
        id: agent.id,
      },
      data: {
        soulConfigJson: nextBehavior,
      },
    }),
    ...normalizedEntries.map((entry) =>
      prisma.agentRelationshipGuidance.upsert({
        where: {
          agentId_targetUserId: {
            agentId: agent.id,
            targetUserId: entry.target.id,
          },
        },
        create: {
          agentId: agent.id,
          interactionGuidance: entry.interactionGuidance,
          relationshipLabel: entry.relationshipLabel,
          targetUserId: entry.target.id,
        },
        update: {
          interactionGuidance: entry.interactionGuidance,
          relationshipLabel: entry.relationshipLabel,
        },
      }),
    ),
  ]);

  return {
    mode,
    ok: true,
    relationships: normalizedEntries.map((entry) => ({
      interactionGuidance: entry.interactionGuidance,
      relationshipLabel: entry.relationshipLabel,
      username: entry.target.username,
    })),
  };
}
