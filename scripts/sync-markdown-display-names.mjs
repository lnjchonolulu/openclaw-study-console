import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const openclawRoot = path.join(os.homedir(), ".openclaw");

function toDefaultAgentBaseName(username) {
  if (!username) {
    return "User";
  }

  return username.charAt(0).toUpperCase() + username.slice(1);
}

function extractBulletValue(source, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`- \\*\\*${escaped}:\\*\\*\\s*(.+)$`, "m"));
  return match?.[1]?.trim() || null;
}

function replaceBulletValue(source, label, value) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const updatePattern = new RegExp(`(- \\*\\*${escaped}:\\*\\*\\s*)(.+)$`, "m");

  if (updatePattern.test(source)) {
    return source.replace(updatePattern, `$1${value}`);
  }

  const trimmed = source.trimEnd();
  const line = `- **${label}:** ${value}`;

  if (!trimmed) {
    return `${line}\n`;
  }

  return `${trimmed}\n${line}\n`;
}

async function readMarkdownFile(agentId, fileName) {
  try {
    return await fs.readFile(
      path.join(openclawRoot, `workspace-${agentId}`, fileName),
      "utf8",
    );
  } catch {
    return "";
  }
}

async function writeMarkdownFile(agentId, fileName, content) {
  await fs.writeFile(
    path.join(openclawRoot, `workspace-${agentId}`, fileName),
    content.endsWith("\n") ? content : `${content}\n`,
    "utf8",
  );
}

async function main() {
  const users = await prisma.user.findMany({
    include: { agent: true },
    orderBy: { username: "asc" },
  });

  for (const user of users) {
    if (!user.agent?.openclawAgentId) {
      continue;
    }

    const agentId = user.agent.openclawAgentId;
    const userMd = await readMarkdownFile(agentId, "USER.md");
    const identityMd = await readMarkdownFile(agentId, "IDENTITY.md");
    const nextUserMd = replaceBulletValue(userMd, "Name", user.username);
    const rawAgentName = extractBulletValue(identityMd, "Name");
    const defaultAgentBaseName = toDefaultAgentBaseName(user.username);
    const defaultAgentName = `${defaultAgentBaseName} Agent`;
    const collapsedDefaultAgentName = `${defaultAgentBaseName}Agent`;
    const lowercaseDefaultAgentName = `${user.username} Agent`;
    const collapsedLowercaseDefaultAgentName = `${user.username}Agent`;
    const nextAgentName =
      !rawAgentName ||
      rawAgentName === "_(pick something you like)_" ||
      rawAgentName === collapsedDefaultAgentName ||
      rawAgentName === lowercaseDefaultAgentName ||
      rawAgentName === collapsedLowercaseDefaultAgentName
        ? defaultAgentName
        : rawAgentName;
    const nextIdentityMd = replaceBulletValue(identityMd, "Name", nextAgentName);

    await writeMarkdownFile(agentId, "USER.md", nextUserMd);
    await writeMarkdownFile(agentId, "IDENTITY.md", nextIdentityMd);

    await prisma.user.update({
      where: { id: user.id },
      data: { displayName: user.username },
    });

    await prisma.agent.update({
      where: { id: user.agent.id },
      data: { displayName: nextAgentName },
    });

    console.log(
      `synced ${user.username} -> user:${user.username} agent:${nextAgentName}`,
    );
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
