import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const dmTargets = await prisma.agent.findMany({
    where: {
      user: {
        status: "ACTIVE",
      },
    },
    orderBy: {
      displayName: "asc",
    },
    select: {
      openclawAgentId: true,
      displayName: true,
      userId: true,
    },
  });
  const existingDmRooms = await prisma.room.findMany({
    where: {
      type: "PERSONAL",
      ownerUserId: user.id,
    },
    include: {
      agents: {
        include: {
          agent: true,
        },
      },
    },
  });
  const existingDmAgentIds = new Set(
    existingDmRooms.flatMap((room) =>
      room.agents.map((roomAgent) => roomAgent.agent.openclawAgentId),
    ),
  );
  const dmItems = dmTargets.map((agent) => ({
    agentId: agent.openclawAgentId,
    displayName: agent.displayName,
    isOwnAgent: agent.userId === user.id,
  }));
  const dmConversations = dmItems.filter(
    (agent) => agent.isOwnAgent || existingDmAgentIds.has(agent.agentId),
  );
  const availableDmTargets = dmItems.filter(
    (agent) => !agent.isOwnAgent && !existingDmAgentIds.has(agent.agentId),
  );

  return (
    <AppShell
      availableDmTargets={availableDmTargets}
      dmConversations={dmConversations}
      user={{
        displayName: user.displayName,
        username: user.username,
        teamName: user.team?.name ?? null,
        agentId: user.agent?.openclawAgentId ?? null,
      }}
    >
      {children}
    </AppShell>
  );
}
