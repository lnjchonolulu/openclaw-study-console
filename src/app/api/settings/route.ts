import { NextResponse } from "next/server";
import {
  extractMarkdownBulletValue,
  writeAgentMarkdownFile,
  writeHeartbeatEnabled,
} from "@/lib/agent-workspace";
import { normalizeAgentBehaviorConfig } from "@/lib/agent-behavior";
import { normalizeRelationshipGuidanceInput } from "@/lib/agent-relationships";
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
  const agent = user.agent;

  const body = (await request.json()) as {
    agentId?: string;
    agentDisplayName?: string;
    agentProfileConfig?: unknown;
    calendarSharingPolicy?: string;
    conversationMemorySharingPolicy?: string;
    heartbeatEnabled?: boolean;
    identityMd?: string;
    relationshipGuidance?: unknown;
    relationshipGuidanceMode?: string;
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
  const agentId = body.agentId?.trim() || agent.openclawAgentId;
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
  const nextBehaviorConfig = normalizeAgentBehaviorConfig(agent.soulConfigJson);

  if (
    body.calendarSharingPolicy === "never" ||
    body.calendarSharingPolicy === "ask_each_time" ||
    body.calendarSharingPolicy === "always"
  ) {
    nextBehaviorConfig.calendarSharingPolicy = body.calendarSharingPolicy;
  }

  if (
    body.relationshipGuidanceMode === "general" ||
    body.relationshipGuidanceMode === "person_specific"
  ) {
    nextBehaviorConfig.relationshipGuidanceMode =
      body.relationshipGuidanceMode;
  }

  const relationshipGuidance = normalizeRelationshipGuidanceInput(
    body.relationshipGuidance,
  );
  const allowedRelationshipTargets = await prisma.user.findMany({
    where: {
      id: {
        in: relationshipGuidance.map((item) => item.targetUserId),
        not: user.id,
      },
      status: "ACTIVE",
    },
    select: {
      id: true,
    },
  });
  const allowedTargetIds = new Set(
    allowedRelationshipTargets.map((target) => target.id),
  );
  const validRelationshipGuidance = relationshipGuidance.filter((item) =>
    allowedTargetIds.has(item.targetUserId),
  );

  if (
    body.conversationMemorySharingPolicy === "never" ||
    body.conversationMemorySharingPolicy === "ask_each_time" ||
    body.conversationMemorySharingPolicy === "always"
  ) {
    nextBehaviorConfig.conversationMemorySharingPolicy =
      body.conversationMemorySharingPolicy;
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

  const relationshipRows = validRelationshipGuidance
    .filter((item) => item.relationshipLabel || item.interactionGuidance)
    .map((item) => ({
      agentId: agent.id,
      interactionGuidance: item.interactionGuidance,
      relationshipLabel: item.relationshipLabel,
      targetUserId: item.targetUserId,
    }));

  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: {
        id: user.id,
      },
      data: {
        displayName: userDisplayName,
        profileConfigJson: nextUserProfileConfig,
        timezone: userTimezone,
      },
    });
    await transaction.agent.update({
      where: {
        id: agent.id,
      },
      data: {
        displayName: agentDisplayName,
        profileConfigJson: nextAgentProfileConfig,
        soulConfigJson: nextBehaviorConfig,
      },
    });
    await transaction.agentRelationshipGuidance.deleteMany({
      where: {
        agentId: agent.id,
      },
    });

    if (relationshipRows.length > 0) {
      await transaction.agentRelationshipGuidance.createMany({
        data: relationshipRows,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
