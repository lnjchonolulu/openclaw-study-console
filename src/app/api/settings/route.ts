import { NextResponse } from "next/server";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { getCurrentUser } from "@/lib/auth";
import { deleteUserAvatarFiles, saveUserAvatarDataUrl } from "@/lib/avatar-storage";
import { prisma } from "@/lib/prisma";
import { normalizeProfileConfig } from "@/lib/profile";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();

  if (!user || !user.agent) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    agentDisplayName?: string;
    behaviorConfig?: unknown;
    agentProfileConfig?: unknown;
    personaSummary?: string;
    userDisplayName?: string;
    userProfileConfig?: unknown;
  };

  const userDisplayName = body.userDisplayName?.trim() || user.username;
  const agentDisplayName =
    body.agentDisplayName?.trim() || `${user.username}'s agent`;
  const personaSummary = body.personaSummary?.trim() || null;
  const currentUserProfileConfig = normalizeProfileConfig(
    user.profileConfigJson,
    user.username,
    "user",
  );

  let nextUserProfileConfig = normalizeProfileConfig(
    body.userProfileConfig,
    user.username,
    "user",
  );
  const nextAgentProfileConfig = normalizeProfileConfig(
    body.agentProfileConfig,
    `${user.username}-agent`,
    "agent",
  );
  const nextBehaviorConfig = normalizeAgentBehaviorConfig(body.behaviorConfig);

  if (typeof nextUserProfileConfig.imageDataUrl === "string") {
    const imageUrl = await saveUserAvatarDataUrl(
      user.id,
      nextUserProfileConfig.imageDataUrl,
    );
    nextUserProfileConfig = {
      ...nextUserProfileConfig,
      imageDataUrl: null,
      imageUrl,
    };
  } else if (currentUserProfileConfig.imageUrl && !nextUserProfileConfig.imageUrl) {
    await deleteUserAvatarFiles(user.id);
  }

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
        soulConfigJson: nextBehaviorConfig,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
