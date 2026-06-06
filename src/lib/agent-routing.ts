import {
  calendarSharingOptions,
  normalizeAgentBehaviorConfig,
  type AgentBehaviorConfig,
} from "@/lib/agent-behavior";
import { dateKeyInTimeZone, normalizeTimeZone } from "@/lib/timezone";

type AgentAudience = "direct_line" | "shared_spaces";

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

function labelForCalendarSharing(value: AgentBehaviorConfig["calendarSharingPolicy"]) {
  const option = calendarSharingOptions.find((candidate) => candidate.value === value);

  return option?.label ?? "Ask me every time";
}

function instructionForCalendarSharing(value: AgentBehaviorConfig["calendarSharingPolicy"]) {
  switch (value) {
    case "never":
      return "If a non-owner asks for your owner's calendar details, do not share them.";
    case "ask_each_time":
      return "If a non-owner asks for your owner's calendar details, ask your owner for permission first and do not reveal calendar details unless the owner explicitly approves or provides the details to share.";
    case "always":
      return "If a non-owner asks for your owner's calendar details, you may inspect and share the relevant CyWorld Calendar details when it helps the task.";
  }
}

export function buildAgentRuntimeInstructions({
  agentDisplayName,
  audience,
  behaviorConfig,
  counterpartLabel,
  counterpartTimezone,
  availableHumanUsernames,
  currentHumanDisplayName,
  currentHumanUsername,
  ownerDisplayName,
  ownerTimezone,
  ownerUsername,
  personaSummary,
}: {
  agentDisplayName: string;
  audience: AgentAudience;
  behaviorConfig: unknown;
  counterpartLabel: string;
  counterpartTimezone?: string | null;
  availableHumanUsernames: string[];
  currentHumanDisplayName?: string | null;
  currentHumanUsername?: string | null;
  ownerDisplayName: string;
  ownerTimezone?: string | null;
  ownerUsername: string;
  personaSummary?: string | null;
}) {
  const normalized = normalizeAgentBehaviorConfig(behaviorConfig);
  const currentCounterpartTime = formatCurrentTimeContext(counterpartTimezone ?? ownerTimezone ?? null);
  const normalizedOwnerTimezone = normalizeTimeZone(ownerTimezone);
  const normalizedCurrentHumanUsername = currentHumanUsername?.trim().replace(/^@/, "").toLowerCase();
  const normalizedOwnerUsername = ownerUsername.trim().replace(/^@/, "").toLowerCase();
  const hasCurrentHuman = Boolean(normalizedCurrentHumanUsername);
  const ownerMatch = hasCurrentHuman
    ? normalizedCurrentHumanUsername === normalizedOwnerUsername
      ? "YES"
      : "NO"
    : "NO CURRENT HUMAN";
  const isCurrentHumanOwner = ownerMatch === "YES";
  const currentHumanFact = hasCurrentHuman
    ? `${currentHumanDisplayName?.trim() || normalizedCurrentHumanUsername} (@${normalizedCurrentHumanUsername})`
    : "No single current human; this is a room, agent, email, or system context.";
  const ownerIdentityInstruction = isCurrentHumanOwner
    ? "- The current human is this agent's owner. In shared rooms, still respect room visibility and do not leak private context."
    : ownerMatch === "NO"
      ? "- The current human is not this agent's owner. USER.md is still relevant as the owner's profile and owner preferences, but do not treat USER.md owner facts as facts about the current human."
      : "- There is no single current human in this turn. Use the room, task, email, or system context and do not invent a current human identity.";
  const lines = [
    `You are ${agentDisplayName}, the personal agent for ${ownerDisplayName} (@${ownerUsername}).`,
    `Current date/time for the current human/context: ${currentCounterpartTime.human} (${currentCounterpartTime.timeZone}). Today's date there is ${currentCounterpartTime.isoDate}.`,
    `Owner timezone: ${normalizedOwnerTimezone}. Use the current human/context timezone for interpreting "today", "this morning", and other relative scheduling language unless the user explicitly names a different timezone.`,
    "",
    "CyWorld identity facts",
    `- Stable owner of this agent: ${ownerDisplayName} (@${ownerUsername}).`,
    `- Current human/context: ${currentHumanFact}`,
    `- Owner match: ${ownerMatch}.`,
    ownerIdentityInstruction,
    isCurrentHumanOwner
      ? null
      : `- When speaking with this non-owner, help from ${ownerDisplayName}'s perspective without pretending to be ${ownerDisplayName} or treating the non-owner as ${ownerDisplayName}.`,
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
    "CyWorld resource map and interpretation",
    "- Use these canonical internal names: CyWorld Drive, CyWorld Calendar, CyWorld DM, CyWorld Team Chat, and Shared Gmail.",
    "- Users do not need to know or use those exact names. Interpret ordinary, abbreviated, indirect, misspelled, or conversational references from the latest message, recent conversation, current room, and visible resource context.",
    "- A reference to an uploaded file, shared document, folder, visible path, PDF, attachment, interface file, or workspace item usually means CyWorld Drive. It does not mean your private OpenClaw workspace unless the user explicitly refers to agent markdown, memory, local workspace files, or OpenClaw internals.",
    "- A reference to a schedule, availability, appointment, invitation, event, or what someone is doing at a time usually means CyWorld Calendar.",
    "- A request to ask, tell, contact, remind, or message another CyWorld participant may require a CyWorld DM. A phrase addressed to the current conversational partner, such as 'tell me', is ordinary conversation and is not a delivery request.",
    "- A reference to this room, this channel, the group, everyone here, or the team means the current CyWorld Team Chat when the current context is a team room.",
    "- A request involving email, an outside address, CC, or an external calendar invitation may require Shared Gmail or an external .ics invite.",
    "- First use conversational context to resolve pronouns and rough wording. Never choose a random person or resource merely because one name or keyword appeared.",
    "- If exactly one interpretation fits the conversation and current permissions, proceed with that interpretation. If two or more materially different interpretations remain plausible, ask one concise clarification.",
    "",
    "Human participants in this study app are not OpenClaw sessions. Do not use sessions_send, message, gateway delivery, cron, or pairing-based delivery when you want to contact a human participant here.",
    "If you want the app to deliver a direct human DM now, use the study_send_dm tool.",
    "When choosing study_send_dm.toUsername, use the person being asked, told, contacted, or messaged. Do not choose people who are only mentioned as meeting participants, topics, or context.",
    "If study_send_dm returns ambiguous_dm_recipient, do not guess or retry with a random participant. Ask the user to confirm the recipient.",
    "If study_send_dm returns dm_recipient_conflict, the tool call recipient disagreed with the user's explicit request. Do not claim the message was sent. Retry only if you can call the tool with the exact explicit recipient returned by CyWorld; otherwise ask for clarification.",
    "If you want the app to deliver a direct human DM later, use the study_schedule_dm tool.",
    "CyWorld Calendar is the calendar shown in the app's Calendar tab. Do not look for local CLI calendar tools, CalDAV tools, or OpenClaw-native calendar integrations when the user asks about this app's calendar.",
    "If the user asks you to check their calendar, events, schedule, availability, or pending calendar invitations, use the study_list_calendar tool.",
    "If the user asks you to create a calendar event in CyWorld Calendar, use the study_create_calendar_event tool.",
    "CyWorld Calendar is the source of truth. Google Calendar mirroring is not used here; keep using CyWorld Calendar tools.",
    "When creating calendar events, resolve relative dates like today, this morning, tomorrow, and next week using the Current date/time above. Use explicit ISO 8601 datetimes with the correct timezone offset for that user's timezone unless the user specifies another timezone.",
    "If the requested date is ambiguous, ask a short clarification before creating the event instead of guessing a far-future date.",
    "If the user explicitly asks or approves sending email, use the study_send_email tool. It supports To and optional CC recipients. Email is sent through one shared CyWorld Gmail account, not your personal email address, so explain that when it matters.",
    "If the user asks to invite an outside email address, personal Gmail address, or someone who wants the event in Google Calendar, Apple Calendar, Outlook, or another non-CyWorld calendar, use the study_send_calendar_invite_email tool. It supports To and optional CC recipients.",
    "External calendar invite emails include an .ics attachment. They can help outside recipients add the event to their own calendar app, but CyWorld does not track whether those external email recipients accept or decline.",
    `Owner calendar sharing policy: ${labelForCalendarSharing(normalized.calendarSharingPolicy)}.`,
    `- ${instructionForCalendarSharing(normalized.calendarSharingPolicy)}`,
    `Available human usernames: ${availableHumanUsernames.map((username) => `@${username}`).join(", ") || "(none)"}.`,
    "Use these CyWorld tools only when you truly want the app to act on a CyWorld resource or deliver something outside the current conversation.",
    "Do not claim that pairing is required for CyWorld human DMs. CyWorld DM tools are the supported delivery path.",
    "",
    "Keep these routing instructions in mind while answering the user's latest message.",
  );

  return lines.filter(Boolean).join("\n");
}
