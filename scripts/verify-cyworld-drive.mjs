import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const prisma = new PrismaClient();
const DRIVE_DIRNAME = "CYWORLD_DRIVE";
const MANAGED_INDEX = ".study-console-managed.json";
const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");

function expandHome(input) {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseAccessConfig(input) {
  if (!input || typeof input !== "object") {
    return { participantKeys: [] };
  }

  const participantKeys = Array.isArray(input.participantKeys)
    ? input.participantKeys.filter(
        (value) => typeof value === "string" && value.length > 0,
      )
    : [];

  return { participantKeys };
}

function hasAccess(record, participantKey, recordsById) {
  let current = record;

  while (current) {
    const accessConfig = parseAccessConfig(current.accessConfigJson);

    if (
      accessConfig.participantKeys.length > 0 &&
      !accessConfig.participantKeys.includes(participantKey)
    ) {
      return false;
    }

    current = current.parentId ? recordsById.get(current.parentId) : null;
  }

  return true;
}

async function loadManagedEntries(driveRoot) {
  const indexPath = path.join(driveRoot, MANAGED_INDEX);
  const parsed = JSON.parse(await readFile(indexPath, "utf8"));

  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

async function verifyAgent(user) {
  const workspaceRoot = expandHome(
    user.agent.workspacePath ||
      path.join(os.homedir(), ".openclaw", `workspace-${user.agent.openclawAgentId}`),
  );
  const driveRoot = path.join(workspaceRoot, DRIVE_DIRNAME);
  const errors = [];
  const warnings = [];

  if (!(await pathExists(driveRoot))) {
    return {
      agentId: user.agent.openclawAgentId,
      errors: [`Drive mirror is missing: ${driveRoot}`],
      warnings,
    };
  }

  for (const requiredPath of [
    path.join(driveRoot, "MANIFEST.md"),
    path.join(driveRoot, MANAGED_INDEX),
  ]) {
    if (!(await pathExists(requiredPath))) {
      errors.push(`Required mirror metadata is missing: ${requiredPath}`);
    }
  }

  if (await pathExists(path.join(driveRoot, "home"))) {
    errors.push("Legacy CYWORLD_DRIVE/home path still exists.");
  }

  if (errors.length > 0) {
    return {
      agentId: user.agent.openclawAgentId,
      errors,
      warnings,
    };
  }

  const records = await prisma.fileRecord.findMany({
    where: {
      OR: [{ teamId: user.teamId }, { teamId: null }],
    },
    select: {
      accessConfigJson: true,
      id: true,
      parentId: true,
    },
  });
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const participantKey = `agent:${user.agent.id}`;
  const accessibleRecordIds = new Set(
    records
      .filter((record) => hasAccess(record, participantKey, recordsById))
      .map((record) => record.id),
  );
  const managedEntries = await loadManagedEntries(driveRoot);
  const managedRecordEntries = managedEntries.filter(
    (entry) =>
      (entry.kind === "file" || entry.kind === "folder") &&
      typeof entry.fileRecordId === "string",
  );
  const managedRecordIds = new Set(
    managedRecordEntries.map((entry) => entry.fileRecordId),
  );

  for (const recordId of accessibleRecordIds) {
    if (!managedRecordIds.has(recordId)) {
      errors.push(`Accessible DB record is missing from the mirror index: ${recordId}`);
    }
  }

  for (const entry of managedRecordEntries) {
    if (!accessibleRecordIds.has(entry.fileRecordId)) {
      errors.push(
        `Inaccessible or deleted DB record remains mirrored: ${entry.fileRecordId} (${entry.relativePath})`,
      );
    }

    if (
      typeof entry.relativePath !== "string" ||
      !(await pathExists(path.join(driveRoot, entry.relativePath)))
    ) {
      errors.push(
        `Managed mirror path is missing: ${String(entry.relativePath)} (${entry.fileRecordId})`,
      );
    }
  }

  const generatedAtEntry = managedEntries.find(
    (entry) => entry.fileRecordId === "__manifest__",
  );

  if (!generatedAtEntry) {
    warnings.push("Managed index has no manifest entry.");
  }

  return {
    agentId: user.agent.openclawAgentId,
    errors,
    warnings,
  };
}

async function verifyOpenClawSecurity(users) {
  const errors = [];
  const source = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
  const config = JSON.parse(source);
  const configuredAgents = Array.isArray(config?.agents?.list)
    ? config.agents.list
    : [];
  const agentsById = new Map(
    configuredAgents.map((agent) => [agent.id, agent]),
  );

  for (const user of users) {
    const agentId = user.agent.openclawAgentId;
    const configuredAgent = agentsById.get(agentId);

    if (!configuredAgent) {
      errors.push(`OpenClaw config is missing agent ${agentId}.`);
      continue;
    }

    if (configuredAgent.tools?.fs?.workspaceOnly !== true) {
      errors.push(`${agentId}: tools.fs.workspaceOnly is not enabled.`);
    }

    if (
      configuredAgent.sandbox?.mode !== "all" ||
      configuredAgent.sandbox?.scope !== "agent" ||
      configuredAgent.sandbox?.workspaceAccess !== "rw"
    ) {
      errors.push(
        `${agentId}: sandbox must use mode=all, scope=agent, workspaceAccess=rw.`,
      );
    }
  }

  return errors;
}

async function main() {
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      agent: {
        isNot: null,
      },
    },
    include: {
      agent: true,
    },
    orderBy: {
      username: "asc",
    },
  });

  const results = [];

  for (const user of users) {
    results.push(await verifyAgent(user));
  }

  const securityErrors = await verifyOpenClawSecurity(users);

  let errorCount = 0;
  let warningCount = 0;

  for (const result of results) {
    console.log(`\n${result.agentId}`);

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log("- OK");
      continue;
    }

    for (const error of result.errors) {
      errorCount += 1;
      console.error(`- ERROR: ${error}`);
    }

    for (const warning of result.warnings) {
      warningCount += 1;
      console.warn(`- WARNING: ${warning}`);
    }
  }

  if (securityErrors.length > 0) {
    console.log("\nOpenClaw workspace security");

    for (const error of securityErrors) {
      errorCount += 1;
      console.error(`- ERROR: ${error}`);
    }
  }

  console.log(
    `\nChecked ${results.length} agents: ${errorCount} errors, ${warningCount} warnings.`,
  );

  if (errorCount > 0) {
    process.exitCode = 1;
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
