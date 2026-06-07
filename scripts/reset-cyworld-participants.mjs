import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { rm } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const storageRoot =
  process.env.FILES_STORAGE_DIR?.trim() ||
  path.join(process.cwd(), ".data", "uploads");

function printHelp() {
  console.log(`Usage:
  npm run reset:participants -- --full naomi,ge
  npm run reset:participants -- --owner-dm jiyeon
  npm run reset:participants -- --full naomi,ge --owner-dm jiyeon --apply

Without --apply, the script only prints a dry-run summary.`);
}

function readListArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0
    ? process.argv[index + 1]
        ?.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean) ?? []
    : [];
}

function descendantsOf(records, rootId) {
  const ids = new Set();
  let frontier = [rootId];

  while (frontier.length > 0) {
    const next = [];

    for (const record of records) {
      if (record.parentId && frontier.includes(record.parentId) && !ids.has(record.id)) {
        ids.add(record.id);
        next.push(record.id);
      }
    }

    frontier = next;
  }

  return ids;
}

async function resetFullUser(username, apply) {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { agent: true },
  });

  if (!user || !user.agent) {
    throw new Error(`User or agent not found: @${username}`);
  }

  const dmRooms = await prisma.room.findMany({
    where: {
      OR: [
        { type: "PERSONAL", ownerUserId: user.id },
        {
          type: "PERSONAL",
          agents: { some: { agentId: user.agent.id } },
        },
        {
          type: "GROUP",
          members: { some: { userId: user.id } },
        },
      ],
    },
    select: { id: true },
  });
  const dmRoomIds = dmRooms.map((room) => room.id);
  const teamMessages = await prisma.message.findMany({
    where: {
      room: { type: "TEAM" },
      OR: [
        { userId: user.id },
        { agentId: user.agent.openclawAgentId },
      ],
    },
    select: { id: true, roomId: true },
  });
  const teamMessageIds = teamMessages.map((message) => message.id);
  const allFiles = await prisma.fileRecord.findMany({
    select: {
      id: true,
      ownerUserId: true,
      parentId: true,
      storageKey: true,
      systemKey: true,
    },
  });
  const personalFolder = allFiles.find(
    (record) => record.systemKey === `personals:${user.id}`,
  );
  const personalDescendantIds = personalFolder
    ? descendantsOf(allFiles, personalFolder.id)
    : new Set();
  const fileIds = allFiles
    .filter(
      (record) =>
        record.id !== personalFolder?.id &&
        (record.ownerUserId === user.id || personalDescendantIds.has(record.id)),
    )
    .map((record) => record.id);
  const storageKeys = allFiles
    .filter((record) => fileIds.includes(record.id))
    .map((record) => record.storageKey)
    .filter((key) => !key.startsWith("folder:"));

  const summary = {
    dmRooms: dmRoomIds.length,
    files: fileIds.length,
    teamMessages: teamMessageIds.length,
    username,
  };
  console.log(JSON.stringify(summary));

  if (!apply) {
    return;
  }

  const taskIds = (
    await prisma.agentTask.findMany({
      where: {
        OR: [
          { agentId: user.agent.openclawAgentId },
          { targetAgentId: user.agent.openclawAgentId },
          { requesterUserId: user.id },
          { targetUserId: user.id },
        ],
      },
      select: { id: true },
    })
  ).map((task) => task.id);
  const eventIds = (
    await prisma.calendarEvent.findMany({
      where: { createdByUserId: user.id },
      select: { id: true },
    })
  ).map((event) => event.id);

  await prisma.$transaction([
    prisma.appSetting.deleteMany({
      where: { key: `onboarding:first-agent-message:${user.id}` },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.typingState.deleteMany({ where: { userId: user.id } }),
    prisma.scheduledMessage.deleteMany({
      where: {
        OR: [
          { agentId: user.agent.openclawAgentId },
          { toUserId: user.id },
          ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
        ],
      },
    }),
    prisma.emailThread.deleteMany({
      where: {
        OR: [
          { agentId: user.agent.openclawAgentId },
          { requesterUserId: user.id },
          ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
        ],
      },
    }),
    prisma.agentToolExecution.deleteMany({
      where: {
        OR: [
          { actingAgentId: user.agent.openclawAgentId },
          ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
        ],
      },
    }),
    prisma.agentTask.deleteMany({ where: { id: { in: taskIds } } }),
    prisma.calendarInvitation.deleteMany({
      where: {
        OR: [
          { invitedUserId: user.id },
          { invitedByUserId: user.id },
          ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
        ],
      },
    }),
    prisma.calendarEventHidden.deleteMany({ where: { userId: user.id } }),
    prisma.calendarEventTitleOverride.deleteMany({ where: { userId: user.id } }),
    prisma.calendarEvent.deleteMany({ where: { id: { in: eventIds } } }),
    prisma.teamAgentChain.deleteMany({
      where: {
        OR: [
          ...(teamMessageIds.length
            ? [
                { rootMessageId: { in: teamMessageIds } },
                { lastMessageId: { in: teamMessageIds } },
              ]
            : []),
          { turns: { some: { agentId: user.agent.openclawAgentId } } },
        ],
      },
    }),
    prisma.message.deleteMany({
      where: {
        OR: [
          ...(dmRoomIds.length ? [{ roomId: { in: dmRoomIds } }] : []),
          ...(teamMessageIds.length ? [{ id: { in: teamMessageIds } }] : []),
        ],
      },
    }),
    prisma.fileRecord.updateMany({
      where: { roomId: { in: dmRoomIds } },
      data: { roomId: null },
    }),
    prisma.room.deleteMany({ where: { id: { in: dmRoomIds } } }),
    prisma.roomMember.deleteMany({
      where: {
        userId: user.id,
        room: {
          type: "TEAM",
          name: { not: "General" },
        },
      },
    }),
    prisma.roomAgent.deleteMany({
      where: {
        agentId: user.agent.id,
        room: {
          type: "TEAM",
          name: { not: "General" },
        },
      },
    }),
    prisma.fileRecord.deleteMany({ where: { id: { in: fileIds } } }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        displayName:
          username.length > 0
            ? `${username[0].toUpperCase()}${username.slice(1)}`
            : username,
        profileConfigJson: null,
        agent: {
          update: {
            displayName: `${
              username.length > 0
                ? `${username[0].toUpperCase()}${username.slice(1)}`
                : username
            } Agent`,
            personaSummary: null,
            profileConfigJson: null,
            soulConfigJson: null,
          },
        },
      },
    }),
  ]);

  await Promise.all(
    storageKeys.map((storageKey) =>
      rm(path.join(storageRoot, storageKey), { force: true }),
    ),
  );
}

async function resetOwnerAgentDm(username, apply) {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { agent: true },
  });

  if (!user || !user.agent) {
    throw new Error(`User or agent not found: @${username}`);
  }

  const room = await prisma.room.findFirst({
    where: {
      type: "PERSONAL",
      ownerUserId: user.id,
      agents: { some: { agentId: user.agent.id } },
    },
    select: { id: true },
  });

  console.log(JSON.stringify({ ownerAgentDmRoom: room?.id ?? null, username }));

  if (!apply) {
    return;
  }

  await prisma.$transaction([
    prisma.appSetting.deleteMany({
      where: { key: `onboarding:first-agent-message:${user.id}` },
    }),
    ...(room
      ? [
          prisma.fileRecord.updateMany({
            where: { roomId: room.id },
            data: { roomId: null },
          }),
          prisma.message.deleteMany({ where: { roomId: room.id } }),
          prisma.room.delete({ where: { id: room.id } }),
        ]
      : []),
  ]);
}

async function main() {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const fullUsers = readListArg("--full");
  const ownerDmUsers = readListArg("--owner-dm");
  const apply = process.argv.includes("--apply");

  if (fullUsers.length === 0 && ownerDmUsers.length === 0) {
    throw new Error("Pass --full user1,user2 and/or --owner-dm username.");
  }

  for (const username of fullUsers) {
    await resetFullUser(username, apply);
  }

  for (const username of ownerDmUsers) {
    await resetOwnerAgentDm(username, apply);
  }

  console.log(apply ? "Reset complete." : "Dry run only. Add --apply to execute.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
