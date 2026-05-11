import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

const DEMO_USERS = [
  {
    username: "jiyeon",
    displayName: "Jiyeon",
    password: "study-jiyeon",
  },
  {
    username: "hyungjun",
    displayName: "Hyungjun",
    password: "study-hyungjun",
  },
  {
    username: "naomi",
    displayName: "Naomi",
    password: "study-naomi",
  },
  {
    username: "ge",
    displayName: "Ge",
    password: "study-ge",
  },
];

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
}

async function upsertDemoUser(teamId, entry) {
  const passwordHash = await hashPassword(entry.password);
  const workspacePath = `~/.openclaw/workspace-${entry.username}`;

  const user = await prisma.user.upsert({
    where: {
      username: entry.username,
    },
    update: {
      displayName: entry.displayName,
      passwordHash,
      status: "ACTIVE",
      teamId,
    },
    create: {
      username: entry.username,
      displayName: entry.displayName,
      passwordHash,
      status: "ACTIVE",
      teamId,
    },
  });

  await prisma.agent.upsert({
    where: {
      userId: user.id,
    },
    update: {
      openclawAgentId: entry.username,
      displayName: `${entry.displayName} Agent`,
      workspacePath,
    },
    create: {
      userId: user.id,
      openclawAgentId: entry.username,
      displayName: `${entry.displayName} Agent`,
      workspacePath,
    },
  });
}

async function main() {
  const team = await prisma.team.upsert({
    where: {
      name: "Team 03",
    },
    update: {},
    create: {
      name: "Team 03",
    },
  });

  for (const entry of DEMO_USERS) {
    await upsertDemoUser(team.id, entry);
  }

  console.log("Seeded demo users:");
  for (const entry of DEMO_USERS) {
    console.log(`- ${entry.username} / ${entry.password}`);
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
