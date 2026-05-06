import { requireUser } from "@/lib/auth";
import { TeamChatClient } from "@/components/team-chat-client";
import { normalizeProfileConfig } from "@/lib/profile";
import { getTeamChannelDetail } from "@/lib/team";

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string | string[] }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const selectedChannel =
    typeof params.channel === "string" ? params.channel : null;
  const initialChannel = await getTeamChannelDetail(user.id, selectedChannel);

  return (
    <TeamChatClient
      initialChannel={initialChannel}
      selfAvatar={{
        kind: "user",
        config: normalizeProfileConfig(user.profileConfigJson, user.username, "user"),
      }}
      user={{
        displayName: user.displayName,
        id: user.id,
        username: user.username,
      }}
    />
  );
}
