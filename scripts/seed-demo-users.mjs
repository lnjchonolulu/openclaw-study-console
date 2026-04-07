import { PrismaClient } from "@prisma/client";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
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

  const jiyeonPasswordHash = await hashPassword("study-jiyeon");
  const hyungjunPasswordHash = await hashPassword("study-hyungjun");

  await prisma.user.upsert({
    where: {
      username: "jiyeon",
    },
    update: {
      displayName: "Jiyeon",
      passwordHash: jiyeonPasswordHash,
      teamId: team.id,
    },
    create: {
      username: "jiyeon",
      displayName: "Jiyeon",
      passwordHash: jiyeonPasswordHash,
      teamId: team.id,
      agent: {
        create: {
          openclawAgentId: "jiyeon",
          displayName: "Jiyeon Agent",
          workspacePath: "~/.openclaw/workspace-jiyeon",
        },
      },
    },
  });

  await prisma.user.upsert({
    where: {
      username: "hyungjun",
    },
    update: {
      displayName: "Hyungjun",
      passwordHash: hyungjunPasswordHash,
      teamId: team.id,
    },
    create: {
      username: "hyungjun",
      displayName: "Hyungjun",
      passwordHash: hyungjunPasswordHash,
      teamId: team.id,
      agent: {
        create: {
          openclawAgentId: "hyungjun",
          displayName: "Hyungjun Agent",
          workspacePath: "~/.openclaw/workspace-hyungjun",
        },
      },
    },
  });

  console.log("Seeded demo users:");
  console.log("- jiyeon / study-jiyeon");
  console.log("- hyungjun / study-hyungjun");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
