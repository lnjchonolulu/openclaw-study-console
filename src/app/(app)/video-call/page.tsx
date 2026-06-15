import { VideoCallClient } from "@/components/video-call-client";
import { requireUser } from "@/lib/auth";
import {
  listVideoCallInviteCandidates,
  listVideoCallState,
} from "@/lib/video-calls";

export default async function VideoCallPage() {
  const user = await requireUser();
  const [{ activeCalls, history, scheduledCalls }, inviteCandidates] = await Promise.all([
    listVideoCallState(user.id),
    listVideoCallInviteCandidates(user.id),
  ]);

  return (
    <section className="video-call-page">
      <VideoCallClient
        currentUserId={user.id}
        initialActiveCalls={activeCalls}
        initialHistory={history}
        initialScheduledCalls={scheduledCalls}
        inviteCandidates={inviteCandidates}
        ownAgentId={user.agent?.openclawAgentId ?? null}
      />
    </section>
  );
}
