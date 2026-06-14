import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const ALLOWED_EXTENSIONS = new Map([
  ["gif", "image/gif"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

function safeContentDisposition(filename: string) {
  const fallback = filename.replace(/[^\w .@()-]+/g, "_") || "image";
  return `attachment; filename="${fallback.replace(/"/g, "")}"`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await context.params;
  const extension = segments.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  const contentType = ALLOWED_EXTENSIONS.get(extension);

  if (!contentType || segments.some((segment) => segment.includes(".."))) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const uploadRoot = path.join(process.cwd(), "public", "uploads", "chat");
  const filePath = path.resolve(uploadRoot, ...segments);

  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const bytes = await readFile(filePath).catch(() => null);

  if (!bytes) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const headers = new Headers({
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Type": contentType,
  });

  if (new URL(request.url).searchParams.get("download") === "1") {
    headers.set("Content-Disposition", safeContentDisposition(segments.at(-1) ?? "image"));
  }

  return new Response(bytes, {
    headers,
  });
}
