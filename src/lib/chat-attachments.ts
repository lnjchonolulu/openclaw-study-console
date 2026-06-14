import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_IMAGE_COUNT = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type ChatAttachment = {
  filename: string;
  id: string;
  kind: "image";
  mimeType: string;
  size: number;
  url: string;
};

export type OpenClawImageAttachment = {
  dataUrl: string;
  filename: string;
  mimeType: string;
};

function extensionForMimeType(mimeType: string) {
  return {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[mimeType] ?? "img";
}

function safeFilename(value: string, fallback: string) {
  const basename = path.basename(value || fallback);
  const cleaned = basename.replace(/[^\w .@()-]+/g, "_").trim();

  return cleaned || fallback;
}

function isFileLike(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  );
}

export function normalizeChatAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (
      record.kind !== "image" ||
      typeof record.id !== "string" ||
      typeof record.url !== "string" ||
      typeof record.filename !== "string" ||
      typeof record.mimeType !== "string" ||
      typeof record.size !== "number"
    ) {
      return [];
    }

    return [
      {
        filename: record.filename,
        id: record.id,
        kind: "image" as const,
        mimeType: record.mimeType,
        size: record.size,
        url: record.url,
      },
    ];
  });
}

export function attachmentPreviewText(attachments: ChatAttachment[]) {
  if (attachments.length === 0) {
    return "";
  }

  return attachments.length === 1 ? "[Image]" : `[${attachments.length} images]`;
}

export async function saveChatImageAttachments(files: FormDataEntryValue[]) {
  const imageFiles = files.filter(isFileLike);

  if (imageFiles.length > MAX_IMAGE_COUNT) {
    throw new Error(`Attach up to ${MAX_IMAGE_COUNT} images at a time.`);
  }

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uploadDir = path.join(process.cwd(), "public", "uploads", "chat", year, month);
  const publicPrefix = `/uploads/chat/${year}/${month}`;
  await mkdir(uploadDir, { recursive: true });

  const attachments: ChatAttachment[] = [];
  const openClawImages: OpenClawImageAttachment[] = [];

  for (const file of imageFiles) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      throw new Error("Only PNG, JPG, GIF, and WebP images are supported.");
    }

    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("Each image must be 8 MB or smaller.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const id = globalThis.crypto.randomUUID();
    const originalName = safeFilename(file.name, `image.${extensionForMimeType(file.type)}`);
    const storedName = `${id}.${extensionForMimeType(file.type)}`;
    const storagePath = path.join(uploadDir, storedName);
    await writeFile(storagePath, buffer);

    attachments.push({
      filename: originalName,
      id,
      kind: "image",
      mimeType: file.type,
      size: file.size,
      url: `${publicPrefix}/${storedName}`,
    });
    openClawImages.push({
      dataUrl: `data:${file.type};base64,${buffer.toString("base64")}`,
      filename: originalName,
      mimeType: file.type,
    });
  }

  return {
    attachments,
    openClawImages,
  };
}

export async function openClawImagesFromChatAttachments(
  attachments: ChatAttachment[],
): Promise<OpenClawImageAttachment[]> {
  const images: OpenClawImageAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.kind !== "image" || !attachment.url.startsWith("/uploads/chat/")) {
      continue;
    }

    const relativePath = attachment.url.replace(/^\/+/, "");
    const filePath = path.join(process.cwd(), "public", relativePath);
    const buffer = await readFile(filePath).catch(() => null);

    if (!buffer) {
      continue;
    }

    images.push({
      dataUrl: `data:${attachment.mimeType};base64,${buffer.toString("base64")}`,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
    });
  }

  return images;
}

export async function parseChatPayload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const saved = await saveChatImageAttachments(formData.getAll("images"));

    return {
      agentId: formData.get("agentId")?.toString().trim() || undefined,
      attachments: saved.attachments,
      clientMessageId: formData.get("clientMessageId")?.toString().trim() || undefined,
      message: formData.get("message")?.toString().trim() || "",
      openClawImages: saved.openClawImages,
      recipientId: formData.get("recipientId")?.toString().trim() || undefined,
      replyToMessageId: formData.get("replyToMessageId")?.toString().trim() || undefined,
      roomId: formData.get("roomId")?.toString().trim() || undefined,
    };
  }

  const body = (await request.json()) as {
    agentId?: string;
    clientMessageId?: string;
    message?: string;
    recipientId?: string;
    replyToMessageId?: string;
    roomId?: string;
  };

  return {
    agentId: body.agentId?.trim() || undefined,
    attachments: [],
    clientMessageId: body.clientMessageId?.trim() || undefined,
    message: body.message?.trim() || "",
    openClawImages: [],
    recipientId: body.recipientId?.trim() || undefined,
    replyToMessageId: body.replyToMessageId?.trim() || undefined,
    roomId: body.roomId?.trim() || undefined,
  };
}
