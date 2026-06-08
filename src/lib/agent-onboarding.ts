import { buildAgentRuntimeInstructions } from "@/lib/agent-routing";
import { getOrCreateAgentDmRoom } from "@/lib/dm";
import { runAgentTurn } from "@/lib/openclaw";
import { prisma } from "@/lib/prisma";

const LEASE_STALE_AFTER_MS = 5 * 60 * 1000;

type OnboardingLease = {
  startedAt?: string;
  status?: string;
};

function leaseKey(userId: string) {
  return `onboarding:first-agent-message:${userId}`;
}

function parseLease(value: unknown): OnboardingLease {
  return value && typeof value === "object" ? (value as OnboardingLease) : {};
}

async function acquireLease(userId: string) {
  const key = leaseKey(userId);
  const existing = await prisma.appSetting.findUnique({ where: { key } });

  if (existing) {
    const lease = parseLease(existing.valueJson);
    const startedAt = lease.startedAt ? new Date(lease.startedAt).getTime() : 0;

    if (lease.status === "DONE") {
      return false;
    }

    if (
      lease.status === "RUNNING" &&
      startedAt > 0 &&
      Date.now() - startedAt < LEASE_STALE_AFTER_MS
    ) {
      return false;
    }

    await prisma.appSetting.update({
      where: { key },
      data: {
        valueJson: {
          startedAt: new Date().toISOString(),
          status: "RUNNING",
        },
      },
    });

    return true;
  }

  try {
    await prisma.appSetting.create({
      data: {
        key,
        valueJson: {
          startedAt: new Date().toISOString(),
          status: "RUNNING",
        },
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function ensureFirstAgentOnboardingMessage(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { agent: true },
  });

  if (!user || user.status !== "ACTIVE" || !user.agent) {
    return null;
  }

  const dmRoom = await getOrCreateAgentDmRoom(
    user.id,
    user.agent.openclawAgentId,
  );

  if (!dmRoom) {
    return null;
  }

  const existingMessage = await prisma.message.findFirst({
    where: { roomId: dmRoom.room.id },
    select: { id: true },
  });

  if (existingMessage || !(await acquireLease(user.id))) {
    return dmRoom.room.id;
  }

  try {
    const activeHumans = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { username: "asc" },
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
      agentDisplayName: user.agent.displayName,
      audience: "direct_line",
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
      behaviorConfig: user.agent.soulConfigJson,
      counterpartLabel: `${user.displayName} (@${user.username})`,
      counterpartTimezone: user.timezone,
      currentHumanDisplayName: user.displayName,
      currentHumanUsername: user.username,
      ownerDisplayName: user.displayName,
      ownerTimezone: user.timezone,
      ownerUsername: user.username,
      personaSummary: user.agent.personaSummary,
    });
    const result = await runAgentTurn({
      agentId: user.agent.openclawAgentId,
      conversationKey: `room:${dmRoom.room.id}`,
      instructions,
      message:
        "[CyWorld first-login trigger] Your owner has entered CyWorld for the first time. Read BOOTSTRAP.md and begin the one-time onboarding conversation yourself. Introduce yourself naturally, briefly explain that you are setting up together, and ask only the first one or two useful questions for this turn. Do not mark bootstrap complete until USER.md, IDENTITY.md, SOUL.md, and HEARTBEAT.md have the required CyWorld agent structure populated, including owner-vs-non-owner preferences and a brief explanation of what you can do in CyWorld. Do not mention this trigger message.",
    });

    await prisma.$transaction([
      prisma.message.create({
        data: {
          agentId: user.agent.openclawAgentId,
          content: result.assistantText,
          role: "AGENT",
          roomId: dmRoom.room.id,
        },
      }),
      prisma.room.update({
        where: { id: dmRoom.room.id },
        data: {},
      }),
      prisma.appSetting.update({
        where: { key: leaseKey(user.id) },
        data: {
          valueJson: {
            completedAt: new Date().toISOString(),
            roomId: dmRoom.room.id,
            status: "DONE",
          },
        },
      }),
    ]);
  } catch (error) {
    await prisma.appSetting.deleteMany({
      where: { key: leaseKey(user.id) },
    });
    console.error("[onboarding] failed to create first agent message", {
      error,
      userId: user.id,
    });
  }

  return dmRoom.room.id;
}
