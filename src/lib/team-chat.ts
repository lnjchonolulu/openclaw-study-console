export type TeamMember = {
  id: string;
  name: string;
  status: string;
};

export type TeamChannelMessage = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  userId: string;
};

export type TeamChannel = {
  id: string;
  title: string;
  createdBy: string;
  members: TeamMember[];
  messages: TeamChannelMessage[];
};

export const TEAM_CHAT_EVENT = "study-console:team-chat-updated";
const TEAM_CHAT_STORAGE_KEY = "study-console-team-chat-v1";

export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  { id: "hyungjun", name: "Hyungjun", status: "Personal agent active" },
  { id: "jiyeon", name: "Jiyeon", status: "Personal agent active" },
];

function buildGeneralChannel(): TeamChannel {
  return {
    id: "main",
    title: "General",
    createdBy: "system",
    members: DEFAULT_TEAM_MEMBERS,
    messages: [],
  };
}

function normalizeChannels(input: unknown): TeamChannel[] {
  if (!Array.isArray(input)) {
    return [buildGeneralChannel()];
  }

  const normalized = input
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as Partial<TeamChannel>;

      if (!candidate.id || !candidate.title || !candidate.createdBy) {
        return null;
      }

      if (candidate.title === "New Channel 2") {
        return null;
      }

      return {
        id: candidate.id,
        title: candidate.title,
        createdBy: candidate.createdBy,
        members:
          Array.isArray(candidate.members) && candidate.members.length > 0
            ? candidate.members.filter(
                (member): member is TeamMember =>
                  Boolean(
                    member &&
                      typeof member === "object" &&
                      "id" in member &&
                      "name" in member &&
                      "status" in member,
                  ),
              )
            : DEFAULT_TEAM_MEMBERS,
        messages: Array.isArray(candidate.messages)
          ? candidate.messages.filter(
              (message): message is TeamChannelMessage =>
                Boolean(
                  message &&
                    typeof message === "object" &&
                    "id" in message &&
                    "author" in message &&
                    "content" in message &&
                    "createdAt" in message &&
                    "userId" in message,
                ),
            )
          : [],
      };
    })
    .filter((entry): entry is TeamChannel => Boolean(entry))
    .filter((entry) => entry.title !== "Research" && entry.title !== "Outputs");

  const withoutDeprecatedMembers = normalized.map((channel) => ({
    ...channel,
    members: channel.members.filter(
      (member) => member.name !== "Minseo" && member.name !== "Daniel",
    ),
  }));

  if (!withoutDeprecatedMembers.some((channel) => channel.id === "main")) {
    return [buildGeneralChannel(), ...withoutDeprecatedMembers];
  }

  return withoutDeprecatedMembers.map((channel) =>
    channel.id === "main"
      ? {
          ...channel,
          title: "General",
          members: DEFAULT_TEAM_MEMBERS,
        }
      : channel,
  );
}

export function loadTeamChannels(): TeamChannel[] {
  if (typeof window === "undefined") {
    return [buildGeneralChannel()];
  }

  const raw = window.localStorage.getItem(TEAM_CHAT_STORAGE_KEY);

  if (!raw) {
    return [buildGeneralChannel()];
  }

  try {
    return normalizeChannels(JSON.parse(raw));
  } catch {
    return [buildGeneralChannel()];
  }
}

export function saveTeamChannels(channels: TeamChannel[]) {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeChannels(channels);
  window.localStorage.setItem(TEAM_CHAT_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(TEAM_CHAT_EVENT));
}

export function createTeamChannelId() {
  return `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTeamMessageId() {
  return `team-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
