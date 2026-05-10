import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const USER_AVATAR_DIR = path.join(process.cwd(), "storage", "avatars", "users");

const MIME_TO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type AvatarMimeType = keyof typeof MIME_TO_EXTENSION;

function getUserAvatarPath(userId: string, extension: string) {
  return path.join(USER_AVATAR_DIR, `${userId}.${extension}`);
}

function parseAvatarDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);

  if (!match) {
    throw new Error("Invalid avatar image.");
  }

  const mimeType = match[1] as AvatarMimeType;
  const base64 = match[2];

  return {
    buffer: Buffer.from(base64, "base64"),
    extension: MIME_TO_EXTENSION[mimeType],
    mimeType,
  };
}

export async function deleteUserAvatarFiles(userId: string) {
  await Promise.all(
    Object.values(MIME_TO_EXTENSION).map((extension) =>
      rm(getUserAvatarPath(userId, extension), { force: true }),
    ),
  );
}

export async function saveUserAvatarDataUrl(userId: string, dataUrl: string) {
  const { buffer, extension } = parseAvatarDataUrl(dataUrl);

  await mkdir(USER_AVATAR_DIR, { recursive: true });
  await deleteUserAvatarFiles(userId);
  await writeFile(getUserAvatarPath(userId, extension), buffer);

  return `/api/avatar/user/${encodeURIComponent(userId)}?v=${Date.now()}`;
}

export async function readUserAvatar(userId: string) {
  for (const [mimeType, extension] of Object.entries(MIME_TO_EXTENSION) as [
    AvatarMimeType,
    string,
  ][]) {
    const filePath = getUserAvatarPath(userId, extension);

    try {
      await access(filePath);
      const buffer = await readFile(filePath);
      return { buffer, mimeType };
    } catch {
      continue;
    }
  }

  return null;
}
