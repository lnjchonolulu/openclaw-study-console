import { SettingsClient } from "@/components/settings-client";
import {
  extractMarkdownBulletValue,
  readAgentMarkdownFile,
  readHeartbeatEnabled,
} from "@/lib/agent-workspace";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { requireUser } from "@/lib/auth";
import { getGoogleIntegrationStatus } from "@/lib/google-integration";
import { normalizeProfileConfig } from "@/lib/profile";
import { normalizeTimeZone } from "@/lib/timezone";

export default async function AgentPage() {
  const user = await requireUser();
  const agentId = user.agent?.openclawAgentId ?? user.username;
  const [userMd, identityMd, soulMd, heartbeatEnabled, googleIntegration] = await Promise.all([
    readAgentMarkdownFile(agentId, "USER.md"),
    readAgentMarkdownFile(agentId, "IDENTITY.md"),
    readAgentMarkdownFile(agentId, "SOUL.md"),
    readHeartbeatEnabled(agentId),
    getGoogleIntegrationStatus(),
  ]);
  const userNameFromMd = extractMarkdownBulletValue(userMd, "Name");
  const agentNameFromMd = extractMarkdownBulletValue(identityMd, "Name");
  const behaviorConfig = normalizeAgentBehaviorConfig(user.agent?.soulConfigJson);

  return (
    <SettingsClient
      agentId={agentId}
      initialAgentDisplayName={
        agentNameFromMd ?? user.agent?.displayName ?? `${user.username}'s agent`
      }
      initialAgentProfile={normalizeProfileConfig(
        user.agent?.profileConfigJson,
        `${user.username}-agent`,
        "agent",
      )}
      initialCalendarSharingPolicy={behaviorConfig.calendarSharingPolicy}
      initialGoogleIntegration={googleIntegration}
      initialHeartbeatEnabled={heartbeatEnabled}
      initialIdentityMd={identityMd}
      initialSoulMd={soulMd}
      initialUserDisplayName={userNameFromMd ?? user.displayName}
      initialUserMd={userMd}
      initialUserProfile={normalizeProfileConfig(
        user.profileConfigJson,
        user.username,
        "user",
      )}
      initialUserTimezone={normalizeTimeZone(user.timezone)}
      username={user.username}
    />
  );
}
