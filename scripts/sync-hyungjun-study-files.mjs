import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

const prisma = new PrismaClient();
const OPENCLAW_ROOT = path.join(os.homedir(), ".openclaw");
const STUDY_FILES_DIRNAME = "CYWORLD_DRIVE";
const MANAGED_INDEX = ".study-console-managed.json";
const QUARANTINE_DIRNAME = "_INVALID_CYWORLD_DRIVE_PATHS";
const FILES_MANAGED_START = "<!-- BEGIN:study-console-files -->";
const FILES_MANAGED_END = "<!-- END:study-console-files -->";
const SYNC_MTIME_TOLERANCE_MS = 1500;
const SYNC_LOCK_DIR = path.join(process.cwd(), ".data", "cyworld-drive-sync.lock");
const SYNC_LOCK_STALE_MS = 10 * 60 * 1000;
const SYNC_LOCK_WAIT_MS = 2 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSyncLock() {
  const deadline = Date.now() + SYNC_LOCK_WAIT_MS;

  await mkdir(path.dirname(SYNC_LOCK_DIR), { recursive: true });

  while (Date.now() < deadline) {
    try {
      await mkdir(SYNC_LOCK_DIR);
      await writeFile(
        path.join(SYNC_LOCK_DIR, "owner.json"),
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      try {
        const lockStat = await stat(SYNC_LOCK_DIR);

        if (Date.now() - lockStat.mtimeMs > SYNC_LOCK_STALE_MS) {
          await rm(SYNC_LOCK_DIR, { force: true, recursive: true });
          continue;
        }
      } catch (lockError) {
        if (lockError?.code !== "ENOENT") {
          throw lockError;
        }
      }

      await sleep(500);
    }
  }

  throw new Error("Timed out waiting for the CyWorld Drive sync lock.");
}

async function releaseSyncLock() {
  await rm(SYNC_LOCK_DIR, { force: true, recursive: true });
}

function targetAgentId() {
  if (process.argv.includes("--all")) {
    return "__all__";
  }

  const agentFlagIndex = process.argv.findIndex((arg) => arg === "--agent" || arg === "--agent-id");
  const agentFlagValue = agentFlagIndex >= 0 ? process.argv[agentFlagIndex + 1] : undefined;
  const positionalValue = process.argv
    .slice(2)
    .find((arg) => !arg.startsWith("-") && arg !== "--");

  return (
    agentFlagValue ||
    process.env.CYWORLD_DRIVE_SYNC_AGENT ||
    process.env.OPENCLAW_AGENT ||
    positionalValue ||
    "hyungjun"
  ).trim();
}

function buildAgentsFilesBlock({ agentDisplayName, username }) {
  return `${FILES_MANAGED_START}
## CyWorld Drive

CyWorld has a Google Drive-like shared file area called **CyWorld Drive**. Treat that as the canonical internal name, but do not require users to say it. They may describe an item indirectly, misspell its name, refer to "that PDF", "what I uploaded", "the shared thing", "my files", or use a visible path such as \`/Onboarding\`. Resolve the reference from conversation history and the manifest.

For ${agentDisplayName}, CyWorld Drive is mirrored into this OpenClaw workspace at:

- Workspace root: \`${STUDY_FILES_DIRNAME}/\`
- Manifest: \`${STUDY_FILES_DIRNAME}/MANIFEST.md\`

Critical path rule:
- CyWorld Drive root maps directly to \`${STUDY_FILES_DIRNAME}/\`.
- UI path \`/\` maps to \`${STUDY_FILES_DIRNAME}/\`.
- UI path \`/Personals/${username}\` maps to \`${STUDY_FILES_DIRNAME}/Personals/${username}\`.
- Do not invent or insert a \`home\` segment. \`${STUDY_FILES_DIRNAME}/home\` is a legacy path and is no longer the Drive root.

Before answering requests about shared files or folders:
1. Read \`${STUDY_FILES_DIRNAME}/MANIFEST.md\`.
2. Resolve the user's wording, pronouns, and recent conversational references against the UI paths shown in the manifest.
3. Use the exact mirrored workspace path from the manifest when you need to read or edit accessible files.
4. Respect the access state shown in the manifest.
5. If exactly one visible resource fits, use it. If several materially different resources fit, ask one concise clarification instead of guessing.

Access language:
- \`view/edit\`: you may read and modify the mirrored file or folder.
- \`no access\`: you may mention that the folder exists only if it appears in the manifest, but you must not claim to know its contents.
- \`system-managed\`: access is controlled by CyWorld and should not be bypassed.

When you create, edit, rename, or delete files under \`${STUDY_FILES_DIRNAME}/\`, the CyWorld Drive sync job can import those changes back into the web app. Do not edit \`${STUDY_FILES_DIRNAME}/MANIFEST.md\` to change permissions; permissions come from the app.

Important file policy:
- CyWorld Drive is a shared drive, not a live collaborative editor.
- If you revise an existing file, the sync job will upload your revision as a new file instead of replacing the original.
- Prefer naming revised outputs clearly, such as \`Original Name - ${agentDisplayName} revision.ext\` or \`Original Name - edited by ${agentDisplayName}.ext\`.
- Only delete or rename files when the user clearly asked you to change the shared drive entry itself.

If a user refers to a folder that is not listed in the manifest, say you cannot find it in the visible CyWorld Drive. If a folder is listed as no access, say you can see that it exists but do not have access to its contents.
${FILES_MANAGED_END}`;
}

function buildToolsFilesBlock({ username }) {
  return `${FILES_MANAGED_START}
### CyWorld Drive

Use \`${STUDY_FILES_DIRNAME}/MANIFEST.md\` as the source of truth for CyWorld Drive.

Canonical terms:
- CyWorld Drive: the web app's shared file workspace
- Drive tab: the web app tab where humans browse CyWorld Drive
- UI path: the path the human sees, such as \`/Onboarding\`
- Workspace path: the mirrored local path under \`${STUDY_FILES_DIRNAME}/\`
- Participants with access: humans and agents who can access that folder
- Personal folder: a system-managed folder for a human and that human's own agent
- Replace file: upload a new version over an existing file
- Registered Google file: one live Google Docs, Sheets, or Slides file represented by an entry in CyWorld Drive

Google file layers:
- CyWorld Drive controls the visible folder location, discovery, and CyWorld access for a registered Google file.
- Google Workspace stores and edits the live document content.
- The mirrored file under \`${STUDY_FILES_DIRNAME}/\` is a managed reference, not another editable copy of the Google document.
- "Drive" or the Drive tab normally means CyWorld Drive. "Google Drive" means Google's external storage service only when the user explicitly identifies it or provides a Google URL.

These terms standardize internal reasoning and documentation. They are not a vocabulary requirement for users.

Sync behavior:
- Existing mirrored files you edit are imported back into the web app as new files, not replacements.
- New files or folders you create inside an accessible mirrored folder can be imported back into the web app.
- Renamed mirrored files or folders can be imported back into the web app when the sync job can identify the rename safely.
- Deleted mirrored files or folders can be deleted from the web app on the next sync. Be careful with destructive file changes.

Path safety:
- CyWorld Drive root maps directly to \`${STUDY_FILES_DIRNAME}/\`.
- Use \`${STUDY_FILES_DIRNAME}/Personals/${username}\`, not \`${STUDY_FILES_DIRNAME}/home/Personals/${username}\`.
- \`${STUDY_FILES_DIRNAME}/home\` is a legacy path and should not be used.

Do not look for CyWorld Drive files outside \`${STUDY_FILES_DIRNAME}/\` unless the user explicitly asks about non-CyWorld/OpenClaw workspace files.
${FILES_MANAGED_END}`;
}

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
    createdByParticipantKey:
      typeof input.createdByParticipantKey === "string"
        ? input.createdByParticipantKey
        : undefined,
    participantKeys: Array.isArray(maybeKeys)
      ? maybeKeys.filter((value) => typeof value === "string" && value.length > 0)
      : [],
    systemManaged: Boolean(input.systemManaged),
    updatedByParticipantKey:
      typeof input.updatedByParticipantKey === "string"
        ? input.updatedByParticipantKey
        : undefined,
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

function mimeTypeForFilename(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case ".csv":
      return "text/csv";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".gif":
      return "image/gif";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".txt":
      return "text/plain";
    case ".webp":
      return "image/webp";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return null;
  }
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
    ...(config.createdByParticipantKey
      ? { createdByParticipantKey: config.createdByParticipantKey }
      : {}),
    participantKeys: [...new Set(config.participantKeys ?? [])].sort(),
    systemManaged: Boolean(config.systemManaged),
    ...(config.updatedByParticipantKey
      ? { updatedByParticipantKey: config.updatedByParticipantKey }
      : {}),
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

function normalizeManagedRelativePath(relativePath) {
  if (relativePath === "home") {
    return null;
  }

  if (relativePath.startsWith(`home${path.sep}`)) {
    return relativePath.slice(`home${path.sep}`.length);
  }

  if (relativePath.startsWith("home/")) {
    return relativePath.slice("home/".length);
  }

  return relativePath;
}

async function loadManagedIndex(studyFilesRoot) {
  try {
    const raw = await readFile(path.join(studyFilesRoot, MANAGED_INDEX), "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.entries)) {
      return [];
    }

    return parsed.entries.flatMap((entry) => {
      if (!entry || typeof entry.relativePath !== "string") {
        return [entry];
      }
      const relativePath = normalizeManagedRelativePath(entry.relativePath);

      return relativePath === null ? [] : [{ ...entry, relativePath }];
    });
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
    if (
      entry.name === "MANIFEST.md" ||
      entry.name === MANAGED_INDEX ||
      entry.name === QUARANTINE_DIRNAME
    ) {
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

async function moveDirectoryContents(sourceDir, destinationDir) {
  const moved = [];

  if (!(await pathExists(sourceDir))) {
    return moved;
  }

  await mkdir(destinationDir, { recursive: true });
  const entries = await readdir(sourceDir, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (await pathExists(destinationPath)) {
      if (entry.isDirectory()) {
        moved.push(...(await moveDirectoryContents(sourcePath, destinationPath)));
        await rm(sourcePath, { force: true, recursive: true });
        continue;
      }

      const targetName = `${path.basename(entry.name, path.extname(entry.name))} - legacy-home-${Date.now()}${path.extname(entry.name)}`;
      const conflictPath = path.join(destinationDir, sanitizeFilename(targetName));
      await rename(sourcePath, conflictPath);
      moved.push(`${sourcePath} -> ${conflictPath}`);
      continue;
    }

    await rename(sourcePath, destinationPath);
    moved.push(`${sourcePath} -> ${destinationPath}`);
  }

  return moved;
}

async function migrateLegacyHomeMirror(studyFilesRoot, agentId) {
  const legacyHomeRoot = path.join(studyFilesRoot, "home");
  const logs = [];

  if (!(await pathExists(legacyHomeRoot))) {
    return logs;
  }

  const moved = await moveDirectoryContents(legacyHomeRoot, studyFilesRoot);
  await rm(legacyHomeRoot, { force: true, recursive: true });

  if (moved.length > 0) {
    logs.push(`${agentId}: migrated legacy CYWORLD_DRIVE/home mirror to CYWORLD_DRIVE root`);
  }

  return logs;
}

async function restoreQuarantinedRootEntries(studyFilesRoot, agentId) {
  const quarantineRoot = path.join(studyFilesRoot, QUARANTINE_DIRNAME);
  const logs = [];

  if (!(await pathExists(quarantineRoot))) {
    return logs;
  }

  const entries = await readdir(quarantineRoot, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const restoredName = entry.name.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/, "");

    if (!restoredName || restoredName === entry.name) {
      continue;
    }

    const sourcePath = path.join(quarantineRoot, entry.name);
    const destinationPath = path.join(studyFilesRoot, sanitizePathSegment(restoredName));

    if (await pathExists(destinationPath)) {
      await moveDirectoryContents(sourcePath, destinationPath);
      await rm(sourcePath, { force: true, recursive: true });
    } else {
      await rename(sourcePath, destinationPath);
    }

    logs.push(`${agentId}: restored previously quarantined root entry ${entry.name} -> ${restoredName}`);
  }

  return logs;
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

function canAgentAccessRecord(record, agentParticipantKey, recordsById) {
  if (!record) {
    return false;
  }

  let current = record;

  while (current) {
    if (!hasAccess(parseAccessConfig(current.accessConfigJson), agentParticipantKey)) {
      return false;
    }

    current = current.parentId ? recordsById.get(current.parentId) : null;
  }

  return true;
}

function canAgentModifyRecord(record, agentParticipantKey, recordsById) {
  return (
    Boolean(record) &&
    !record.systemKey &&
    canAgentAccessRecord(record, agentParticipantKey, recordsById)
  );
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

    if (!canAgentModifyRecord(record, agentParticipantKey, recordsById)) {
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

    if (!canAgentModifyRecord(record, agentParticipantKey, recordsById)) {
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

    if (!canAgentAccessRecord(record, agentParticipantKey, recordsById)) {
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
        mimeType: record.mimeType ?? mimeTypeForFilename(nextFilename),
        sizeBytes: localStat.size,
        visibility: "TEAM",
        sourceType: "AGENT_REVISION_FILE",
        accessConfigJson: serializeAccessConfig({
          ...parseAccessConfig(record.accessConfigJson),
          createdByParticipantKey: agentParticipantKey,
          updatedByParticipantKey: agentParticipantKey,
        }),
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

    if (
      parentRecord &&
      !canAgentAccessRecord(parentRecord, agentParticipantKey, recordsById)
    ) {
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
            createdByParticipantKey: agentParticipantKey,
            participantKeys,
            updatedByParticipantKey: agentParticipantKey,
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
        mimeType: mimeTypeForFilename(filename),
        sizeBytes: localStat.size,
        visibility: "TEAM",
        sourceType: "AGENT_CREATED_FILE",
        accessConfigJson: serializeAccessConfig({
          createdByParticipantKey: agentParticipantKey,
          participantKeys,
          updatedByParticipantKey: agentParticipantKey,
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
  const workspaceTree = await readWorkspaceTree(studyFilesRoot);
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

async function recordDriveSyncReceipt({
  agent,
  logs,
  userId,
}) {
  if (logs.length === 0) {
    return null;
  }

  const summary =
    logs.length === 1
      ? logs[0]
      : `Imported ${logs.length} CyWorld Drive workspace changes.`;

  return prisma.agentTask.create({
    data: {
      agentId: agent.openclawAgentId,
      kind: "cyworld_drive_sync",
      objective: "Import OpenClaw workspace file changes into CyWorld Drive.",
      requesterUserId: userId,
      status: "COMPLETED",
      resultSummary: summary,
      title: "CyWorld Drive sync",
      events: {
        create: [
          {
            type: "SYSTEM_NOTE",
            summary,
            payload: {
              changes: logs,
              receipt: {
                action: "cyworld_drive_sync",
                recordedAt: new Date().toISOString(),
                status: "success",
              },
            },
          },
        ],
      },
    },
  });
}

async function removeStaleManagedEntries(studyFilesRoot, previousEntries, nextRelativePaths) {
  const nextPaths = new Set(nextRelativePaths);

  await Promise.all(
    previousEntries
      .filter((entry) => typeof entry.relativePath === "string")
      .filter((entry) => entry.relativePath.length > 0)
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
    manifestLines.push(
      `- Type: ${
        record.isFolder
          ? "folder"
          : record.externalProvider === "GOOGLE"
            ? "Google Workspace file"
            : "file"
      }`,
    );
    manifestLines.push(`- Access: ${accessState}`);
    manifestLines.push(`- Workspace path: ${accessState === "view/edit" ? workspacePath : "(not mirrored)"}`);
    manifestLines.push(`- Created: ${record.owner?.displayName ?? "Unknown"}, ${formatDate(record.createdAt)}`);
    manifestLines.push(`- Updated: ${record.owner?.displayName ?? "Unknown"}, ${formatDate(record.updatedAt)}`);

    if (accessConfig.systemManaged) {
      manifestLines.push("- System-managed: yes");
    }

    if (record.externalProvider === "GOOGLE" && record.externalUrl) {
      manifestLines.push(`- Google URL: ${record.externalUrl}`);
      manifestLines.push(
        "- Editing: use the matching CyWorld Google Docs, Sheets, or Slides tool; this mirrored file is a managed reference, not a local document copy.",
      );
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

    if (record.externalProvider === "GOOGLE" && record.externalUrl) {
      await writeFile(
        destination,
        [
          `CyWorld Google file: ${record.filename}`,
          `URL: ${record.externalUrl}`,
          `MIME type: ${record.mimeType ?? "unknown"}`,
          "",
          "This is a managed reference. Use the matching CyWorld Google Workspace tool to inspect or edit the live file.",
          "",
        ].join("\n"),
        "utf8",
      );
      const fileStat = await stat(destination);
      nextManagedEntries.push({
        externalProvider: "GOOGLE",
        fileRecordId: record.id,
        kind: "external",
        mirroredMtimeMs: fileStat.mtimeMs,
        relativePath,
        storageKey: record.storageKey,
        updatedAt: record.updatedAt.toISOString(),
      });
      continue;
    }

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

async function syncAgentMarkdown(workspacePath, user) {
  const agentDisplayName = user.agent.displayName || `${user.username}'s agent`;
  const files = [
    ["AGENTS.md", buildAgentsFilesBlock({ agentDisplayName, username: user.username })],
    ["TOOLS.md", buildToolsFilesBlock({ username: user.username })],
  ];

  for (const [fileName, block] of files) {
    const filePath = path.join(workspacePath, fileName);
    const existing = await readTextIfExists(filePath);
    await writeFile(filePath, replaceManagedBlock(existing, block), "utf8");
  }
}

async function backfillMissingMimeTypes(records) {
  const updates = records
    .filter((record) => !record.isFolder && !record.mimeType)
    .map((record) => ({
      id: record.id,
      mimeType: mimeTypeForFilename(record.filename),
    }))
    .filter((record) => record.mimeType);

  await Promise.all(
    updates.map((record) =>
      prisma.fileRecord.update({
        where: {
          id: record.id,
        },
        data: {
          mimeType: record.mimeType,
        },
      }),
    ),
  );

  return updates.length;
}

async function syncUserDrive(user) {
  const workspacePath = expandHome(
    user.agent.workspacePath || path.join(OPENCLAW_ROOT, `workspace-${user.agent.openclawAgentId}`),
  );
  const studyFilesRoot = path.join(workspacePath, STUDY_FILES_DIRNAME);
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
    "- Users may call this CyWorld Drive, Drive, the shared folder, shared files, interface files, or a visible path such as `/Onboarding`.",
    "- UI path `/X` maps directly to workspace path `CYWORLD_DRIVE/X`.",
    "- Do not add a `home` path segment. `CYWORLD_DRIVE/home` is a legacy path.",
    "",
    "## Root",
    "",
    "- UI path: /",
    `- Workspace path: ${STUDY_FILES_DIRNAME}/`,
    "- Access: view/edit",
    "",
    "## Entries",
    "",
  ];
  const nextManagedEntries = [];

  await mkdir(studyFilesRoot, { recursive: true });
  await syncAgentMarkdown(workspacePath, user);
  const migrationLogs = [
    ...(await migrateLegacyHomeMirror(studyFilesRoot, user.agent.openclawAgentId)),
    ...(await restoreQuarantinedRootEntries(studyFilesRoot, user.agent.openclawAgentId)),
  ];

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
  let mimeBackfillCount = 0;

  if (importedChanges.length > 0 || migrationLogs.length > 0) {
    records = await prisma.fileRecord.findMany(recordQuery);
  }

  mimeBackfillCount = await backfillMissingMimeTypes(records);

  if (mimeBackfillCount > 0) {
    records = await prisma.fileRecord.findMany(recordQuery);
  }

  ({ childrenByParentId } = buildRecordMaps(records));

  await mirrorTree({
    childrenByParentId,
    currentParentId: null,
    inheritedAccess: "view/edit",
    manifestLines,
    nextManagedEntries,
    participants,
    participantsByKey,
    relativeParentPath: "",
    storageRootPath: storageRoot(),
    studyFilesRoot,
    uiParentPath: "",
    workspaceParentPath: STUDY_FILES_DIRNAME,
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
  const syncLogs = [...migrationLogs, ...importedChanges];

  await recordDriveSyncReceipt({
    agent: user.agent,
    logs: syncLogs,
    userId: user.id,
  });

  if (syncLogs.length > 0) {
    console.log("Imported agent workspace changes:");
    for (const change of syncLogs) {
      console.log(`- ${change}`);
    }
  }
  if (mimeBackfillCount > 0) {
    console.log(`Backfilled MIME types: ${mimeBackfillCount}`);
  }
}

async function usersForTarget(target) {
  if (target === "__all__") {
    return prisma.user.findMany({
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
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        {
          username: target,
        },
        {
          agent: {
            openclawAgentId: target,
          },
        },
      ],
    },
    include: {
      agent: true,
    },
  });

  return user?.agent ? [user] : [];
}

async function main() {
  await acquireSyncLock();

  try {
    const target = targetAgentId();
    const users = await usersForTarget(target);

    if (users.length === 0) {
      throw new Error(`No CyWorld users with OpenClaw agents found for ${target}.`);
    }

    console.log(
      target === "__all__"
        ? `Syncing CyWorld Drive for ${users.length} agents`
        : `Syncing CyWorld Drive for ${users[0].agent.openclawAgentId}`,
    );

    for (const user of users) {
      await syncUserDrive(user);
    }
  } finally {
    await releaseSyncLock();
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
