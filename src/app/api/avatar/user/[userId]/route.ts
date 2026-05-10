import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readUserAvatar } from "@/lib/avatar-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return new NextResponse("Unauthorized.", { status: 401 });
  }

  const { userId } = await params;
  const avatar = await readUserAvatar(userId);

  if (!avatar) {
    return new NextResponse("Not found.", { status: 404 });
  }

  return new NextResponse(avatar.buffer, {
    headers: {
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Type": avatar.mimeType,
    },
  });
}
