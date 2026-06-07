import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);
const scrypt = promisify(scryptCallback);

function printHelp() {
  console.log(`Usage:
  CYWORLD_ONBOARD_PASSWORD='new-password' npm run activate:placeholder -- \\
    --placeholder participant01 \\
    --username new-username \\
    --display-name "New Participant" \\
    [--timezone Asia/Tokyo]

The placeholder keeps its internal OpenClaw agent id while becoming an active
CyWorld participant.`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function validateUsername(username) {
  if (!username || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(username)) {
    throw new Error(
      "Username must be 2-32 lowercase letters, numbers, underscores, or hyphens.",
    );
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
}

async function main() {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const placeholder = readArg("--placeholder")?.toLowerCase();
  const username = readArg("--username")?.toLowerCase();
  const displayName = readArg("--display-name");
  const password = process.env.CYWORLD_ONBOARD_PASSWORD?.trim();
  const timezone = readArg("--timezone") || "Asia/Tokyo";

  validateUsername(placeholder);
  validateUsername(username);

  if (!displayName) {
    throw new Error("--display-name is required.");
  }

  if (!password || password.length < 8) {
    throw new Error(
      "Set CYWORLD_ONBOARD_PASSWORD to the participant's new password.",
    );
  }

  const source = await prisma.user.findUnique({
    where: { username: placeholder },
    include: { agent: true },
  });

  if (!source || source.status !== "INVITED" || !source.agent) {
    throw new Error(`Inactive placeholder @${placeholder} was not found.`);
  }

  const conflict = await prisma.user.findUnique({ where: { username } });

  if (conflict && conflict.id !== source.id) {
    throw new Error(`Username @${username} is already in use.`);
  }

  await prisma.user.update({
    where: { id: source.id },
    data: {
      displayName,
      passwordHash: await hashPassword(password),
      profileConfigJson: null,
      status: "ACTIVE",
      timezone,
      username,
      agent: {
        update: {
          displayName: `${displayName} Agent`,
          personaSummary: null,
          profileConfigJson: null,
          soulConfigJson: null,
        },
      },
      sessions: {
        deleteMany: {},
      },
    },
  });

  await prisma.appSetting.deleteMany({
    where: { key: `onboarding:first-agent-message:${source.id}` },
  });

  await execFileAsync(
    process.execPath,
    [
      "scripts/onboard-cyworld-participant.mjs",
      "--username",
      username,
      "--agent-id",
      source.agent.openclawAgentId,
      "--display-name",
      displayName,
      "--agent-name",
      `${displayName} Agent`,
      "--timezone",
      timezone,
      "--initialize-owner-files",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  console.log(
    `Activated @${placeholder} as @${username} using OpenClaw agent ${source.agent.openclawAgentId}.`,
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
