import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { getDmCollections } from "@/lib/dm";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const { availableDmTargets, dmConversations } = await getDmCollections(user.id);

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
