import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const prisma = new PrismaClient();
const TARGET_USERNAME = "hyungjun";
const OPENCLAW_ROOT = path.join(os.homedir(), ".openclaw");
const STUDY_FILES_DIRNAME = "CYWORLD_DRIVE";
const MANAGED_INDEX = ".study-console-managed.json";
const FILES_MANAGED_START = "<!-- BEGIN:study-console-files -->";
const FILES_MANAGED_END = "<!-- END:study-console-files -->";
const SYNC_MTIME_TOLERANCE_MS = 1500;

const agentsFilesBlock = `${FILES_MANAGED_START}
## CyWorld Drive

CyWorld has a Google Drive-like shared file area called **CyWorld Drive**. In conversation, users may call it "Drive", "CyWorld Drive", "the shared folder", "shared files", "the interface files", "directory", or a visible path such as \`/home/Onboarding\`.

For this agent, CyWorld Drive is mirrored into this OpenClaw workspace at:

- Workspace root: \`${STUDY_FILES_DIRNAME}/\`
- Manifest: \`${STUDY_FILES_DIRNAME}/MANIFEST.md\`

Before answering requests about shared files or folders:
1. Read \`${STUDY_FILES_DIRNAME}/MANIFEST.md\`.
2. Match the user's wording to the UI path shown in the manifest.
3. Use the mirrored workspace path when you need to read or edit accessible files.
4. Respect the access state shown in the manifest.

Access language:
- \`view/edit\`: you may read and modify the mirrored file or folder.
- \`no access\`: you may mention that the folder exists only if it appears in the manifest, but you must not claim to know its contents.
- \`system-managed\`: access is controlled by the Study Console app and should not be bypassed.

When you create, edit, rename, or delete files under \`${STUDY_FILES_DIRNAME}/\`, the CyWorld Drive sync job can import those changes back into the web app. Do not edit \`${STUDY_FILES_DIRNAME}/MANIFEST.md\` to change permissions; permissions come from the app.

Important file policy:
- CyWorld Drive is a shared drive, not a live collaborative editor.
- If you revise an existing file, the sync job will upload your revision as a new file instead of replacing the original.
- Prefer naming revised outputs clearly, such as \`Original Name - HyungjunBot revision.ext\` or \`Original Name - edited by HyungjunBot.ext\`.
- Only delete or rename files when the user clearly asked you to change the shared drive entry itself.

If a user refers to a folder that is not listed in the manifest, say you cannot find it in the visible CyWorld Drive. If a folder is listed as no access, say you can see that it exists but do not have access to its contents.
${FILES_MANAGED_END}`;

const toolsFilesBlock = `${FILES_MANAGED_START}
### CyWorld Drive

Use \`${STUDY_FILES_DIRNAME}/MANIFEST.md\` as the source of truth for CyWorld Drive.

Canonical terms:
- CyWorld Drive: the web app's shared file workspace
- Drive tab: the web app tab where humans browse CyWorld Drive
- UI path: the path the human sees, such as \`/home/Onboarding\`
- Workspace path: the mirrored local path under \`${STUDY_FILES_DIRNAME}/\`
- Participants with access: humans and agents who can access that folder
- Personal folder: a system-managed folder for a human and that human's own agent
- Replace file: upload a new version over an existing file

Sync behavior:
- Existing mirrored files you edit are imported back into the web app as new files, not replacements.
- New files or folders you create inside an accessible mirrored folder can be imported back into the web app.
- Renamed mirrored files or folders can be imported back into the web app when the sync job can identify the rename safely.
- Deleted mirrored files or folders can be deleted from the web app on the next sync. Be careful with destructive file changes.

Do not look for CyWorld Drive files outside \`${STUDY_FILES_DIRNAME}/\` unless the user explicitly asks about non-CyWorld/OpenClaw workspace files.
${FILES_MANAGED_END}`;

function storageRoot() {
  return (
    process.env.FILES_STORAGE_DIR?.trim() ||
    path.join(process.cwd(), ".data", "uploads")
  );
}

function expandHome(input) {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

function replaceManagedBlock(source, block) {
  const pattern = new RegExp(`${FILES_MANAGED_START}[\\s\\S]*?${FILES_MANAGED_END}`, "m");

  if (pattern.test(source)) {
    return source.replace(pattern, block);
  }

  const trimmed = source.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseAccessConfig(input) {
  if (!input || typeof input !== "object") {
    return { participantKeys: [], systemManaged: false };
  }

  const maybeKeys = input.participantKeys;

  return {
    participantKeys: Array.isArray(maybeKeys)
      ? maybeKeys.filter((value) => typeof value === "string" && value.length > 0)
      : [],
    systemManaged: Boolean(input.systemManaged),
  };
}

function hasAccess(accessConfig, participantKey) {
  if (accessConfig.participantKeys.length === 0) {
    return true;
  }

  return accessConfig.participantKeys.includes(participantKey);
}

function sanitizePathSegment(segment) {
  return (
    segment
      .replace(/[/:\\]+/g, "-")
      .replace(/[^\w.\- ()]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "untitled"
  );
}

function sanitizeFilename(filename) {
  return filename.replace(/[^\w.\- ]+/g, "-").replace(/\s+/g, " ").trim() || "untitled";
}

function splitFilename(filename) {
  const extension = path.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;

  return {
    extension,
    stem: stem || "untitled",
  };
}

async function uniqueFilename(parentId, baseFilename) {
  const existing = await prisma.fileRecord.findMany({
    where: {
      parentId,
    },
    select: {
      filename: true,
    },
  });
  const existingNames = new Set(existing.map((entry) => entry.filename));

  if (!existingNames.has(baseFilename)) {
    return baseFilename;
  }

  const { extension, stem } = splitFilename(baseFilename);

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} (${index})${extension}`;

    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }

  return `${stem} (${Date.now()})${extension}`;
}

async function agentRevisionFilename(parentId, originalFilename, agentDisplayName) {
  const { extension, stem } = splitFilename(originalFilename);
  const base = sanitizeFilename(`${stem} - ${agentDisplayName} revision${extension}`);

  return uniqueFilename(parentId, base);
}

function serializeAccessConfig(config) {
  return {
    participantKeys: [...new Set(config.participantKeys ?? [])].sort(),
    systemManaged: Boolean(config.systemManaged),
  };
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function participantLabel(participantKey, participantsByKey) {
  const participant = participantsByKey.get(participantKey);

  if (!participant) {
    return participantKey;
  }

  if (participant.kind === "agent") {
    return `${participant.name} (${participant.meta})`;
  }

  return `${participant.name} (@${participant.username})`;
}

async function listParticipants(teamId) {
  const users = await prisma.user.findMany({
    where: {
      teamId,
      status: "ACTIVE",
    },
    orderBy: {
      displayName: "asc",
    },
    include: {
      agent: true,
    },
  });

  const participants = [];

  for (const user of users) {
    participants.push({
      id: user.id,
      key: `user:${user.id}`,
      kind: "user",
      meta: `@${user.username}`,
      name: user.displayName,
      username: user.username,
    });

    if (user.agent) {
      participants.push({
        id: user.agent.id,
        key: `agent:${user.agent.id}`,
        kind: "agent",
        meta: `${user.username}'s agent`,
        name: user.agent.displayName || `${user.username}'s agent`,
        username: `${user.username}-agent`,
      });
    }
  }

  return participants;
}

function buildRecordMaps(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const childrenByParentId = new Map();

  for (const record of records) {
    const parentKey = record.parentId ?? "__home__";
    const children = childrenByParentId.get(parentKey) ?? [];
    children.push(record);
    childrenByParentId.set(parentKey, children);
  }

  for (const children of childrenByParentId.values()) {
    children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) {
        return a.isFolder ? -1 : 1;
      }

      return a.filename.localeCompare(b.filename);
    });
  }

  return { byId, childrenByParentId };
}

function accessStateForRecord(record, inheritedAccess, agentParticipantKey) {
  const ownAccess = parseAccessConfig(record.accessConfigJson);
  const parentAllows = inheritedAccess === "view/edit";
  const ownAllows = hasAccess(ownAccess, agentParticipantKey);

  if (!parentAllows || !ownAllows) {
    return "no access";
  }

  return "view/edit";
}

function accessParticipantsForRecord(record, participants, participantsByKey) {
  const access = parseAccessConfig(record.accessConfigJson);

  if (access.participantKeys.length === 0) {
    return participants.map((participant) => participantLabel(participant.key, participantsByKey));
  }

  return access.participantKeys.map((key) => participantLabel(key, participantsByKey));
}

async function loadManagedIndex(studyFilesRoot) {
  try {
    const raw = await readFile(path.join(studyFilesRoot, MANAGED_INDEX), "utf8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readWorkspaceTree(root, relativeRoot = "") {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await readdir(path.join(root, relativeRoot), {
    withFileTypes: true,
  });
  const results = [];

  for (const entry of entries) {
    if (entry.name === "MANIFEST.md" || entry.name === MANAGED_INDEX) {
      continue;
    }

    const relativePath = path.join(relativeRoot, entry.name);

    if (entry.isDirectory()) {
      results.push({
        kind: "folder",
        relativePath,
      });
      results.push(...(await readWorkspaceTree(root, relativePath)));
      continue;
    }

    if (entry.isFile()) {
      results.push({
        kind: "file",
        relativePath,
      });
    }
  }

  return results;
}

function getParentRelativePath(relativePath) {
  const parent = path.dirname(relativePath);
  return parent === "." ? "" : parent;
}

function filenameFromRelativePath(relativePath) {
  return path.basename(relativePath);
}

function extensionOf(relativePath) {
  return path.extname(relativePath).toLowerCase();
}

function relativeDepth(relativePath) {
  return relativePath.split(path.sep).filter(Boolean).length;
}

function isSamePathOrChild(relativePath, possibleParentPath) {
  return (
    relativePath === possibleParentPath ||
    relativePath.startsWith(`${possibleParentPath}${path.sep}`)
  );
}

function remapRelativePath(relativePath, mappings) {
  for (const mapping of mappings) {
    if (relativePath === mapping.oldPrefix) {
      return mapping.newPrefix;
    }

    if (relativePath.startsWith(`${mapping.oldPrefix}${path.sep}`)) {
      return `${mapping.newPrefix}${relativePath.slice(mapping.oldPrefix.length)}`;
    }
  }

  return relativePath;
}

function remapPreviousEntries(previousEntries, mappings) {
  if (mappings.length === 0) {
    return previousEntries;
  }

  return previousEntries.map((entry) => {
    if (typeof entry.relativePath !== "string") {
      return entry;
    }

    return {
      ...entry,
      relativePath: remapRelativePath(entry.relativePath, mappings),
    };
  });
}

function canAgentModifyRecord(record, agentParticipantKey) {
  if (!record) {
    return false;
  }

  if (record.systemKey) {
    return false;
  }

  return hasAccess(parseAccessConfig(record.accessConfigJson), agentParticipantKey);
}

function findRenameCandidate({
  missingEntry,
  newEntries,
  consumedNewPrefixes,
}) {
  const parentPath = getParentRelativePath(missingEntry.relativePath);
  const candidates = newEntries.filter((entry) => {
    if (entry.kind !== missingEntry.kind) {
      return false;
    }

    if (getParentRelativePath(entry.relativePath) !== parentPath) {
      return false;
    }

    if (
      [...consumedNewPrefixes].some((prefix) =>
        isSamePathOrChild(entry.relativePath, prefix),
      )
    ) {
      return false;
    }

    if (missingEntry.kind === "file") {
      return extensionOf(entry.relativePath) === extensionOf(missingEntry.relativePath);
    }

    return true;
  });

  return candidates.length === 1 ? candidates[0] : null;
}

async function applyWorkspaceRenames({
  agent,
  agentParticipantKey,
  currentTree,
  previousEntries,
  recordsById,
}) {
  const previousManagedEntries = previousEntries.filter(
    (entry) =>
      (entry.kind === "file" || entry.kind === "folder") &&
      typeof entry.relativePath === "string" &&
      typeof entry.fileRecordId === "string",
  );
  const previousPathSet = new Set(previousManagedEntries.map((entry) => entry.relativePath));
  const currentPathSet = new Set(currentTree.map((entry) => entry.relativePath));
  const newEntries = currentTree.filter((entry) => !previousPathSet.has(entry.relativePath));
  const missingEntries = previousManagedEntries
    .filter((entry) => !currentPathSet.has(entry.relativePath))
    .sort((a, b) => relativeDepth(a.relativePath) - relativeDepth(b.relativePath));
  const consumedMissingPrefixes = new Set();
  const consumedNewPrefixes = new Set();
  const logs = [];
  const mappings = [];

  for (const missingEntry of missingEntries) {
    if (
      [...consumedMissingPrefixes].some((prefix) =>
        isSamePathOrChild(missingEntry.relativePath, prefix),
      )
    ) {
      continue;
    }

    const record = recordsById.get(missingEntry.fileRecordId);

    if (!canAgentModifyRecord(record, agentParticipantKey)) {
      continue;
    }

    const candidate = findRenameCandidate({
      missingEntry,
      newEntries,
      consumedNewPrefixes,
    });

    if (!candidate) {
      continue;
    }

    const nextName = sanitizeFilename(filenameFromRelativePath(candidate.relativePath));

    await prisma.fileRecord.update({
      where: {
        id: record.id,
      },
      data: {
        filename: nextName,
      },
    });

    mappings.push({
      oldPrefix: missingEntry.relativePath,
      newPrefix: candidate.relativePath,
    });
    consumedMissingPrefixes.add(missingEntry.relativePath);
    consumedNewPrefixes.add(candidate.relativePath);
    logs.push(
      `${agent.openclawAgentId}: renamed ${missingEntry.relativePath} -> ${candidate.relativePath}`,
    );
  }

  return {
    logs,
    previousEntries: remapPreviousEntries(previousEntries, mappings),
  };
}

async function collectFolderIds(folderId) {
  const childFolders = await prisma.fileRecord.findMany({
    where: {
      parentId: folderId,
      isFolder: true,
    },
    select: {
      id: true,
    },
  });
  const nested = await Promise.all(
    childFolders.map((folder) => collectFolderIds(folder.id)),
  );

  return [folderId, ...nested.flat()];
}

async function deleteRecordFromApp(record, storageRootPath) {
  if (record.isFolder) {
    const folderIds = await collectFolderIds(record.id);
    const files = await prisma.fileRecord.findMany({
      where: {
        parentId: {
          in: folderIds,
        },
        isFolder: false,
      },
      select: {
        storageKey: true,
      },
    });

    await Promise.all(
      files.map((file) => rm(path.join(storageRootPath, file.storageKey), { force: true })),
    );
    await prisma.fileRecord.deleteMany({
      where: {
        OR: [
          {
            id: {
              in: folderIds,
            },
          },
          {
            parentId: {
              in: folderIds,
            },
          },
        ],
      },
    });
    return;
  }

  await rm(path.join(storageRootPath, record.storageKey), { force: true });
  await prisma.fileRecord.delete({
    where: {
      id: record.id,
    },
  });
}

async function applyWorkspaceDeletes({
  agent,
  agentParticipantKey,
  currentTree,
  previousEntries,
  recordsById,
  storageRootPath,
}) {
  const currentPathSet = new Set(currentTree.map((entry) => entry.relativePath));
  const missingEntries = previousEntries
    .filter(
      (entry) =>
        (entry.kind === "file" || entry.kind === "folder") &&
        typeof entry.relativePath === "string" &&
        typeof entry.fileRecordId === "string" &&
        !currentPathSet.has(entry.relativePath),
    )
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }

      return relativeDepth(a.relativePath) - relativeDepth(b.relativePath);
    });
  const deletedPrefixes = new Set();
  const logs = [];

  for (const entry of missingEntries) {
    if ([...deletedPrefixes].some((prefix) => isSamePathOrChild(entry.relativePath, prefix))) {
      continue;
    }

    const record = recordsById.get(entry.fileRecordId);

    if (!canAgentModifyRecord(record, agentParticipantKey)) {
      continue;
    }

    await deleteRecordFromApp(record, storageRootPath);
    logs.push(`${agent.openclawAgentId}: deleted ${entry.relativePath}`);

    if (entry.kind === "folder") {
      deletedPrefixes.add(entry.relativePath);
    }
  }

  return logs;
}

async function syncExistingWorkspaceEdits({
  agent,
  agentParticipantKey,
  previousEntries,
  recordsById,
  storageRootPath,
  studyFilesRoot,
}) {
  const synced = [];

  for (const entry of previousEntries) {
    if (entry.kind !== "file" || typeof entry.fileRecordId !== "string") {
      continue;
    }

    const record = recordsById.get(entry.fileRecordId);

    if (!record || record.isFolder) {
      continue;
    }

    const accessConfig = parseAccessConfig(record.accessConfigJson);

    if (!hasAccess(accessConfig, agentParticipantKey)) {
      continue;
    }

    const localPath = path.join(studyFilesRoot, entry.relativePath);

    if (!(await pathExists(localPath))) {
      continue;
    }

    const localStat = await stat(localPath);
    const lastMirroredMtimeMs = Number(entry.mirroredMtimeMs ?? 0);

    if (lastMirroredMtimeMs && localStat.mtimeMs <= lastMirroredMtimeMs + SYNC_MTIME_TOLERANCE_MS) {
      continue;
    }

    const nextFilename = await agentRevisionFilename(
      record.parentId,
      record.filename,
      agent.displayName || agent.openclawAgentId,
    );
    const recordId = randomUUID();
    const storageKey = `${recordId}-${nextFilename}`;

    await copyFile(localPath, path.join(storageRootPath, storageKey));
    await prisma.fileRecord.create({
      data: {
        id: recordId,
        ownerUserId: agent.userId,
        teamId: record.teamId,
        parentId: record.parentId,
        filename: nextFilename,
        storageKey,
        mimeType: record.mimeType,
        sizeBytes: localStat.size,
        visibility: "TEAM",
        sourceType: "AGENT_REVISION_FILE",
        accessConfigJson: record.accessConfigJson ?? undefined,
      },
    });

    synced.push(`${agent.openclawAgentId}: created revision ${nextFilename} from ${entry.relativePath}`);
  }

  return synced;
}

async function createRecordsForNewWorkspaceEntries({
  agent,
  agentParticipantKey,
  previousEntries,
  recordsById,
  storageRootPath,
  studyFilesRoot,
  teamId,
  userId,
  workspaceTree,
}) {
  const previousPathSet = new Set(
    previousEntries
      .filter((entry) => typeof entry.relativePath === "string")
      .map((entry) => entry.relativePath),
  );
  const previousByPath = new Map(
    previousEntries
      .filter((entry) => typeof entry.relativePath === "string")
      .map((entry) => [entry.relativePath, entry]),
  );
  const tree = workspaceTree;
  const createdEntries = [];
  const logs = [];

  tree.sort((a, b) => {
    const depthA = a.relativePath.split(path.sep).length;
    const depthB = b.relativePath.split(path.sep).length;

    if (depthA !== depthB) {
      return depthA - depthB;
    }

    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }

    return a.relativePath.localeCompare(b.relativePath);
  });

  for (const entry of tree) {
    if (previousPathSet.has(entry.relativePath)) {
      continue;
    }

    const parentRelativePath = getParentRelativePath(entry.relativePath);
    const parentEntry =
      parentRelativePath === ""
        ? null
        : previousByPath.get(parentRelativePath) ??
          createdEntries.find((candidate) => candidate.relativePath === parentRelativePath);

    if (parentRelativePath !== "" && !parentEntry?.fileRecordId) {
      continue;
    }

    const parentRecord = parentEntry?.fileRecordId
      ? recordsById.get(parentEntry.fileRecordId) ??
        (await prisma.fileRecord.findUnique({
          where: {
            id: parentEntry.fileRecordId,
          },
        }))
      : null;
    const parentAccess = parentRecord
      ? parseAccessConfig(parentRecord.accessConfigJson)
      : { participantKeys: [] };

    if (parentRecord && !hasAccess(parentAccess, agentParticipantKey)) {
      continue;
    }

    const participantKeys =
      parentAccess.participantKeys.length > 0
        ? parentAccess.participantKeys
        : [agentParticipantKey, `user:${userId}`];
    const filename = sanitizeFilename(filenameFromRelativePath(entry.relativePath));
    const absolutePath = path.join(studyFilesRoot, entry.relativePath);

    if (entry.kind === "folder") {
      const createdFolder = await prisma.fileRecord.create({
        data: {
          ownerUserId: userId,
          teamId,
          parentId: parentRecord?.id ?? null,
          filename,
          storageKey: `folder:${randomUUID()}`,
          isFolder: true,
          visibility: "TEAM",
          sourceType: "AGENT_CREATED_FOLDER",
          accessConfigJson: serializeAccessConfig({
            participantKeys,
          }),
        },
      });

      recordsById.set(createdFolder.id, createdFolder);
      const createdEntry = {
        fileRecordId: createdFolder.id,
        kind: "folder",
        relativePath: entry.relativePath,
      };
      createdEntries.push(createdEntry);
      previousByPath.set(entry.relativePath, createdEntry);
      logs.push(`${agent.openclawAgentId}: created folder ${entry.relativePath}`);
      continue;
    }

    const localStat = await stat(absolutePath);
    const recordId = randomUUID();
    const storageKey = `${recordId}-${filename}`;

    await copyFile(absolutePath, path.join(storageRootPath, storageKey));

    const createdFile = await prisma.fileRecord.create({
      data: {
        id: recordId,
        ownerUserId: userId,
        teamId,
        parentId: parentRecord?.id ?? null,
        filename,
        storageKey,
        mimeType: null,
        sizeBytes: localStat.size,
        visibility: "TEAM",
        sourceType: "AGENT_CREATED_FILE",
        accessConfigJson: serializeAccessConfig({
          participantKeys,
        }),
      },
    });

    recordsById.set(createdFile.id, createdFile);
    const createdEntry = {
      fileRecordId: createdFile.id,
      kind: "file",
      relativePath: entry.relativePath,
    };
    createdEntries.push(createdEntry);
    previousByPath.set(entry.relativePath, createdEntry);
    logs.push(`${agent.openclawAgentId}: created file ${entry.relativePath}`);
  }

  return logs;
}

async function importWorkspaceChanges({
  agent,
  agentParticipantKey,
  previousEntries,
  recordsById,
  storageRootPath,
  studyFilesRoot,
  teamId,
  userId,
}) {
  const workspaceTree = await readWorkspaceTree(studyFilesRoot, "home");
  const renameResult = await applyWorkspaceRenames({
    agent,
    agentParticipantKey,
    currentTree: workspaceTree,
    previousEntries,
    recordsById,
  });
  const nextPreviousEntries = renameResult.previousEntries;
  const deleted = await applyWorkspaceDeletes({
    agent,
    agentParticipantKey,
    currentTree: workspaceTree,
    previousEntries: nextPreviousEntries,
    recordsById,
    storageRootPath,
  });
  const updated = await syncExistingWorkspaceEdits({
    agent,
    agentParticipantKey,
    previousEntries: nextPreviousEntries,
    recordsById,
    storageRootPath,
    studyFilesRoot,
  });
  const created = await createRecordsForNewWorkspaceEntries({
    agent,
    agentParticipantKey,
    previousEntries: nextPreviousEntries,
    recordsById,
    storageRootPath,
    studyFilesRoot,
    teamId,
    userId,
    workspaceTree,
  });

  return [...renameResult.logs, ...deleted, ...updated, ...created];
}

async function removeStaleManagedEntries(studyFilesRoot, previousEntries, nextRelativePaths) {
  const nextPaths = new Set(nextRelativePaths);

  await Promise.all(
    previousEntries
      .filter((entry) => typeof entry.relativePath === "string")
      .filter((entry) => !nextPaths.has(entry.relativePath))
      .map((entry) =>
        rm(path.join(studyFilesRoot, entry.relativePath), {
          force: true,
          recursive: true,
        }),
      ),
  );
}

async function mirrorTree({
  childrenByParentId,
  currentParentId,
  inheritedAccess,
  manifestLines,
  nextManagedEntries,
  participants,
  participantsByKey,
  relativeParentPath,
  storageRootPath,
  studyFilesRoot,
  uiParentPath,
  workspaceParentPath,
  agentParticipantKey,
}) {
  const children = childrenByParentId.get(currentParentId ?? "__home__") ?? [];
  const usedSegments = new Map();

  for (const record of children) {
    const accessState = accessStateForRecord(record, inheritedAccess, agentParticipantKey);
    const baseSegment = sanitizePathSegment(record.filename);
    const count = usedSegments.get(baseSegment) ?? 0;
    usedSegments.set(baseSegment, count + 1);
    const segment = count === 0 ? baseSegment : `${baseSegment} (${record.id.slice(0, 6)})`;
    const uiPath = `${uiParentPath}/${record.filename}`.replace(/\/+/g, "/");
    const relativePath = path.join(relativeParentPath, segment);
    const workspacePath = `${workspaceParentPath}/${segment}`.replace(/\/+/g, "/");
    const accessConfig = parseAccessConfig(record.accessConfigJson);
    const participantsWithAccess = accessParticipantsForRecord(
      record,
      participants,
      participantsByKey,
    );

    manifestLines.push(`### ${uiPath}`);
    manifestLines.push(`- Type: ${record.isFolder ? "folder" : "file"}`);
    manifestLines.push(`- Access: ${accessState}`);
    manifestLines.push(`- Workspace path: ${accessState === "view/edit" ? workspacePath : "(not mirrored)"}`);
    manifestLines.push(`- Created: ${record.owner?.displayName ?? "Unknown"}, ${formatDate(record.createdAt)}`);
    manifestLines.push(`- Updated: ${record.owner?.displayName ?? "Unknown"}, ${formatDate(record.updatedAt)}`);

    if (accessConfig.systemManaged) {
      manifestLines.push("- System-managed: yes");
    }

    manifestLines.push("- Participants with access:");

    for (const participant of participantsWithAccess) {
      manifestLines.push(`  - ${participant}`);
    }

    manifestLines.push("");

    if (accessState !== "view/edit") {
      continue;
    }

    const destination = path.join(studyFilesRoot, relativePath);

    if (record.isFolder) {
      await mkdir(destination, { recursive: true });
      const folderStat = await stat(destination);
      nextManagedEntries.push({
        fileRecordId: record.id,
        kind: "folder",
        mirroredMtimeMs: folderStat.mtimeMs,
        relativePath,
        storageKey: record.storageKey,
        updatedAt: record.updatedAt.toISOString(),
      });

      await mirrorTree({
        childrenByParentId,
        currentParentId: record.id,
        inheritedAccess: accessState,
        manifestLines,
        nextManagedEntries,
        participants,
        participantsByKey,
        relativeParentPath: relativePath,
        storageRootPath,
        studyFilesRoot,
        uiParentPath: uiPath,
        workspaceParentPath: workspacePath,
        agentParticipantKey,
      });

      continue;
    }

    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(storageRootPath, record.storageKey), destination);
    const fileStat = await stat(destination);
    nextManagedEntries.push({
      fileRecordId: record.id,
      kind: "file",
      mirroredMtimeMs: fileStat.mtimeMs,
      relativePath,
      storageKey: record.storageKey,
      updatedAt: record.updatedAt.toISOString(),
    });
  }
}

async function syncAgentMarkdown(workspacePath) {
  const files = [
    ["AGENTS.md", agentsFilesBlock],
    ["TOOLS.md", toolsFilesBlock],
  ];

  for (const [fileName, block] of files) {
    const filePath = path.join(workspacePath, fileName);
    const existing = await readTextIfExists(filePath);
    await writeFile(filePath, replaceManagedBlock(existing, block), "utf8");
  }
}

async function main() {
  const user = await prisma.user.findUnique({
    where: {
      username: TARGET_USERNAME,
    },
    include: {
      agent: true,
    },
  });

  if (!user?.agent) {
    throw new Error(`No agent found for ${TARGET_USERNAME}.`);
  }

  const workspacePath = expandHome(
    user.agent.workspacePath || path.join(OPENCLAW_ROOT, `workspace-${user.agent.openclawAgentId}`),
  );
  const studyFilesRoot = path.join(workspacePath, STUDY_FILES_DIRNAME);
  const homeRoot = path.join(studyFilesRoot, "home");
  const agentParticipantKey = `agent:${user.agent.id}`;
  const participants = await listParticipants(user.teamId);
  const participantsByKey = new Map(participants.map((participant) => [participant.key, participant]));
  const previousEntries = await loadManagedIndex(studyFilesRoot);
  const recordQuery = {
    where: {
      OR: [
        {
          teamId: user.teamId,
        },
        {
          teamId: null,
        },
      ],
    },
    orderBy: [{ isFolder: "desc" }, { filename: "asc" }],
    include: {
      owner: {
        select: {
          displayName: true,
        },
      },
    },
  };

  let records = await prisma.fileRecord.findMany(recordQuery);
  let { byId: recordsById, childrenByParentId } = buildRecordMaps(records);
  const manifestLines = [
    "# CyWorld Drive Manifest",
    "",
    "This folder mirrors CyWorld Drive, the shared file area in the CyWorld web app.",
    "",
    "## How to read this manifest",
    "",
    "- UI path is the path the human sees in the web app.",
    "- Workspace path is the local mirrored path this agent can use.",
    "- If Access is `no access`, do not claim to know the folder or file contents.",
    "- Users may call this CyWorld Drive, Drive, the shared folder, shared files, interface files, or a visible path such as `/home/Onboarding`.",
    "",
    "## Root",
    "",
    "- UI path: /home",
    `- Workspace path: ${STUDY_FILES_DIRNAME}/home`,
    "- Access: view/edit",
    "",
    "## Entries",
    "",
  ];
  const nextManagedEntries = [];

  await mkdir(homeRoot, { recursive: true });
  await syncAgentMarkdown(workspacePath);

  const importedChanges = await importWorkspaceChanges({
    agent: user.agent,
    agentParticipantKey,
    previousEntries,
    recordsById,
    storageRootPath: storageRoot(),
    studyFilesRoot,
    teamId: user.teamId,
    userId: user.id,
  });

  if (importedChanges.length > 0) {
    records = await prisma.fileRecord.findMany(recordQuery);
    ({ childrenByParentId } = buildRecordMaps(records));
  }

  await mirrorTree({
    childrenByParentId,
    currentParentId: null,
    inheritedAccess: "view/edit",
    manifestLines,
    nextManagedEntries,
    participants,
    participantsByKey,
    relativeParentPath: "home",
    storageRootPath: storageRoot(),
    studyFilesRoot,
    uiParentPath: "/home",
    workspaceParentPath: `${STUDY_FILES_DIRNAME}/home`,
    agentParticipantKey,
  });

  const manifestPath = path.join(studyFilesRoot, "MANIFEST.md");
  await writeFile(manifestPath, `${manifestLines.join("\n")}\n`, "utf8");

  nextManagedEntries.push({
    fileRecordId: "__manifest__",
    kind: "manifest",
    relativePath: "MANIFEST.md",
    updatedAt: new Date().toISOString(),
  });

  await removeStaleManagedEntries(
    studyFilesRoot,
    previousEntries,
    nextManagedEntries.map((entry) => entry.relativePath),
  );

  await writeFile(
    path.join(studyFilesRoot, MANAGED_INDEX),
    `${JSON.stringify(
      {
        agent: user.agent.openclawAgentId,
        generatedAt: new Date().toISOString(),
        entries: nextManagedEntries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Synced CyWorld Drive for ${user.agent.openclawAgentId}`);
  console.log(`Workspace: ${studyFilesRoot}`);
  console.log(`Mirrored entries: ${nextManagedEntries.length - 1}`);
  if (importedChanges.length > 0) {
    console.log("Imported agent workspace changes:");
    for (const change of importedChanges) {
      console.log(`- ${change}`);
    }
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
