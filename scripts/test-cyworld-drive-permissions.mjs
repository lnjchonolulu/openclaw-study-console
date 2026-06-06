import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);
const MANAGED_INDEX = ".study-console-managed.json";

function expandHome(input) {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

function driveRootFor(agent) {
  const workspaceRoot = expandHome(
    agent.workspacePath ||
      path.join(os.homedir(), ".openclaw", `workspace-${agent.openclawAgentId}`),
  );

  return path.join(workspaceRoot, "CYWORLD_DRIVE");
}

async function managedRecordIds(agent) {
  const source = await readFile(
    path.join(driveRootFor(agent), MANAGED_INDEX),
    "utf8",
  );
  const parsed = JSON.parse(source);

  return new Set(
    (Array.isArray(parsed.entries) ? parsed.entries : [])
      .map((entry) => entry.fileRecordId)
      .filter((value) => typeof value === "string"),
  );
}

async function syncAll() {
  await execFileAsync("npm", ["run", "sync:cyworld-drive:all"], {
    cwd: process.cwd(),
    env: process.env,
    timeout: 180_000,
  });
}

function expectMirrored(recordIds, recordId, expected, label) {
  const actual = recordIds.has(recordId);

  if (actual !== expected) {
    throw new Error(
      `${label}: expected mirrored=${expected}, received mirrored=${actual}.`,
    );
  }
}

async function main() {
  const users = await prisma.user.findMany({
    where: {
      username: {
        in: ["hyungjun", "jiyeon"],
      },
      status: "ACTIVE",
      agent: {
        isNot: null,
      },
    },
    include: {
      agent: true,
    },
  });
  const usersByUsername = new Map(users.map((user) => [user.username, user]));
  const hyungjun = usersByUsername.get("hyungjun");
  const jiyeon = usersByUsername.get("jiyeon");

  if (!hyungjun?.agent || !jiyeon?.agent || !hyungjun.teamId) {
    throw new Error("The permission exercise requires Hyungjun and Jiyeon agents.");
  }

  const filename = `__drive-permission-check-${Date.now()}`;
  const record = await prisma.fileRecord.create({
    data: {
      accessConfigJson: {
        createdByParticipantKey: `agent:${hyungjun.agent.id}`,
        participantKeys: [
          `agent:${hyungjun.agent.id}`,
          `user:${hyungjun.id}`,
        ],
        updatedByParticipantKey: `agent:${hyungjun.agent.id}`,
      },
      filename,
      isFolder: true,
      ownerUserId: hyungjun.id,
      sourceType: "PERMISSION_TEST",
      storageKey: filename,
      teamId: hyungjun.teamId,
      visibility: "TEAM",
    },
  });

  try {
    await syncAll();

    let hyungjunIds = await managedRecordIds(hyungjun.agent);
    let jiyeonIds = await managedRecordIds(jiyeon.agent);
    expectMirrored(hyungjunIds, record.id, true, "Hyungjun initial access");
    expectMirrored(jiyeonIds, record.id, false, "Jiyeon initial access");

    await prisma.fileRecord.update({
      where: {
        id: record.id,
      },
      data: {
        accessConfigJson: {
          createdByParticipantKey: `agent:${hyungjun.agent.id}`,
          participantKeys: [
            `agent:${jiyeon.agent.id}`,
            `user:${jiyeon.id}`,
          ],
          updatedByParticipantKey: `agent:${jiyeon.agent.id}`,
        },
      },
    });
    await syncAll();

    hyungjunIds = await managedRecordIds(hyungjun.agent);
    jiyeonIds = await managedRecordIds(jiyeon.agent);
    expectMirrored(hyungjunIds, record.id, false, "Hyungjun revoked access");
    expectMirrored(jiyeonIds, record.id, true, "Jiyeon granted access");

    await prisma.fileRecord.delete({
      where: {
        id: record.id,
      },
    });
    await syncAll();

    hyungjunIds = await managedRecordIds(hyungjun.agent);
    jiyeonIds = await managedRecordIds(jiyeon.agent);
    expectMirrored(hyungjunIds, record.id, false, "Hyungjun deleted record");
    expectMirrored(jiyeonIds, record.id, false, "Jiyeon deleted record");

    console.log("CyWorld Drive permission exercise passed.");
  } finally {
    await prisma.fileRecord.deleteMany({
      where: {
        id: record.id,
      },
    });
    await syncAll();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
