import { NextResponse } from "next/server";
import {
  extractMarkdownBulletValue,
  writeAgentMarkdownFile,
  writeHeartbeatEnabled,
} from "@/lib/agent-workspace";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { getCurrentUser } from "@/lib/auth";
import { deleteUserAvatarFiles, saveUserAvatarDataUrl } from "@/lib/avatar-storage";
import { prisma } from "@/lib/prisma";
import { normalizeProfileConfig } from "@/lib/profile";
import { normalizeTimeZone } from "@/lib/timezone";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();

  if (!user || !user.agent) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    agentId?: string;
    agentDisplayName?: string;
    agentProfileConfig?: unknown;
    calendarSharingPolicy?: string;
    heartbeatEnabled?: boolean;
    identityMd?: string;
    soulMd?: string;
    userDisplayName?: string;
    userMd?: string;
    userProfileConfig?: unknown;
    userTimezone?: string;
  };

  const userMd = typeof body.userMd === "string" ? body.userMd : "";
  const identityMd = typeof body.identityMd === "string" ? body.identityMd : "";
  const soulMd = typeof body.soulMd === "string" ? body.soulMd : "";
  const userDisplayName =
    extractMarkdownBulletValue(userMd, "Name")?.trim() ||
    body.userDisplayName?.trim() ||
    user.username;
  const agentDisplayName =
    extractMarkdownBulletValue(identityMd, "Name")?.trim() ||
    body.agentDisplayName?.trim() ||
    `${user.username}'s agent`;
  const userTimezone = normalizeTimeZone(body.userTimezone ?? user.timezone);
  const agentId = body.agentId?.trim() || user.agent.openclawAgentId;
  const heartbeatEnabled = Boolean(body.heartbeatEnabled);
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
  const nextBehaviorConfig = normalizeAgentBehaviorConfig(user.agent.soulConfigJson);

  if (
    body.calendarSharingPolicy === "never" ||
    body.calendarSharingPolicy === "ask_each_time" ||
    body.calendarSharingPolicy === "always"
  ) {
    nextBehaviorConfig.calendarSharingPolicy = body.calendarSharingPolicy;
  }

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

  await Promise.all([
    writeAgentMarkdownFile(agentId, "USER.md", userMd.endsWith("\n") ? userMd : `${userMd}\n`),
    writeAgentMarkdownFile(
      agentId,
      "IDENTITY.md",
      identityMd.endsWith("\n") ? identityMd : `${identityMd}\n`,
    ),
    writeAgentMarkdownFile(agentId, "SOUL.md", soulMd.endsWith("\n") ? soulMd : `${soulMd}\n`),
    writeHeartbeatEnabled(agentId, heartbeatEnabled),
  ]);

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        displayName: userDisplayName,
        profileConfigJson: nextUserProfileConfig,
        timezone: userTimezone,
      },
    }),
    prisma.agent.update({
      where: {
        id: user.agent.id,
      },
      data: {
        displayName: agentDisplayName,
        profileConfigJson: nextAgentProfileConfig,
        soulConfigJson: nextBehaviorConfig,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
