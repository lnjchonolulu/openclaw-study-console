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

  return (
    <AppShell
      dmTargets={dmTargets.map((agent) => ({
        agentId: agent.openclawAgentId,
        displayName: agent.displayName,
        isOwnAgent: agent.userId === user.id,
      }))}
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
