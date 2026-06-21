import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const execFileAsync = promisify(execFile);
const scrypt = promisify(scryptCallback);
const DEFAULT_TIMEZONE = "Asia/Seoul";
const PERSONALS_ROOT_KEY = "system:personals";

function printHelp() {
  console.log(`Usage:
  CYWORLD_ONBOARD_PASSWORD='...' npm run onboard:participant -- \\
    --username <username> \\
    --display-name <name> \\
    [--timezone <IANA timezone>] \\
    [--team <team name>] \\
    [--agent-name <display name>] \\
    [--agent-id <internal OpenClaw agent id>] \\
    [--model <provider/model>] \\
    [--status active|invited] \\
    [--initialize-owner-files] \\
    [--skip-gateway-restart]

Verification only:
  npm run onboard:participant -- --username <username> --verify-only

Safety:
  - Existing users and personalized workspace files are not overwritten.
  - A partially completed onboarding can be resumed by running the same command.
  - Set CYWORLD_ONBOARD_PASSWORD only when creating a new user.`);
}

function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (
      arg === "--help" ||
      arg === "--initialize-owner-files" ||
      arg === "--verify-only" ||
      arg === "--skip-gateway-restart"
    ) {
      flags.add(arg);
      continue;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }

    values.set(arg, value.trim());
    index += 1;
  }

  return {
    agentId: values.get("--agent-id")?.toLowerCase(),
    agentName: values.get("--agent-name"),
    displayName: values.get("--display-name"),
    help: flags.has("--help"),
    initializeOwnerFiles: flags.has("--initialize-owner-files"),
    model: values.get("--model"),
    skipGatewayRestart: flags.has("--skip-gateway-restart"),
    status: (values.get("--status") || "active").toLowerCase(),
    teamName: values.get("--team"),
    timezone: values.get("--timezone") || DEFAULT_TIMEZONE,
    username: values.get("--username")?.toLowerCase(),
    verifyOnly: flags.has("--verify-only"),
  };
}

function validateUsername(username) {
  if (!username || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(username)) {
    throw new Error(
      "Username must be 2-32 lowercase letters, numbers, underscores, or hyphens.",
    );
  }
}

function validateTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

function expandHome(input) {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

function workspacePathFor(username) {
  return path.join(os.homedir(), ".openclaw", `workspace-${username}`);
}

function storedWorkspacePathFor(username) {
  return `~/.openclaw/workspace-${username}`;
}

function onboardingMarkerPath(username) {
  return path.join(
    workspacePathFor(username),
    ".cyworld-onboarding-pending.json",
  );
}

async function readOnboardingMarker(username) {
  try {
    return JSON.parse(await readFile(onboardingMarkerPath(username), "utf8"));
  } catch {
    return null;
  }
}

async function writeOnboardingMarker(username, marker) {
  await mkdir(workspacePathFor(username), { recursive: true });
  await writeFile(
    onboardingMarkerPath(username),
    `${JSON.stringify(marker, null, 2)}\n`,
    "utf8",
  );
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
}

async function run(command, args, { quiet = false } = {}) {
  const { stderr, stdout } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (!quiet && stdout.trim()) {
    console.log(stdout.trim());
  }

  if (!quiet && stderr.trim()) {
    console.error(stderr.trim());
  }

  return stdout;
}

async function listOpenClawAgents() {
  const stdout = await run("openclaw", ["agents", "list", "--json"], {
    quiet: true,
  });
  const agents = JSON.parse(stdout);

  if (!Array.isArray(agents)) {
    throw new Error("OpenClaw returned an invalid agent list.");
  }

  return agents;
}

async function resolveTeam(teamName) {
  if (teamName) {
    const team = await prisma.team.findUnique({
      where: {
        name: teamName,
      },
    });

    if (!team) {
      throw new Error(`CyWorld team not found: ${teamName}`);
    }

    return team;
  }

  const teams = await prisma.team.findMany({
    orderBy: {
      createdAt: "asc",
    },
  });

  if (teams.length === 1) {
    return teams[0];
  }

  if (teams.length === 0) {
    throw new Error("No CyWorld team exists. Create a team before onboarding.");
  }

  throw new Error("Multiple CyWorld teams exist. Pass --team <team name>.");
}

function serializeAccessConfig(config) {
  return {
    participantKeys: [...new Set(config.participantKeys ?? [])].sort(),
    systemManaged: Boolean(config.systemManaged),
  };
}

async function ensureGeneralChannel(teamId) {
  const teamUsers = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      teamId,
    },
    orderBy: {
      createdAt: "asc",
    },
    include: {
      agent: true,
    },
  });

  if (teamUsers.length === 0) {
    throw new Error("Cannot create General without an active team member.");
  }

  let room = await prisma.room.findFirst({
    where: {
      name: "General",
      teamId,
      type: "TEAM",
    },
  });

  if (!room) {
    room = await prisma.room.create({
      data: {
        name: "General",
        ownerUserId: teamUsers[0].id,
        teamId,
        type: "TEAM",
      },
    });
  }

  await prisma.$transaction([
    ...teamUsers.map((user) =>
      prisma.roomMember.upsert({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId: user.id,
          },
        },
        update: {},
        create: {
          canManageAgents: user.id === room.ownerUserId,
          canManageRoom: user.id === room.ownerUserId,
          canShareFiles: true,
          role: user.id === room.ownerUserId ? "OWNER" : "MEMBER",
          roomId: room.id,
          userId: user.id,
        },
      }),
    ),
    ...teamUsers
      .filter((user) => user.agent)
      .map((user) =>
        prisma.roomAgent.upsert({
          where: {
            roomId_agentId: {
              agentId: user.agent.id,
              roomId: room.id,
            },
          },
          update: {
            canBeMentioned: true,
            canRespond: true,
            canUseFiles: true,
          },
          create: {
            agentId: user.agent.id,
            canBeMentioned: true,
            canRespond: true,
            canUseFiles: true,
            role: "COLLABORATOR",
            roomId: room.id,
          },
        }),
      ),
  ]);

  return room;
}

async function ensurePersonalFolders(teamId) {
  const teamUsers = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      teamId,
    },
    orderBy: {
      createdAt: "asc",
    },
    include: {
      agent: true,
    },
  });

  if (teamUsers.length === 0) {
    throw new Error("Cannot create personal folders without an active team member.");
  }

  const root = await prisma.fileRecord.upsert({
    where: {
      systemKey: PERSONALS_ROOT_KEY,
    },
    update: {
      accessConfigJson: serializeAccessConfig({ participantKeys: [] }),
      teamId,
      visibility: "TEAM",
    },
    create: {
      accessConfigJson: serializeAccessConfig({ participantKeys: [] }),
      filename: "Personals",
      isFolder: true,
      ownerUserId: teamUsers[0].id,
      sourceType: "SYSTEM_FOLDER",
      storageKey: `folder:${randomUUID()}`,
      systemKey: PERSONALS_ROOT_KEY,
      teamId,
      visibility: "TEAM",
    },
  });

  for (const user of teamUsers) {
    const participantKeys = [`user:${user.id}`];

    if (user.agent) {
      participantKeys.push(`agent:${user.agent.id}`);
    }

    await prisma.fileRecord.upsert({
      where: {
        systemKey: `personals:${user.id}`,
      },
      update: {
        accessConfigJson: serializeAccessConfig({
          participantKeys,
          systemManaged: true,
        }),
        filename: user.displayName,
        ownerUserId: user.id,
        parentId: root.id,
        teamId,
        visibility: "TEAM",
      },
      create: {
        accessConfigJson: serializeAccessConfig({
          participantKeys,
          systemManaged: true,
        }),
        filename: user.displayName,
        isFolder: true,
        ownerUserId: user.id,
        parentId: root.id,
        sourceType: "SYSTEM_FOLDER",
        storageKey: `folder:${randomUUID()}`,
        systemKey: `personals:${user.id}`,
        teamId,
        visibility: "TEAM",
      },
    });
  }

  return root;
}

async function provisionDatabase({
  agentId,
  agentName,
  displayName,
  password,
  teamId,
  timezone,
  username,
  status,
}) {
  const existing = await prisma.user.findUnique({
    where: {
      username,
    },
    include: {
      agent: true,
    },
  });

  if (existing) {
    if (existing.teamId !== teamId) {
      throw new Error(
        `Existing user @${username} belongs to a different CyWorld team.`,
      );
    }

    if (
      existing.agent &&
      existing.agent.openclawAgentId !== agentId
    ) {
      throw new Error(
        `Existing user @${username} is linked to OpenClaw agent ${existing.agent.openclawAgentId}.`,
      );
    }

    if (!existing.agent) {
      await prisma.agent.create({
        data: {
          displayName: agentName,
          openclawAgentId: agentId,
          userId: existing.id,
          workspacePath: storedWorkspacePathFor(agentId),
        },
      });
    } else {
      await prisma.agent.update({
        where: { id: existing.agent.id },
        data: {
          displayName: agentName,
          workspacePath: storedWorkspacePathFor(agentId),
        },
      });
    }

    return {
      createdUser: false,
      userId: existing.id,
    };
  }

  if (!password || password.length < 8) {
    throw new Error(
      "New participants require CYWORLD_ONBOARD_PASSWORD with at least 8 characters.",
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      displayName,
      passwordHash,
      role: "PARTICIPANT",
      status: status === "invited" ? "INVITED" : "ACTIVE",
      teamId,
      timezone,
      username,
      agent: {
        create: {
          displayName: agentName,
          openclawAgentId: agentId,
          workspacePath: storedWorkspacePathFor(agentId),
        },
      },
    },
  });

  return {
    createdUser: true,
    userId: user.id,
  };
}

async function verifyParticipant(username, { agentId = username, status = "active" } = {}) {
  const user = await prisma.user.findUnique({
    where: {
      username,
    },
    include: {
      agent: true,
      roomMembers: {
        include: {
          room: true,
        },
      },
    },
  });
  const openclawAgents = await listOpenClawAgents();
  const openclawAgent = openclawAgents.find((agent) => agent.id === agentId);

  if (!user || !user.agent) {
    throw new Error(`CyWorld account or agent record is missing for @${username}.`);
  }

  if (!openclawAgent) {
    throw new Error(`OpenClaw agent is missing for @${username}.`);
  }

  const personalFolder = await prisma.fileRecord.findUnique({
    where: {
      systemKey: `personals:${user.id}`,
    },
  });
  const personalAccess =
    personalFolder?.accessConfigJson &&
    typeof personalFolder.accessConfigJson === "object"
      ? personalFolder.accessConfigJson
      : null;
  const personalKeys = Array.isArray(personalAccess?.participantKeys)
    ? personalAccess.participantKeys
    : [];
  const generalMembership = user.roomMembers.find(
    (membership) =>
      membership.room.name === "General" && membership.room.type === "TEAM",
  );
  const generalAgentMembership = generalMembership
    ? await prisma.roomAgent.findUnique({
        where: {
          roomId_agentId: {
            agentId: user.agent.id,
            roomId: generalMembership.roomId,
          },
        },
      })
    : null;
  const workspace = expandHome(user.agent.workspacePath);
  const requiredFiles = [
    "AGENTS.md",
    "BOOTSTRAP.md",
    "HEARTBEAT.md",
    "IDENTITY.md",
    "SOUL.md",
    "TOOLS.md",
    "USER.md",
    "WORKLOG.md",
    ...(status === "active"
      ? [path.join("CYWORLD_DRIVE", "MANIFEST.md")]
      : []),
  ];
  const missingFiles = [];

  for (const file of requiredFiles) {
    try {
      await access(path.join(workspace, file));
    } catch {
      missingFiles.push(file);
    }
  }

  const checks = {
    account: user.status === (status === "invited" ? "INVITED" : "ACTIVE"),
    agentDatabaseLink: user.agent.openclawAgentId === agentId,
    generalAgentMembership:
      status === "invited" ? !generalAgentMembership : Boolean(generalAgentMembership),
    generalHumanMembership:
      status === "invited" ? !generalMembership : Boolean(generalMembership),
    openclawAgent: openclawAgent.workspace === workspace,
    personalDrive:
      status === "invited"
        ? !personalFolder
        : Boolean(personalFolder) &&
          personalKeys.includes(`user:${user.id}`) &&
          personalKeys.includes(`agent:${user.agent.id}`),
    workspaceFiles: missingFiles.length === 0,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  console.log(`Onboarding verification for @${username}:`);
  for (const [name, passed] of Object.entries(checks)) {
    console.log(`- ${passed ? "PASS" : "FAIL"} ${name}`);
  }

  if (missingFiles.length > 0) {
    console.log(`- Missing workspace files: ${missingFiles.join(", ")}`);
  }

  if (failed.length > 0) {
    throw new Error(`Onboarding verification failed: ${failed.join(", ")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  validateUsername(args.username);
  const agentId = args.agentId || args.username;
  validateUsername(agentId);

  if (args.status !== "active" && args.status !== "invited") {
    throw new Error("--status must be active or invited.");
  }

  if (args.verifyOnly) {
    await verifyParticipant(args.username, { agentId, status: args.status });
    return;
  }

  if (!args.displayName) {
    throw new Error("--display-name is required.");
  }

  validateTimezone(args.timezone);

  const team = await resolveTeam(args.teamName);
  const existingUser = await prisma.user.findUnique({
    where: {
      username: args.username,
    },
    include: {
      agent: true,
    },
  });
  const existingMarker = await readOnboardingMarker(agentId);
  const initializeOwnerFiles =
    args.initializeOwnerFiles ||
    existingMarker?.initializeOwnerFiles === true ||
    !existingUser;
  const openclawAgents = await listOpenClawAgents();
  let openclawAgent = openclawAgents.find(
    (agent) => agent.id === agentId,
  );
  const model =
    args.model ||
    openclawAgents.find((agent) => agent.id !== "main")?.model ||
    openclawAgents.find((agent) => agent.id === "main")?.model;

  if (!model) {
    throw new Error("Could not infer an OpenClaw model. Pass --model.");
  }

  if (!openclawAgent) {
    console.log(`Creating OpenClaw agent -> ${agentId}`);
    await run("openclaw", [
      "agents",
      "add",
      agentId,
      "--workspace",
      workspacePathFor(agentId),
      "--model",
      model,
      "--non-interactive",
      "--json",
    ]);
    openclawAgent = (await listOpenClawAgents()).find(
      (agent) => agent.id === agentId,
    );
  }

  if (!openclawAgent) {
    throw new Error(`OpenClaw agent creation did not register ${agentId}.`);
  }

  if (openclawAgent.workspace !== workspacePathFor(agentId)) {
    throw new Error(
      `OpenClaw agent ${agentId} uses unexpected workspace ${openclawAgent.workspace}.`,
    );
  }

  await writeOnboardingMarker(agentId, {
    initializeOwnerFiles,
    startedAt: existingMarker?.startedAt || new Date().toISOString(),
    username: args.username,
  });

  const agentName =
    args.agentName || `${args.displayName} Agent`;
  const { createdUser } = await provisionDatabase({
    agentId,
    agentName,
    displayName: args.displayName,
    password: process.env.CYWORLD_ONBOARD_PASSWORD?.trim(),
    teamId: team.id,
    timezone: args.timezone,
    username: args.username,
    status: args.status,
  });

  console.log(`CyWorld account -> ${createdUser ? "created" : "already present"}`);
  if (args.status === "active") {
    console.log("Initializing General channel and personal Drive folders...");
    await ensureGeneralChannel(team.id);
    await ensurePersonalFolders(team.id);
  }

  const scaffoldArgs = ["scripts/sync-study-console-workflow.mjs", "--agent", agentId];

  if (initializeOwnerFiles) {
    scaffoldArgs.push("--initialize-agent", agentId);
  }

  console.log("Applying CyWorld agent scaffold...");
  await run(process.execPath, scaffoldArgs);

  if (args.status === "active") {
    console.log("Synchronizing CyWorld Drive...");
    await run(process.execPath, [
      "scripts/sync-hyungjun-study-files.mjs",
      "--agent",
      agentId,
    ]);
  }

  if (!args.skipGatewayRestart) {
    console.log("Restarting OpenClaw gateway...");
    await run("openclaw", ["gateway", "restart"]);
  }

  await verifyParticipant(args.username, { agentId, status: args.status });
  await rm(onboardingMarkerPath(agentId), { force: true });
  console.log(`Participant onboarding complete -> @${args.username}`);
  console.log("Next: have the participant sign in and complete BOOTSTRAP.md with their agent.");
}

main()
  .catch((error) => {
    console.error(`Onboarding stopped: ${error.message}`);
    console.error("Fix the reported issue, then rerun the same command to resume safely.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
