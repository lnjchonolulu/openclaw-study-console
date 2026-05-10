export type ProfileKind = "agent" | "user";

export type ProfileConfig = {
  bgColor: string;
  fgColor: string;
  imageUrl?: string | null;
  imageDataUrl?: string | null;
};

export type AvatarViewModel = {
  config: ProfileConfig;
  kind: ProfileKind;
};

function hashSeed(seed: string) {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function wrapHue(value: number) {
  return ((value % 360) + 360) % 360;
}

function toHsl(hue: number, saturation: number, lightness: number) {
  return `hsl(${Math.round(wrapHue(hue))} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function buildGeneratedProfileConfig(seed: string, kind: ProfileKind, offset = 0): ProfileConfig {
  const baseHash = hashSeed(`${seed}:${offset}:${kind}`);
  const hue = kind === "user"
    ? wrapHue(baseHash * 1.7 + offset * 37)
    : wrapHue(baseHash * 2.1 + 18 + offset * 41);
  const bgSaturation = kind === "user" ? 78 : 68;
  const bgLightness = kind === "user" ? 90 : 88;
  const fgHue = wrapHue(hue + (kind === "user" ? 168 : 142));
  const fgSaturation = kind === "user" ? 66 + (baseHash % 14) : 58 + (baseHash % 18);
  const fgLightness = kind === "user" ? 34 + ((baseHash >> 3) % 8) : 30 + ((baseHash >> 4) % 10);

  return {
    bgColor: toHsl(hue, bgSaturation + ((baseHash >> 1) % 10), bgLightness - ((baseHash >> 2) % 8)),
    fgColor: toHsl(fgHue, fgSaturation, fgLightness),
    imageUrl: null,
    imageDataUrl: null,
  };
}

export function getDefaultProfileConfig(seed: string, kind: ProfileKind): ProfileConfig {
  return buildGeneratedProfileConfig(seed, kind, 0);
}

export function rotateProfileConfig(
  _current: ProfileConfig | null | undefined,
  _seed: string,
  kind: ProfileKind,
) {
  const randomSeed = `${Date.now()}-${Math.random()}-${Math.random()}`;
  const offset = Math.floor(Math.random() * 10_000) + 1;

  return buildGeneratedProfileConfig(randomSeed, kind, offset);
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

  const imageUrl = kind === "user" && typeof candidate.imageUrl === "string"
    ? candidate.imageUrl
    : null;
  const imageDataUrl =
    kind === "user" &&
    typeof candidate.imageDataUrl === "string" &&
    candidate.imageDataUrl.startsWith("data:image/")
      ? candidate.imageDataUrl
      : null;

  return {
    bgColor: candidate.bgColor,
    fgColor: candidate.fgColor,
    imageUrl,
    imageDataUrl,
  };
}

export function getUserMeta(username: string) {
  return `@${username}`;
}

export function getAgentMeta(username: string) {
  return `${username}'s agent`;
}
