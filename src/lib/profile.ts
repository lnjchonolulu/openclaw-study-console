export type ProfileKind = "agent" | "user";

export type ProfileConfig = {
  bgColor: string;
  fgColor: string;
};

export type AvatarViewModel = {
  config: ProfileConfig;
  kind: ProfileKind;
};

const USER_BG_COLORS = [
  "#FCE7F3",
  "#F3E8FF",
  "#E0F2FE",
  "#ECFCCB",
  "#FEF3C7",
  "#FFE4E6",
  "#E0F7FA",
  "#FDE68A",
  "#DBEAFE",
  "#E9D5FF",
];

const USER_FG_COLORS = [
  "#7C2D12",
  "#9D174D",
  "#5B21B6",
  "#0F4C81",
  "#166534",
  "#92400E",
  "#B91C1C",
  "#0F766E",
  "#1D4ED8",
  "#4C1D95",
];

const AGENT_BG_COLORS = [
  "#E5E7EB",
  "#DBEAFE",
  "#D1FAE5",
  "#FDE68A",
  "#E9D5FF",
  "#FECACA",
  "#E0F2FE",
  "#F3F4F6",
  "#FAE8FF",
  "#FEF3C7",
];

const AGENT_FG_COLORS = [
  "#111827",
  "#1D4ED8",
  "#065F46",
  "#92400E",
  "#6D28D9",
  "#B91C1C",
  "#155E75",
  "#374151",
  "#701A75",
  "#7C2D12",
];

function hashSeed(seed: string) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getColorSets(kind: ProfileKind) {
  return kind === "user"
    ? {
        backgrounds: USER_BG_COLORS,
        foregrounds: USER_FG_COLORS,
      }
    : {
        backgrounds: AGENT_BG_COLORS,
        foregrounds: AGENT_FG_COLORS,
      };
}

export function getDefaultProfileConfig(seed: string, kind: ProfileKind): ProfileConfig {
  const { backgrounds, foregrounds } = getColorSets(kind);
  const baseHash = hashSeed(seed);

  return {
    bgColor: backgrounds[baseHash % backgrounds.length],
    fgColor: foregrounds[(baseHash * 7 + 3) % foregrounds.length],
  };
}

export function rotateProfileConfig(
  current: ProfileConfig | null | undefined,
  seed: string,
  kind: ProfileKind,
) {
  const { backgrounds, foregrounds } = getColorSets(kind);
  const fallback = getDefaultProfileConfig(seed, kind);
  const backgroundIndex = backgrounds.findIndex(
    (color) => color === (current?.bgColor ?? fallback.bgColor),
  );
  const foregroundIndex = foregrounds.findIndex(
    (color) => color === (current?.fgColor ?? fallback.fgColor),
  );
  const nextBackgroundIndex =
    backgroundIndex >= 0 ? (backgroundIndex + 1) % backgrounds.length : 0;
  const nextForegroundIndex =
    foregroundIndex >= 0
      ? (foregroundIndex + (nextBackgroundIndex % 2 === 0 ? 2 : 3)) % foregrounds.length
      : 0;

  return {
    bgColor: backgrounds[nextBackgroundIndex],
    fgColor: foregrounds[nextForegroundIndex],
  };
}

export function normalizeProfileConfig(
  raw: unknown,
  seed: string,
  kind: ProfileKind,
): ProfileConfig {
  const fallback = getDefaultProfileConfig(seed, kind);

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const candidate = raw as Partial<ProfileConfig>;

  if (
    typeof candidate.bgColor !== "string" ||
    typeof candidate.fgColor !== "string"
  ) {
    return fallback;
  }

  return {
    bgColor: candidate.bgColor,
    fgColor: candidate.fgColor,
  };
}

export function getUserMeta(username: string) {
  return `@${username}`;
}

export function getAgentMeta(username: string) {
  return `${username}'s agent`;
}
