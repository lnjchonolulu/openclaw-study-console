import { SettingsClient } from "@/components/settings-client";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { requireUser } from "@/lib/auth";
import { normalizeProfileConfig } from "@/lib/profile";

export default async function AgentPage() {
  const user = await requireUser();

  return (
    <SettingsClient
      initialAgentDisplayName={user.agent?.displayName ?? `${user.username}'s agent`}
      initialAgentProfile={normalizeProfileConfig(
        user.agent?.profileConfigJson,
        `${user.username}-agent`,
        "agent",
      )}
      initialBehaviorConfig={normalizeAgentBehaviorConfig(user.agent?.soulConfigJson)}
      initialPersonaSummary={user.agent?.personaSummary ?? ""}
      initialUserDisplayName={user.displayName}
      initialUserProfile={normalizeProfileConfig(
        user.profileConfigJson,
        user.username,
        "user",
      )}
      username={user.username}
    />
  );
}
