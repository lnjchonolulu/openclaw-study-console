export const toneOptions = [
  { value: "warm", label: "Warm" },
  { value: "concise", label: "Concise" },
  { value: "analytical", label: "Analytical" },
  { value: "blunt", label: "Blunt" },
] as const;

export const levelOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Balanced" },
  { value: "high", label: "High" },
] as const;

export const workStyleOptions = [
  { value: "plan_first", label: "Plan first" },
  { value: "answer_first", label: "Answer fast, refine later" },
  { value: "ask_first", label: "Ask before bigger moves" },
] as const;

export const warmthOptions = [
  { value: "focused", label: "Focused" },
  { value: "casual", label: "Casual" },
  { value: "familiar", label: "Familiar" },
] as const;

export const challengeOptions = [
  { value: "soft", label: "Soft" },
  { value: "balanced", label: "Balanced" },
  { value: "direct", label: "Direct" },
] as const;

export const contextOptions = [
  { value: "explain_more", label: "Explain more" },
  { value: "balanced", label: "Balanced" },
  { value: "assume_context", label: "Assume context" },
] as const;

export const autonomyOptions = [
  { value: "ask_first", label: "Ask first" },
  { value: "steady", label: "Steady" },
  { value: "proactive", label: "Proactive" },
] as const;

export const formalityOptions = [
  { value: "low", label: "Relaxed" },
  { value: "medium", label: "Balanced" },
  { value: "high", label: "Formal" },
] as const;

export const representOptions = [
  { value: "never", label: "Never" },
  { value: "explicit_only", label: "Only if explicit" },
  { value: "allowed", label: "Allowed" },
] as const;

export const ownerContextOptions = [
  { value: "never", label: "Never" },
  { value: "limited", label: "Only if useful" },
  { value: "allowed", label: "Freely" },
] as const;

export const commitmentOptions = [
  { value: "never", label: "Never" },
  { value: "ask_first", label: "Ask first" },
  { value: "allowed", label: "Allowed" },
] as const;

export const calendarSharingOptions = [
  { value: "never", label: "Never share calendar details" },
  { value: "ask_each_time", label: "Ask me every time" },
  { value: "always", label: "Always allowed" },
] as const;

export const conversationMemorySharingOptions = [
  { value: "never", label: "Never share remembered conversations" },
  { value: "ask_each_time", label: "Ask me every time" },
  { value: "always", label: "Always allowed" },
] as const;

type Tone = (typeof toneOptions)[number]["value"];
type Level = (typeof levelOptions)[number]["value"];
type WorkStyle = (typeof workStyleOptions)[number]["value"];
type Warmth = (typeof warmthOptions)[number]["value"];
type Challenge = (typeof challengeOptions)[number]["value"];
type Context = (typeof contextOptions)[number]["value"];
type Autonomy = (typeof autonomyOptions)[number]["value"];
type Formality = (typeof formalityOptions)[number]["value"];
type Represent = (typeof representOptions)[number]["value"];
type OwnerContext = (typeof ownerContextOptions)[number]["value"];
type Commitment = (typeof commitmentOptions)[number]["value"];
export type CalendarSharingPolicy = (typeof calendarSharingOptions)[number]["value"];
export type ConversationMemorySharingPolicy =
  (typeof conversationMemorySharingOptions)[number]["value"];
export type RelationshipGuidanceMode = "general" | "person_specific";

export type AgentBehaviorConfig = {
  calendarSharingPolicy: CalendarSharingPolicy;
  conversationMemorySharingPolicy: ConversationMemorySharingPolicy;
  relationshipGuidanceMode: RelationshipGuidanceMode;
  responseStyle: {
    tone: Tone;
    initiative: Level;
    explanationDepth: Level;
    workStyle: WorkStyle;
    cautionLevel: Level;
  };
  directLine: {
    warmth: Warmth;
    challengeLevel: Challenge;
    contextAssumption: Context;
    autonomy: Autonomy;
    extraInstructions: string;
  };
  sharedSpaces: {
    formality: Formality;
    representOwner: Represent;
    revealOwnerContext: OwnerContext;
    assertiveness: Level;
    commitmentPolicy: Commitment;
    extraInstructions: string;
  };
};

export const defaultAgentBehaviorConfig: AgentBehaviorConfig = {
  calendarSharingPolicy: "ask_each_time",
  conversationMemorySharingPolicy: "ask_each_time",
  relationshipGuidanceMode: "general",
  responseStyle: {
    tone: "warm",
    initiative: "medium",
    explanationDepth: "medium",
    workStyle: "plan_first",
    cautionLevel: "medium",
  },
  directLine: {
    warmth: "casual",
    challengeLevel: "balanced",
    contextAssumption: "balanced",
    autonomy: "steady",
    extraInstructions: "",
  },
  sharedSpaces: {
    formality: "medium",
    representOwner: "explicit_only",
    revealOwnerContext: "limited",
    assertiveness: "medium",
    commitmentPolicy: "ask_first",
    extraInstructions: "",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickString<T extends string>(
  candidate: unknown,
  allowed: readonly { value: T }[],
  fallback: T,
) {
  return allowed.some((option) => option.value === candidate) ? (candidate as T) : fallback;
}

export function normalizeAgentBehaviorConfig(input: unknown): AgentBehaviorConfig {
  const source = isRecord(input) ? input : {};
  const responseStyle = isRecord(source.responseStyle) ? source.responseStyle : {};
  const directLine = isRecord(source.directLine) ? source.directLine : {};
  const sharedSpaces = isRecord(source.sharedSpaces) ? source.sharedSpaces : {};

  return {
    calendarSharingPolicy: pickString(
      source.calendarSharingPolicy,
      calendarSharingOptions,
      defaultAgentBehaviorConfig.calendarSharingPolicy,
    ),
    conversationMemorySharingPolicy: pickString(
      source.conversationMemorySharingPolicy,
      conversationMemorySharingOptions,
      defaultAgentBehaviorConfig.conversationMemorySharingPolicy,
    ),
    relationshipGuidanceMode:
      source.relationshipGuidanceMode === "person_specific"
        ? "person_specific"
        : "general",
    responseStyle: {
      tone: pickString(responseStyle.tone, toneOptions, defaultAgentBehaviorConfig.responseStyle.tone),
      initiative: pickString(
        responseStyle.initiative,
        levelOptions,
        defaultAgentBehaviorConfig.responseStyle.initiative,
      ),
      explanationDepth: pickString(
        responseStyle.explanationDepth,
        levelOptions,
        defaultAgentBehaviorConfig.responseStyle.explanationDepth,
      ),
      workStyle: pickString(
        responseStyle.workStyle,
        workStyleOptions,
        defaultAgentBehaviorConfig.responseStyle.workStyle,
      ),
      cautionLevel: pickString(
        responseStyle.cautionLevel,
        levelOptions,
        defaultAgentBehaviorConfig.responseStyle.cautionLevel,
      ),
    },
    directLine: {
      warmth: pickString(directLine.warmth, warmthOptions, defaultAgentBehaviorConfig.directLine.warmth),
      challengeLevel: pickString(
        directLine.challengeLevel,
        challengeOptions,
        defaultAgentBehaviorConfig.directLine.challengeLevel,
      ),
      contextAssumption: pickString(
        directLine.contextAssumption,
        contextOptions,
        defaultAgentBehaviorConfig.directLine.contextAssumption,
      ),
      autonomy: pickString(
        directLine.autonomy,
        autonomyOptions,
        defaultAgentBehaviorConfig.directLine.autonomy,
      ),
      extraInstructions:
        typeof directLine.extraInstructions === "string" ? directLine.extraInstructions : "",
    },
    sharedSpaces: {
      formality: pickString(
        sharedSpaces.formality,
        formalityOptions,
        defaultAgentBehaviorConfig.sharedSpaces.formality,
      ),
      representOwner: pickString(
        sharedSpaces.representOwner,
        representOptions,
        defaultAgentBehaviorConfig.sharedSpaces.representOwner,
      ),
      revealOwnerContext: pickString(
        sharedSpaces.revealOwnerContext,
        ownerContextOptions,
        defaultAgentBehaviorConfig.sharedSpaces.revealOwnerContext,
      ),
      assertiveness: pickString(
        sharedSpaces.assertiveness,
        levelOptions,
        defaultAgentBehaviorConfig.sharedSpaces.assertiveness,
      ),
      commitmentPolicy: pickString(
        sharedSpaces.commitmentPolicy,
        commitmentOptions,
        defaultAgentBehaviorConfig.sharedSpaces.commitmentPolicy,
      ),
      extraInstructions:
        typeof sharedSpaces.extraInstructions === "string"
          ? sharedSpaces.extraInstructions
          : "",
    },
  };
}
