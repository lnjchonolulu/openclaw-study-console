import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDownloadableFile } from "@/lib/files";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { fileId } = await context.params;
  const file = await getDownloadableFile(fileId);

  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  return new NextResponse(file.buffer, {
    headers: {
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.filename)}"`,
      "Content-Type": file.mimeType,
    },
  });
}
