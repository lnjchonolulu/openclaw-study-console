import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createTeamChannel, listTeamChannels, listTeamParticipants } from "@/lib/team";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [channels, participants] = await Promise.all([
    listTeamChannels(user.id),
    listTeamParticipants(user.id),
  ]);

  return NextResponse.json({
    channels,
    participants,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    agentMode?: "MANUAL" | "MENTIONED" | "ASSISTIVE" | "PROACTIVE";
    invitedAgentIds?: string[];
    invitedUserIds?: string[];
    name?: string;
    purpose?: string;
  };
  const name = body.name?.trim();
  const purpose = body.purpose?.trim() ?? "";
  const agentMode =
    body.agentMode === "MANUAL" ||
    body.agentMode === "MENTIONED" ||
    body.agentMode === "ASSISTIVE" ||
    body.agentMode === "PROACTIVE"
      ? body.agentMode
      : "ASSISTIVE";
  const invitedAgentIds = Array.isArray(body.invitedAgentIds) ? body.invitedAgentIds : [];
  const invitedUserIds = Array.isArray(body.invitedUserIds) ? body.invitedUserIds : [];

  if (!name) {
    return NextResponse.json({ error: "Channel name is required." }, { status: 400 });
  }

  const channel = await createTeamChannel(
    user.id,
    name,
    invitedUserIds,
    invitedAgentIds,
    purpose,
    agentMode,
  );

  if (!channel) {
    return NextResponse.json({ error: "Team channel could not be created." }, { status: 400 });
  }

  return NextResponse.json({
    channelId: channel.id,
  });
}
