import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteTeamChannel, updateTeamChannel } from "@/lib/team";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { channelId } = await params;
  const body = (await request.json()) as {
    invitedUserIds?: string[];
    name?: string;
  };
  const name = body.name?.trim();
  const invitedUserIds = Array.isArray(body.invitedUserIds) ? body.invitedUserIds : [];

  if (!name) {
    return NextResponse.json({ error: "Channel name is required." }, { status: 400 });
  }

  const room = await updateTeamChannel(user.id, channelId, name, invitedUserIds);

  if (!room) {
    return NextResponse.json({ error: "Channel could not be updated." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { channelId } = await params;
  const deleted = await deleteTeamChannel(user.id, channelId);

  if (!deleted) {
    return NextResponse.json({ error: "Channel could not be deleted." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
