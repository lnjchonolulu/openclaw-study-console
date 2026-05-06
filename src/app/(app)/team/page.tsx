import { requireUser } from "@/lib/auth";
import { TeamChatClient } from "@/components/team-chat-client";

export default async function TeamPage() {
  const user = await requireUser();

  return (
    <TeamChatClient
      user={{
        displayName: user.displayName,
        username: user.username,
      }}
    />
  );
}
