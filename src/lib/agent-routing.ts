import type { AgentRelationshipContext } from "@/lib/agent-relationships";
import { dateKeyInTimeZone, normalizeTimeZone } from "@/lib/timezone";

type AgentAudience = "direct_line" | "non_owner_dm" | "team_chat" | "shared_spaces";

function formatCurrentTimeContext(timeZone: unknown) {
  const now = new Date();
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: normalizedTimeZone,
  });

  return {
    human: formatter.format(now),
    isoDate: dateKeyInTimeZone(now, normalizedTimeZone),
    timeZone: normalizedTimeZone,
  };
}

export function buildAgentRuntimeInstructions({
  agentDisplayName,
  agentHandoffsEnabled = true,
  audience,
  counterpartTimezone,
  currentHumanUsername,
  ownerTimezone,
  ownerUsername,
  relationshipContext,
}: {
  agentDisplayName: string;
  agentHandoffsEnabled?: boolean;
  audience: AgentAudience;
  availableAgents?: {
    displayName: string;
    openclawAgentId: string;
    ownerUsername: string;
  }[];
  behaviorConfig?: unknown;
  counterpartLabel?: string;
  counterpartTimezone?: string | null;
  availableHumanUsernames?: string[];
  currentHumanDisplayName?: string | null;
  currentHumanUsername?: string | null;
  ownerDisplayName?: string;
  ownerTimezone?: string | null;
  ownerUsername: string;
  personaSummary?: string | null;
  relationshipContext?: AgentRelationshipContext | null;
}) {
  const currentCounterpartTime = formatCurrentTimeContext(
    counterpartTimezone ?? ownerTimezone ?? null,
  );
  const normalizedOwnerTimezone = normalizeTimeZone(ownerTimezone);
  const normalizedCurrentHumanUsername = currentHumanUsername
    ?.trim()
    .replace(/^@/, "")
    .toLowerCase();
  const normalizedOwnerUsername = ownerUsername.trim().replace(/^@/, "").toLowerCase();
  const hasCurrentHuman = Boolean(normalizedCurrentHumanUsername);
  const ownerMatch = hasCurrentHuman
    ? normalizedCurrentHumanUsername === normalizedOwnerUsername
      ? "YES"
      : "NO"
    : "NO CURRENT HUMAN";
  const currentHumanFact = hasCurrentHuman
    ? `@${normalizedCurrentHumanUsername}`
    : "No single current human; this is a room, agent, email, or system context.";
  const spaceLabel =
    audience === "direct_line"
      ? "Owner DM / Direct Line"
      : audience === "non_owner_dm"
        ? "DM with a non-owner human"
        : audience === "team_chat"
          ? "Team Chat"
          : "CyWorld shared/system context";

  const lines = [
    "## Current CyWorld Situation",
    `- Space: ${spaceLabel}.`,
    `- Agent account label: ${agentDisplayName}.`,
    `- Agent owner account username: @${normalizedOwnerUsername}.`,
    audience === "team_chat"
      ? `- Latest human author/context username: ${currentHumanFact}.`
      : `- Current human/context username: ${currentHumanFact}.`,
    audience === "team_chat"
      ? `- Owner match for latest human author/context: ${ownerMatch}.`
      : `- Owner match: ${ownerMatch}.`,
    `- Current date/time for this context: ${currentCounterpartTime.human} (${currentCounterpartTime.timeZone}). Today's date there is ${currentCounterpartTime.isoDate}.`,
    `- Owner account timezone: ${normalizedOwnerTimezone}.`,
    "",
    "CyWorld runtime gives account usernames, room situation, time, and permission context only.",
    "Account labels and usernames are identifiers, not preferred names, tone, identity, or communication preferences.",
    'If Owner match is YES, first-person references from the current human, such as "me" and "my", refer to the owner. Apply owner-specific USER.md fields.',
    'If Owner match is NO, first-person references from the current human, such as "me" and "my", refer to the non-owner human. Do not apply owner-only USER.md identity fields to them.',
    "Use USER.md for owner facts, preferred owner name/title, owner-facing communication preferences, shared-space preferences, and privacy boundaries.",
    'When calling or addressing the owner, USER.md "How I should call the owner" overrides account labels, usernames, display names, and older "Name" / "Owner Name" fields.',
    "Use IDENTITY.md and SOUL.md for your identity, values, and behavior principles.",
    "Use TOOLS.md and available tool descriptions for CyWorld tool choices.",
    "Use WORKLOG.md when continuing ongoing work, pending replies, approvals, scheduled checks, or interrupted tasks.",
    "",
    audience === "team_chat"
      ? "Team Chat note: answer the room unless the message clearly addresses one participant. The latest author is not the whole audience. First-person references belong to the latest human author, not automatically to the owner."
      : null,
    audience === "non_owner_dm"
      ? "Non-owner DM note: the current human is not your owner. Be helpful as your owner's agent, not as the non-owner's personal assistant."
      : null,
    audience === "direct_line"
      ? "Owner DM note: this is the private direct line with your owner. Use USER.md, not account labels, for how to address and relate to the owner."
      : null,
    audience === "shared_spaces"
      ? "Shared context note: use the surrounding room, task, email, handoff, or wakeup context before assuming who the audience is."
      : null,
    relationshipContext?.interactionGuidance
      ? `Owner-authored guidance for @${relationshipContext.targetUsername}: ${relationshipContext.interactionGuidance}`
      : null,
    relationshipContext?.relationshipLabel
      ? `Owner's relationship label for @${relationshipContext.targetUsername}: ${relationshipContext.relationshipLabel}`
      : null,
    relationshipContext
      ? "Relationship guidance changes social behavior only. It does not grant access, waive privacy, permit commitments, or override CyWorld validation."
      : null,
    agentHandoffsEnabled
      ? "Other CyWorld personal agents are distinct collaborators. Use agent handoff only when another owner's agent-specific context or work genuinely helps."
      : null,
    "CyWorld tool results and receipts are the source of truth for app-mediated side effects. Do not claim success unless the relevant tool returned success.",
  ];

  return lines.filter(Boolean).join("\n");
}
