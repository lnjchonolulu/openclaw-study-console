import { extractMarkdownBulletValue, readAgentMarkdownFile } from "@/lib/agent-workspace";
import { prisma } from "@/lib/prisma";

function cleanMarkdownProjectionValue(value: string | null) {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized === "_(pick something you like)_" ||
    normalized.startsWith("_(") ||
    normalized.endsWith(")_")
  ) {
    return null;
  }

  return normalized.replace(/^["']|["']$/g, "").trim() || null;
}

export async function syncAgentMarkdownProjection(openclawAgentId: string) {
  const agent = await prisma.agent.findUnique({
    where: {
      openclawAgentId,
    },
    include: {
      user: true,
    },
  });

  if (!agent) {
    return null;
  }

  const [userMd, identityMd] = await Promise.all([
    readAgentMarkdownFile(openclawAgentId, "USER.md"),
    readAgentMarkdownFile(openclawAgentId, "IDENTITY.md"),
  ]);
  const userDisplayName = cleanMarkdownProjectionValue(
    extractMarkdownBulletValue(userMd, "Name"),
  );
  const agentDisplayName = cleanMarkdownProjectionValue(
    extractMarkdownBulletValue(identityMd, "Name"),
  );
  const updates: Promise<unknown>[] = [];

  if (userDisplayName && userDisplayName !== agent.user.displayName) {
    updates.push(
      prisma.user.update({
        where: {
          id: agent.userId,
        },
        data: {
          displayName: userDisplayName,
        },
      }),
    );
  }

  if (agentDisplayName && agentDisplayName !== agent.displayName) {
    updates.push(
      prisma.agent.update({
        where: {
          id: agent.id,
        },
        data: {
          displayName: agentDisplayName,
        },
      }),
    );
  }

  if (updates.length) {
    await Promise.all(updates);
  }

  return {
    agentDisplayName: agentDisplayName ?? agent.displayName,
    userDisplayName: userDisplayName ?? agent.user.displayName,
  };
}
