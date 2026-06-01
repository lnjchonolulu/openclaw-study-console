import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { countPendingCalendarInvitations } from "@/lib/calendar";
import { getDmCollections } from "@/lib/dm";
import { listTeamChannels, listTeamParticipants } from "@/lib/team";

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const [
    { availableDmTargets, dmConversations },
    teamChannels,
    teamParticipants,
    calendarPendingInvitationCount,
  ] =
    await Promise.all([
      getDmCollections(user.id),
      listTeamChannels(user.id),
      listTeamParticipants(user.id),
      countPendingCalendarInvitations(user.id),
    ]);

  return (
    <AppShell
      availableDmTargets={availableDmTargets}
      calendarPendingInvitationCount={calendarPendingInvitationCount}
      dmConversations={dmConversations}
      initialTeamChannels={teamChannels}
      teamParticipants={teamParticipants}
      user={{
        id: user.id,
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
