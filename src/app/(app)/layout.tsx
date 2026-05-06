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
  const peopleTargets = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      id: {
        not: user.id,
      },
    },
    orderBy: {
      displayName: "asc",
    },
    select: {
      id: true,
      displayName: true,
      username: true,
    },
  });
  const existingDmRooms = await prisma.room.findMany({
    where: {
      OR: [
        {
          type: "PERSONAL",
          ownerUserId: user.id,
        },
        {
          type: "GROUP",
          members: {
            some: {
              userId: user.id,
            },
          },
          agents: {
            none: {},
          },
        },
      ],
    },
    include: {
      agents: {
        include: {
          agent: true,
        },
      },
      members: {
        include: {
          user: true,
        },
      },
    },
  });
  const existingDmAgentIds = new Set(
    existingDmRooms.flatMap((room) =>
      room.agents.map((roomAgent) => roomAgent.agent.openclawAgentId),
    ),
  );
  const existingDmUserIds = new Set(
    existingDmRooms.flatMap((room) =>
      room.members
        .map((member) => member.user.id)
        .filter((memberUserId) => memberUserId !== user.id),
    ),
  );
  const agentDmItems = dmTargets.map((agent) => ({
    id: agent.openclawAgentId,
    kind: "agent" as const,
    displayName: agent.displayName,
    meta: agent.userId === user.id ? "Personal agent" : "Agent",
    isOwnAgent: agent.userId === user.id,
  }));
  const personDmItems = peopleTargets.map((person) => ({
    id: person.id,
    kind: "person" as const,
    displayName: person.displayName,
    meta: `@${person.username}`,
    isOwnAgent: false,
  }));
  const dmConversations = [
    ...agentDmItems.filter(
      (agent) => agent.isOwnAgent || existingDmAgentIds.has(agent.id),
    ),
    ...personDmItems.filter((person) => existingDmUserIds.has(person.id)),
  ];
  const availableDmTargets = [
    ...personDmItems.filter((person) => !existingDmUserIds.has(person.id)),
    ...agentDmItems.filter(
      (agent) => !agent.isOwnAgent && !existingDmAgentIds.has(agent.id),
    ),
  ];

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
