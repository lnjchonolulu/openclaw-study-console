import { SettingsClient } from "@/components/settings-client";
import {
  extractMarkdownBulletValue,
  readAgentMarkdownFile,
  readHeartbeatEnabled,
} from "@/lib/agent-workspace";
import { syncAgentMarkdownProjection } from "@/lib/agent-markdown-sync";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { requireUser } from "@/lib/auth";
import { normalizeProfileConfig } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { normalizeTimeZone } from "@/lib/timezone";

export default async function AgentPage() {
  const user = await requireUser();
  const agentId = user.agent?.openclawAgentId ?? user.username;
  const projection = user.agent
    ? await syncAgentMarkdownProjection(user.agent.openclawAgentId)
    : null;
  const [userMd, identityMd, soulMd, heartbeatEnabled] = await Promise.all([
    readAgentMarkdownFile(agentId, "USER.md"),
    readAgentMarkdownFile(agentId, "IDENTITY.md"),
    readAgentMarkdownFile(agentId, "SOUL.md"),
    readHeartbeatEnabled(agentId),
  ]);
  const userNameFromMd = extractMarkdownBulletValue(userMd, "Name");
  const agentNameFromMd = extractMarkdownBulletValue(identityMd, "Name");
  const behaviorConfig = normalizeAgentBehaviorConfig(user.agent?.soulConfigJson);
  const relationshipTargets = user.agent
    ? await prisma.user.findMany({
        where: {
          id: {
            not: user.id,
          },
          status: "ACTIVE",
        },
        orderBy: {
          username: "asc",
        },
        select: {
          displayName: true,
          id: true,
          profileConfigJson: true,
          username: true,
          relationshipGuidance: {
            where: {
              agentId: user.agent.id,
            },
            select: {
              interactionGuidance: true,
              relationshipLabel: true,
            },
          },
        },
      })
    : [];

  return (
    <SettingsClient
      agentId={agentId}
      initialAgentDisplayName={
        agentNameFromMd ??
        projection?.agentDisplayName ??
        user.agent?.displayName ??
        `${user.username}'s agent`
      }
      initialAgentProfile={normalizeProfileConfig(
        user.agent?.profileConfigJson,
        `${user.username}-agent`,
        "agent",
      )}
      initialCalendarSharingPolicy={behaviorConfig.calendarSharingPolicy}
      initialConversationMemorySharingPolicy={
        behaviorConfig.conversationMemorySharingPolicy
      }
      initialRelationshipGuidance={relationshipTargets.map((target) => ({
        displayName: target.displayName,
        interactionGuidance:
          target.relationshipGuidance[0]?.interactionGuidance ?? "",
        profile: normalizeProfileConfig(
          target.profileConfigJson,
          target.username,
          "user",
        ),
        relationshipLabel:
          target.relationshipGuidance[0]?.relationshipLabel ?? "",
        targetUserId: target.id,
        username: target.username,
      }))}
      initialRelationshipGuidanceMode={behaviorConfig.relationshipGuidanceMode}
      initialHeartbeatEnabled={heartbeatEnabled}
      initialIdentityMd={identityMd}
      initialSoulMd={soulMd}
      initialUserDisplayName={userNameFromMd ?? projection?.userDisplayName ?? user.displayName}
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
