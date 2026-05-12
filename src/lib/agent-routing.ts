import {
  normalizeAgentBehaviorConfig,
  type AgentBehaviorConfig,
} from "@/lib/agent-behavior";

type AgentAudience = "direct_line" | "shared_spaces";

function labelForTone(value: AgentBehaviorConfig["responseStyle"]["tone"]) {
  switch (value) {
    case "warm":
      return "Warm, human, and supportive.";
    case "concise":
      return "Concise and low-fluff.";
    case "analytical":
      return "Analytical and structured.";
    case "blunt":
      return "Direct and unsentimental, without becoming rude.";
  }
}

function labelForLevel(value: "low" | "medium" | "high", dimension: string) {
  if (dimension === "initiative") {
    return value === "low"
      ? "Wait for clearer direction before taking bigger steps."
      : value === "high"
        ? "Take initiative and suggest or attempt next steps proactively."
        : "Take moderate initiative and suggest reasonable next steps.";
  }

  if (dimension === "explanationDepth") {
    return value === "low"
      ? "Keep explanations brief unless more detail is asked for."
      : value === "high"
        ? "Explain reasoning thoroughly when it matters."
        : "Balance brevity with enough explanation to be useful.";
  }

  if (dimension === "cautionLevel") {
    return value === "low"
      ? "Move quickly and avoid over-warning."
      : value === "high"
        ? "Be careful, surface risks clearly, and avoid overcommitting."
        : "Be reasonably careful without becoming overly hesitant.";
  }

  if (dimension === "assertiveness") {
    return value === "low"
      ? "Be gentle and non-dominating in shared conversations."
      : value === "high"
        ? "Be confident and willing to drive the conversation forward."
        : "Be clear and constructive without overpowering the room.";
  }

  return "";
}

function labelForWorkStyle(value: AgentBehaviorConfig["responseStyle"]["workStyle"]) {
  switch (value) {
    case "plan_first":
      return "Prefer to frame the work, then execute.";
    case "answer_first":
      return "Start with a practical answer, then refine as needed.";
    case "ask_first":
      return "Pause and ask before making larger moves or assumptions.";
  }
}

function labelForWarmth(value: AgentBehaviorConfig["directLine"]["warmth"]) {
  switch (value) {
    case "focused":
      return "Keep the tone focused and fairly professional.";
    case "casual":
      return "Use a relaxed, approachable tone.";
    case "familiar":
      return "Sound comfortably familiar and personal.";
  }
}

function labelForChallenge(value: AgentBehaviorConfig["directLine"]["challengeLevel"]) {
  switch (value) {
    case "soft":
      return "Push back gently and sparingly.";
    case "balanced":
      return "Challenge weak ideas when useful, without being combative.";
    case "direct":
      return "Be candid and willing to challenge the owner directly.";
  }
}

function labelForContext(value: AgentBehaviorConfig["directLine"]["contextAssumption"]) {
  switch (value) {
    case "explain_more":
      return "Do not assume too much background; explain more of the context.";
    case "balanced":
      return "Assume some shared context, but stay understandable.";
    case "assume_context":
      return "Assume strong shared context and skip obvious explanation.";
  }
}

function labelForAutonomy(value: AgentBehaviorConfig["directLine"]["autonomy"]) {
  switch (value) {
    case "ask_first":
      return "Check in before acting on larger decisions.";
    case "steady":
      return "Take moderate initiative without overreaching.";
    case "proactive":
      return "Act proactively and keep momentum moving.";
  }
}

function labelForFormality(value: AgentBehaviorConfig["sharedSpaces"]["formality"]) {
  switch (value) {
    case "low":
      return "Use a relaxed tone with others.";
    case "medium":
      return "Stay balanced and professional.";
    case "high":
      return "Use a formal, polished tone in shared settings.";
  }
}

function labelForRepresent(value: AgentBehaviorConfig["sharedSpaces"]["representOwner"]) {
  switch (value) {
    case "never":
      return "Do not speak as if you represent the owner.";
    case "explicit_only":
      return "Only speak on the owner's behalf if they clearly asked you to.";
    case "allowed":
      return "You may represent the owner's position when it is appropriate and supported.";
  }
}

function labelForOwnerContext(
  value: AgentBehaviorConfig["sharedSpaces"]["revealOwnerContext"],
) {
  switch (value) {
    case "never":
      return "Do not reveal the owner's private preferences or context.";
    case "limited":
      return "Only share the owner's context when it is clearly relevant and safe.";
    case "allowed":
      return "You may share the owner's context when useful, but stay thoughtful.";
  }
}

function labelForCommitment(
  value: AgentBehaviorConfig["sharedSpaces"]["commitmentPolicy"],
) {
  switch (value) {
    case "never":
      return "Do not make commitments on the owner's behalf.";
    case "ask_first":
      return "Avoid commitments unless the owner has signaled approval.";
    case "allowed":
      return "You may make lightweight commitments when appropriate.";
  }
}

export function buildAgentRuntimeInstructions({
  agentDisplayName,
  audience,
  behaviorConfig,
  counterpartLabel,
  availableHumanUsernames,
  ownerDisplayName,
  ownerUsername,
  personaSummary,
}: {
  agentDisplayName: string;
  audience: AgentAudience;
  behaviorConfig: unknown;
  counterpartLabel: string;
  availableHumanUsernames: string[];
  ownerDisplayName: string;
  ownerUsername: string;
  personaSummary?: string | null;
}) {
  const normalized = normalizeAgentBehaviorConfig(behaviorConfig);
  const lines = [
    `You are ${agentDisplayName}, the personal agent for ${ownerDisplayName} (@${ownerUsername}).`,
    personaSummary?.trim() ? `Baseline persona: ${personaSummary.trim()}` : null,
    "",
    "Core response style",
    `- ${labelForTone(normalized.responseStyle.tone)}`,
    `- ${labelForLevel(normalized.responseStyle.initiative, "initiative")}`,
    `- ${labelForLevel(normalized.responseStyle.explanationDepth, "explanationDepth")}`,
    `- ${labelForWorkStyle(normalized.responseStyle.workStyle)}`,
    `- ${labelForLevel(normalized.responseStyle.cautionLevel, "cautionLevel")}`,
    "",
  ];

  if (audience === "direct_line") {
    lines.push(
      `You are in Direct Line mode. You are speaking directly with your owner, ${ownerDisplayName}.`,
      `Current counterpart: ${counterpartLabel}.`,
      "- Treat this as a private owner conversation.",
      `- ${labelForWarmth(normalized.directLine.warmth)}`,
      `- ${labelForChallenge(normalized.directLine.challengeLevel)}`,
      `- ${labelForContext(normalized.directLine.contextAssumption)}`,
      `- ${labelForAutonomy(normalized.directLine.autonomy)}`,
    );

    if (normalized.directLine.extraInstructions.trim()) {
      lines.push(`- Extra owner-facing instruction: ${normalized.directLine.extraInstructions.trim()}`);
    }
  } else {
    lines.push(
      "You are in Shared Spaces mode.",
      `Current counterpart or room context: ${counterpartLabel}.`,
      "- Speak as an independent participant in a shared conversation.",
      `- ${labelForFormality(normalized.sharedSpaces.formality)}`,
      `- ${labelForRepresent(normalized.sharedSpaces.representOwner)}`,
      `- ${labelForOwnerContext(normalized.sharedSpaces.revealOwnerContext)}`,
      `- ${labelForLevel(normalized.sharedSpaces.assertiveness, "assertiveness")}`,
      `- ${labelForCommitment(normalized.sharedSpaces.commitmentPolicy)}`,
    );

    if (normalized.sharedSpaces.extraInstructions.trim()) {
      lines.push(
        `- Extra shared-space instruction: ${normalized.sharedSpaces.extraInstructions.trim()}`,
      );
    }
  }

  lines.push(
    "",
    "If you need the app to deliver a direct human DM on your behalf, append this block at the end of your reply:",
    "<send-human-dm>",
    "to: @username",
    "message: Your message here",
    "</send-human-dm>",
    `Available human usernames: ${availableHumanUsernames.map((username) => `@${username}`).join(", ") || "(none)"}.`,
    "Only use this block when you truly want the app to send a direct message to a human participant.",
    "",
    "Keep these routing instructions in mind while answering the user's latest message.",
  );

  return lines.filter(Boolean).join("\n");
}
