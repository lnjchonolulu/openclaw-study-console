import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeProfileConfig } from "@/lib/profile";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();

  if (!user || !user.agent) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    agentDisplayName?: string;
    agentProfileConfig?: unknown;
    personaSummary?: string;
    userDisplayName?: string;
    userProfileConfig?: unknown;
  };

  const userDisplayName = body.userDisplayName?.trim() || user.username;
  const agentDisplayName =
    body.agentDisplayName?.trim() || `${user.username}'s agent`;
  const personaSummary = body.personaSummary?.trim() || null;

  const nextUserProfileConfig = normalizeProfileConfig(
    body.userProfileConfig,
    user.username,
    "user",
  );
  const nextAgentProfileConfig = normalizeProfileConfig(
    body.agentProfileConfig,
    `${user.username}-agent`,
    "agent",
  );

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        displayName: userDisplayName,
        profileConfigJson: nextUserProfileConfig,
      },
    }),
    prisma.agent.update({
      where: {
        id: user.agent.id,
      },
      data: {
        displayName: agentDisplayName,
        personaSummary,
        profileConfigJson: nextAgentProfileConfig,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
