export type ProfileKind = "agent" | "user";

export type ProfileConfig = {
  bgColor: string;
  fgColor: string;
};

export type AvatarViewModel = {
  config: ProfileConfig;
  kind: ProfileKind;
};

const USER_PALETTES: ProfileConfig[] = [
  { bgColor: "#F3E8FF", fgColor: "#5B21B6" },
  { bgColor: "#E0F2FE", fgColor: "#0F4C81" },
  { bgColor: "#DCFCE7", fgColor: "#166534" },
  { bgColor: "#FEE2E2", fgColor: "#991B1B" },
  { bgColor: "#FEF3C7", fgColor: "#92400E" },
  { bgColor: "#FCE7F3", fgColor: "#9D174D" },
];

const AGENT_PALETTES: ProfileConfig[] = [
  { bgColor: "#E5E7EB", fgColor: "#111827" },
  { bgColor: "#DBEAFE", fgColor: "#1D4ED8" },
  { bgColor: "#D1FAE5", fgColor: "#065F46" },
  { bgColor: "#FDE68A", fgColor: "#92400E" },
  { bgColor: "#E9D5FF", fgColor: "#6D28D9" },
  { bgColor: "#FECACA", fgColor: "#B91C1C" },
];

function hashSeed(seed: string) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getPalette(kind: ProfileKind) {
  return kind === "user" ? USER_PALETTES : AGENT_PALETTES;
}

export function getDefaultProfileConfig(seed: string, kind: ProfileKind): ProfileConfig {
  const palette = getPalette(kind);
  const selected = palette[hashSeed(seed) % palette.length];

  return {
    bgColor: selected.bgColor,
    fgColor: selected.fgColor,
  };
}

export function rotateProfileConfig(
  current: ProfileConfig | null | undefined,
  seed: string,
  kind: ProfileKind,
) {
  const palette = getPalette(kind);
  const fallback = getDefaultProfileConfig(seed, kind);
  const currentIndex = palette.findIndex(
    (option) => option.bgColor === (current?.bgColor ?? fallback.bgColor) &&
      option.fgColor === (current?.fgColor ?? fallback.fgColor),
  );
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % palette.length : 0;

  return palette[nextIndex];
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
