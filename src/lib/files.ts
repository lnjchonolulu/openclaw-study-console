import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { listTeamParticipants, type TeamParticipant } from "@/lib/team";

type FileAccessConfig = {
  createdByParticipantKey?: string;
  participantKeys: string[];
  systemManaged?: boolean;
  updatedByParticipantKey?: string;
};

type FileRecordLite = {
  accessConfigJson: unknown;
  createdAt: Date;
  filename: string;
  id: string;
  isFolder: boolean;
  mimeType: string | null;
  owner: {
    displayName: string;
  } | null;
  ownerUserId: string | null;
  parentId: string | null;
  sizeBytes: number | null;
  storageKey: string;
  sourceType: string;
  systemKey: string | null;
  teamId: string | null;
  updatedAt: Date;
};

export type WorkspaceEntry = {
  accessCount: number;
  accessParticipants: TeamParticipant[];
  canAccess: boolean;
  createdAt: string;
  createdByName: string;
  id: string;
  filename: string;
  isFolder: boolean;
  isLocked: boolean;
  isSystemManaged: boolean;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: string;
  updatedByName: string;
};

export type UploadConflict = {
  existingId: string;
  filename: string;
};

export type WorkspaceBreadcrumb = {
  id: string | null;
  isLocked: boolean;
  label: string;
};

export type WorkspaceFolderView = {
  breadcrumbs: WorkspaceBreadcrumb[];
  currentFolder: {
    accessParticipants: TeamParticipant[];
    canAccess: boolean;
    id: string | null;
    isHome: boolean;
    isLocked: boolean;
    isSystemManaged: boolean;
    label: string;
  };
  currentUserKey: string;
  entries: WorkspaceEntry[];
  participants: TeamParticipant[];
};

type FileWorkspaceContext = {
  currentUserId: string;
  currentUserKey: string;
  participants: TeamParticipant[];
  participantsByKey: Map<string, TeamParticipant>;
  teamId: string | null;
  teamUsers: Array<{
    agent: {
      id: string;
    } | null;
    displayName: string;
    id: string;
    username: string;
  }>;
};

const PERSONALS_ROOT_KEY = "system:personals";

function storageRoot() {
  return (
    process.env.FILES_STORAGE_DIR?.trim() ||
    path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "uploads")
  );
}

async function ensureStorageRoot() {
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  return root;
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^\w.\- ]+/g, "-").replace(/\s+/g, " ").trim() || "untitled";
}

function parseAccessConfig(input: unknown): FileAccessConfig {
  if (!input || typeof input !== "object") {
    return { participantKeys: [] };
  }

  const participantKeys = Array.isArray((input as { participantKeys?: unknown }).participantKeys)
    ? (input as { participantKeys: unknown[] }).participantKeys.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];

  return {
    createdByParticipantKey:
      typeof (input as { createdByParticipantKey?: unknown }).createdByParticipantKey ===
      "string"
        ? (input as { createdByParticipantKey: string }).createdByParticipantKey
        : undefined,
    participantKeys,
    systemManaged: Boolean((input as { systemManaged?: unknown }).systemManaged),
    updatedByParticipantKey:
      typeof (input as { updatedByParticipantKey?: unknown }).updatedByParticipantKey ===
      "string"
        ? (input as { updatedByParticipantKey: string }).updatedByParticipantKey
        : undefined,
  };
}

function serializeAccessConfig(config: FileAccessConfig) {
  return {
    ...(config.createdByParticipantKey
      ? { createdByParticipantKey: config.createdByParticipantKey }
      : {}),
    participantKeys: [...new Set(config.participantKeys)].sort(),
    systemManaged: Boolean(config.systemManaged),
    ...(config.updatedByParticipantKey
      ? { updatedByParticipantKey: config.updatedByParticipantKey }
      : {}),
  };
}

function hasExplicitAccess(config: FileAccessConfig, currentUserKey: string) {
  if (config.participantKeys.length === 0) {
    return true;
  }

  return config.participantKeys.includes(currentUserKey);
}

function mapAccessParticipants(
  keys: string[],
  participants: TeamParticipant[],
  participantsByKey: Map<string, TeamParticipant>,
) {
  if (keys.length === 0) {
    return participants;
  }

  return keys
    .map((key) => participantsByKey.get(key))
    .filter((participant): participant is TeamParticipant => Boolean(participant));
}

async function getFileWorkspaceContext(userId: string): Promise<FileWorkspaceContext> {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      team: {
        include: {
          users: {
            where: {
              status: "ACTIVE",
            },
            orderBy: {
              displayName: "asc",
            },
            include: {
              agent: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const participants = await listTeamParticipants(userId);
  const participantsByKey = new Map(
    participants.map((participant) => [
      `${participant.kind}:${participant.id}`,
      participant,
    ]),
  );

  return {
    currentUserId: userId,
    currentUserKey: `user:${userId}`,
    participants,
    participantsByKey,
    teamId: user?.team?.id ?? null,
    teamUsers: user?.team?.users ?? [],
  };
}

async function getFolderOrThrow(folderId: string) {
  const folder = await prisma.fileRecord.findUnique({
    where: {
      id: folderId,
    },
    select: {
      accessConfigJson: true,
      filename: true,
      id: true,
      isFolder: true,
      ownerUserId: true,
      parentId: true,
      systemKey: true,
      teamId: true,
    },
  });

  if (!folder || !folder.isFolder) {
    throw new Error("Folder not found.");
  }

  return folder;
}

async function ensurePersonalsStructure(context: FileWorkspaceContext) {
  if (!context.teamId) {
    return null;
  }

  const root = await prisma.fileRecord.upsert({
    where: {
      systemKey: PERSONALS_ROOT_KEY,
    },
    update: {
      teamId: context.teamId,
      visibility: "TEAM",
      accessConfigJson: serializeAccessConfig({ participantKeys: [] }),
    },
    create: {
      ownerUserId: context.currentUserId,
      teamId: context.teamId,
      parentId: null,
      systemKey: PERSONALS_ROOT_KEY,
      filename: "Personals",
      storageKey: `folder:${randomUUID()}`,
      isFolder: true,
      visibility: "TEAM",
      sourceType: "SYSTEM_FOLDER",
      accessConfigJson: serializeAccessConfig({ participantKeys: [] }),
    },
  });

  await Promise.all(
    context.teamUsers.map(async (member) => {
      const participantKeys = [`user:${member.id}`];

      if (member.agent?.id) {
        participantKeys.push(`agent:${member.agent.id}`);
      }

      await prisma.fileRecord.upsert({
        where: {
          systemKey: `personals:${member.id}`,
        },
        update: {
          teamId: context.teamId,
          parentId: root.id,
          ownerUserId: member.id,
          filename: member.displayName,
          visibility: "TEAM",
          accessConfigJson: serializeAccessConfig({
            participantKeys,
            systemManaged: true,
          }),
        },
        create: {
          ownerUserId: member.id,
          teamId: context.teamId,
          parentId: root.id,
          systemKey: `personals:${member.id}`,
          filename: member.displayName,
          storageKey: `folder:${randomUUID()}`,
          isFolder: true,
          visibility: "TEAM",
          sourceType: "SYSTEM_FOLDER",
          accessConfigJson: serializeAccessConfig({
            participantKeys,
            systemManaged: true,
          }),
        },
      });
    }),
  );

  return root;
}

async function buildBreadcrumbs(
  folderId: string | null,
  context: FileWorkspaceContext,
): Promise<WorkspaceBreadcrumb[]> {
  const crumbs: WorkspaceBreadcrumb[] = [{ id: null, isLocked: false, label: "/" }];

  if (!folderId) {
    return crumbs;
  }

  const stack: WorkspaceBreadcrumb[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const folder: {
      accessConfigJson: unknown;
      filename: string;
      id: string;
      parentId: string | null;
    } | null = await prisma.fileRecord.findUnique({
      where: {
        id: currentId,
      },
      select: {
        accessConfigJson: true,
        filename: true,
        id: true,
        parentId: true,
      },
    });

    if (!folder) {
      break;
    }

    const accessConfig = parseAccessConfig(folder.accessConfigJson);
    stack.unshift({
      id: folder.id,
      isLocked:
        accessConfig.participantKeys.length > 0 &&
        !hasExplicitAccess(accessConfig, context.currentUserKey),
      label: folder.filename,
    });

    currentId = folder.parentId;
  }

  return [...crumbs, ...stack];
}

function mapEntry(
  entry: FileRecordLite,
  context: FileWorkspaceContext,
): WorkspaceEntry {
  const accessConfig = parseAccessConfig(entry.accessConfigJson);
  const accessParticipants = mapAccessParticipants(
    accessConfig.participantKeys,
    context.participants,
    context.participantsByKey,
  );
  const canAccess = hasExplicitAccess(accessConfig, context.currentUserKey);
  const isLocked = accessConfig.participantKeys.length > 0 && !canAccess;
  const inferredAgentActorKey = entry.sourceType.startsWith("AGENT_")
    ? accessConfig.participantKeys.find((key) => key.startsWith("agent:"))
    : undefined;
  const createdByKey = accessConfig.createdByParticipantKey ?? inferredAgentActorKey;
  const updatedByKey = accessConfig.updatedByParticipantKey ?? inferredAgentActorKey;

  return {
    accessCount: accessParticipants.length,
    accessParticipants,
    canAccess,
    createdAt: entry.createdAt.toISOString(),
    createdByName: createdByKey
      ? participantNameForKey(createdByKey, context)
      : entry.owner?.displayName ?? "Unknown",
    filename: entry.filename,
    id: entry.id,
    isFolder: entry.isFolder,
    isLocked,
    isSystemManaged: Boolean(entry.systemKey?.startsWith("personals:")),
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    updatedAt: entry.updatedAt.toISOString(),
    updatedByName: updatedByKey
      ? participantNameForKey(updatedByKey, context)
      : entry.owner?.displayName ?? "Unknown",
  };
}

function participantNameForKey(
  key: string,
  context: FileWorkspaceContext,
) {
  return context.participantsByKey.get(key)?.name ?? key;
}

function accessLabelForConfig(
  config: FileAccessConfig,
  context: FileWorkspaceContext,
) {
  if (config.participantKeys.length === 0) {
    return "everyone";
  }

  return config.participantKeys
    .map((key) => participantNameForKey(key, context))
    .join(", ");
}

function buildStudyFilePath(
  record: FileRecordLite,
  recordsById: Map<string, FileRecordLite>,
) {
  const segments = [record.filename];
  let cursor = record.parentId ? recordsById.get(record.parentId) : null;

  while (cursor) {
    segments.unshift(cursor.filename);
    cursor = cursor.parentId ? recordsById.get(cursor.parentId) : null;
  }

  return `/${segments.join("/")}`;
}

function canAccessRecordWithKey(
  record: FileRecordLite,
  participantKey: string,
  recordsById: Map<string, FileRecordLite>,
) {
  const ownAccess = parseAccessConfig(record.accessConfigJson);

  if (!hasExplicitAccess(ownAccess, participantKey)) {
    return false;
  }

  let cursor = record.parentId ? recordsById.get(record.parentId) : null;

  while (cursor) {
    const parentAccess = parseAccessConfig(cursor.accessConfigJson);

    if (!hasExplicitAccess(parentAccess, participantKey)) {
      return false;
    }

    cursor = cursor.parentId ? recordsById.get(cursor.parentId) : null;
  }

  return true;
}

export async function buildStudyFilesRuntimeContext({
  agentDatabaseId,
  maxInaccessibleFolders = 10,
  maxVisibleEntries = 16,
  userId,
}: {
  agentDatabaseId: string;
  maxInaccessibleFolders?: number;
  maxVisibleEntries?: number;
  userId: string;
}) {
  const context = await getFileWorkspaceContext(userId);
  const agentKey = `agent:${agentDatabaseId}`;

  await ensurePersonalsStructure(context);

  const records = await prisma.fileRecord.findMany({
    where: {
      OR: [{ teamId: context.teamId }, { teamId: null }],
    },
    orderBy: [{ isFolder: "desc" }, { filename: "asc" }],
    select: {
      accessConfigJson: true,
      createdAt: true,
      filename: true,
      id: true,
      isFolder: true,
      mimeType: true,
      owner: {
        select: {
          displayName: true,
        },
      },
      ownerUserId: true,
      parentId: true,
      sizeBytes: true,
      storageKey: true,
      sourceType: true,
      systemKey: true,
      teamId: true,
      updatedAt: true,
    },
  });
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const accessibleRecords = records.filter((record) =>
    canAccessRecordWithKey(record, agentKey, recordsById),
  );
  const visibleRecords = accessibleRecords
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, maxVisibleEntries);
  const inaccessibleFolders = records
    .filter((record) => record.isFolder && !canAccessRecordWithKey(record, agentKey, recordsById))
    .filter((record) => {
      if (!record.parentId) {
        return true;
      }

      const parent = recordsById.get(record.parentId);

      return parent ? canAccessRecordWithKey(parent, agentKey, recordsById) : true;
    })
    .slice(0, maxInaccessibleFolders);
  const visibleLines = visibleRecords.map((record) => {
    const access = accessLabelForConfig(parseAccessConfig(record.accessConfigJson), context);
    const kind = record.isFolder ? "folder" : "file";

    return `- ${buildStudyFilePath(record, recordsById)} (${kind}; access: ${access})`;
  });
  const inaccessibleLines = inaccessibleFolders.map((record) => {
    const access = accessLabelForConfig(parseAccessConfig(record.accessConfigJson), context);

    return `- ${buildStudyFilePath(record, recordsById)} (folder; no access for you; access: ${access})`;
  });

  return [
    "CyWorld Drive context",
    "- CyWorld Drive is the shared file area shown in the web app Drive tab.",
    "- Treat CyWorld Drive as the canonical name internally, but never require the user to say that exact name.",
    "- Resolve vague references from the conversation: for example, a file they uploaded, something visible in the app, a shared document, a folder, a path, 'that PDF', 'the thing from earlier', or 'my workspace' may refer to CyWorld Drive.",
    "- Distinguish it from your private OpenClaw workspace. AGENTS.md, USER.md, IDENTITY.md, SOUL.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md, and memory files are OpenClaw workspace files, not CyWorld Drive files.",
    "- If conversation history and the visible entries below identify one sensible resource, use it. If multiple resources remain plausible and the difference matters, ask one short clarification instead of guessing.",
    "- The CyWorld Drive UI root is /.",
    "- If your OpenClaw workspace has a CYWORLD_DRIVE/MANIFEST.md file, use CYWORLD_DRIVE/ as the filesystem mirror of CyWorld Drive.",
    "- UI path /X maps directly to workspace path CYWORLD_DRIVE/X. Do not add or remove a home segment.",
    "- If the user asks what files you can see, answer from the visible CyWorld Drive entries below. Do not list AGENTS.md, SOUL.md, IDENTITY.md, MEMORY.md, TOOLS.md, or other OpenClaw workspace files unless the user explicitly asks about OpenClaw workspace files.",
    "- Access here is the app-level shared drive access. If an entry is listed as no access, say you cannot access that folder in CyWorld Drive.",
    "",
    `Recently updated visible CyWorld Drive entries (showing ${visibleRecords.length} of ${accessibleRecords.length}):`,
    visibleLines.length > 0 ? visibleLines.join("\n") : "- (none)",
    "",
    "Known CyWorld Drive folders you cannot access:",
    inaccessibleLines.length > 0 ? inaccessibleLines.join("\n") : "- (none)",
  ].join("\n");
}

export async function listWorkspaceFolder(
  parentId: string | null,
  userId: string,
): Promise<WorkspaceFolderView> {
  const context = await getFileWorkspaceContext(userId);

  await ensurePersonalsStructure(context);

  let parentFolder: Awaited<ReturnType<typeof getFolderOrThrow>> | null = null;

  if (parentId) {
    parentFolder = await getFolderOrThrow(parentId);
    const accessConfig = parseAccessConfig(parentFolder.accessConfigJson);

    if (!hasExplicitAccess(accessConfig, context.currentUserKey)) {
      throw new Error("You do not have access to this folder.");
    }
  }

  const [entries, breadcrumbs] = await Promise.all([
    prisma.fileRecord.findMany({
      where: {
        parentId,
      },
      orderBy: [{ isFolder: "desc" }, { filename: "asc" }],
      select: {
        accessConfigJson: true,
        createdAt: true,
        filename: true,
        id: true,
        isFolder: true,
        mimeType: true,
        owner: {
          select: {
            displayName: true,
          },
        },
        ownerUserId: true,
        parentId: true,
        sizeBytes: true,
        storageKey: true,
        sourceType: true,
        systemKey: true,
        teamId: true,
        updatedAt: true,
      },
    }),
    buildBreadcrumbs(parentId, context),
  ]);

  const normalizedEntries = entries.map((entry) =>
    mapEntry(entry, context),
  );
  const currentAccessConfig = parentFolder
    ? parseAccessConfig(parentFolder.accessConfigJson)
    : { participantKeys: [] };

  return {
    breadcrumbs,
    currentFolder: {
      accessParticipants: mapAccessParticipants(
        currentAccessConfig.participantKeys,
        context.participants,
        context.participantsByKey,
      ),
      canAccess: parentFolder
        ? hasExplicitAccess(currentAccessConfig, context.currentUserKey)
        : true,
      id: parentId,
      isHome: parentId === null,
      isLocked: false,
      isSystemManaged: Boolean(parentFolder?.systemKey),
      label: breadcrumbs[breadcrumbs.length - 1]?.label ?? "/",
    },
    currentUserKey: context.currentUserKey,
    entries: normalizedEntries,
    participants: context.participants,
  };
}

export async function createWorkspaceFolder({
  createdByUserId,
  name,
  parentId,
  participantKeys,
}: {
  createdByUserId: string;
  name: string;
  parentId: string | null;
  participantKeys?: string[];
}) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Folder name is required.");
  }

  const context = await getFileWorkspaceContext(createdByUserId);

  if (parentId) {
    const parentFolder = await getFolderOrThrow(parentId);
    const parentAccess = parseAccessConfig(parentFolder.accessConfigJson);

    if (!hasExplicitAccess(parentAccess, context.currentUserKey)) {
      throw new Error("You do not have access to this folder.");
    }
  }

  const folder = await prisma.fileRecord.create({
    data: {
      ownerUserId: createdByUserId,
      teamId: context.teamId,
      parentId,
      filename: trimmedName,
      storageKey: `folder:${randomUUID()}`,
      isFolder: true,
      visibility: "TEAM",
      sourceType: "USER_FOLDER",
      accessConfigJson: serializeAccessConfig({
        participantKeys: [...new Set([context.currentUserKey, ...(participantKeys ?? [])])],
      }),
    },
    select: {
      accessConfigJson: true,
      createdAt: true,
      filename: true,
      id: true,
      isFolder: true,
      mimeType: true,
      owner: {
        select: {
          displayName: true,
        },
      },
      ownerUserId: true,
      parentId: true,
      sizeBytes: true,
      storageKey: true,
      sourceType: true,
      systemKey: true,
      teamId: true,
      updatedAt: true,
    },
  });

  return mapEntry(folder, context);
}

export async function uploadWorkspaceFiles({
  files,
  parentId,
  replaceExisting,
  uploadedByUserId,
}: {
  files: File[];
  parentId: string | null;
  replaceExisting?: boolean;
  uploadedByUserId: string;
}) {
  const context = await getFileWorkspaceContext(uploadedByUserId);

  if (parentId) {
    const parentFolder = await getFolderOrThrow(parentId);
    const parentAccess = parseAccessConfig(parentFolder.accessConfigJson);

    if (!hasExplicitAccess(parentAccess, context.currentUserKey)) {
      throw new Error("You do not have access to this folder.");
    }
  }

  const root = await ensureStorageRoot();
  const createdEntries: WorkspaceEntry[] = [];
  const incomingNames = files.map((file) => sanitizeFilename(file.name));
  const existingFiles = await prisma.fileRecord.findMany({
    where: {
      parentId,
      isFolder: false,
      filename: {
        in: incomingNames,
      },
    },
    select: {
      accessConfigJson: true,
      filename: true,
      id: true,
      storageKey: true,
    },
  });
  const accessibleConflicts = existingFiles.filter((existing) =>
    hasExplicitAccess(parseAccessConfig(existing.accessConfigJson), context.currentUserKey),
  );

  if (accessibleConflicts.length > 0 && !replaceExisting) {
    return {
      conflicts: accessibleConflicts.map((existing) => ({
        existingId: existing.id,
        filename: existing.filename,
      })),
      entries: [],
    };
  }
  const existingByFilename = new Map(
    accessibleConflicts.map((existing) => [existing.filename, existing]),
  );

  for (const file of files) {
    const safeName = sanitizeFilename(file.name);
    const existing = replaceExisting ? existingByFilename.get(safeName) : null;
    const recordId = existing?.id ?? randomUUID();
    const storageKey = existing?.storageKey ?? `${recordId}-${safeName}`;
    const absolutePath = path.join(root, storageKey);
    const bytes = Buffer.from(await file.arrayBuffer());

    await writeFile(absolutePath, bytes);

    const created = existing
      ? await prisma.fileRecord.update({
          where: {
            id: existing.id,
          },
          data: {
            mimeType: file.type || null,
            sizeBytes: bytes.byteLength,
            sourceType: "USER_REPLACED_UPLOAD",
          },
          select: {
            accessConfigJson: true,
            createdAt: true,
            filename: true,
            id: true,
            isFolder: true,
            mimeType: true,
            owner: {
              select: {
                displayName: true,
              },
            },
            ownerUserId: true,
            parentId: true,
            sizeBytes: true,
            storageKey: true,
            sourceType: true,
            systemKey: true,
            teamId: true,
            updatedAt: true,
          },
        })
      : await prisma.fileRecord.create({
          data: {
            id: recordId,
            ownerUserId: uploadedByUserId,
            teamId: context.teamId,
            parentId,
            filename: safeName,
            storageKey,
            mimeType: file.type || null,
            sizeBytes: bytes.byteLength,
            visibility: "TEAM",
            sourceType: "USER_UPLOAD",
          },
          select: {
            accessConfigJson: true,
            createdAt: true,
            filename: true,
            id: true,
            isFolder: true,
            mimeType: true,
            owner: {
              select: {
                displayName: true,
              },
            },
            ownerUserId: true,
            parentId: true,
            sizeBytes: true,
            storageKey: true,
            sourceType: true,
            systemKey: true,
            teamId: true,
            updatedAt: true,
          },
        });

    createdEntries.push(mapEntry(created, context));
  }

  return {
    conflicts: [],
    entries: createdEntries,
  };
}

export async function updateWorkspaceFolderAccess(
  userId: string,
  folderId: string,
  participantKeys: string[],
) {
  const context = await getFileWorkspaceContext(userId);
  const folder = await getFolderOrThrow(folderId);

  if (folder.systemKey?.startsWith("personals:") || folder.systemKey === PERSONALS_ROOT_KEY) {
    throw new Error("This folder has fixed access rules.");
  }

  const currentAccess = parseAccessConfig(folder.accessConfigJson);

  if (!hasExplicitAccess(currentAccess, context.currentUserKey)) {
    throw new Error("You do not have access to this folder.");
  }

  const updated = await prisma.fileRecord.update({
    where: {
      id: folderId,
    },
    data: {
      accessConfigJson: serializeAccessConfig({
        participantKeys: [...new Set([context.currentUserKey, ...participantKeys])],
      }),
    },
    select: {
      accessConfigJson: true,
      createdAt: true,
      filename: true,
      id: true,
      isFolder: true,
      mimeType: true,
      owner: {
        select: {
          displayName: true,
        },
      },
      ownerUserId: true,
      parentId: true,
      sizeBytes: true,
      storageKey: true,
      sourceType: true,
      systemKey: true,
      teamId: true,
      updatedAt: true,
    },
  });

  return mapEntry(updated, context);
}

export async function renameWorkspaceEntry(userId: string, fileId: string, name: string) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Name is required.");
  }

  const context = await getFileWorkspaceContext(userId);
  const record = await prisma.fileRecord.findUnique({
    where: {
      id: fileId,
    },
    select: {
      accessConfigJson: true,
      id: true,
      systemKey: true,
    },
  });

  if (!record) {
    throw new Error("Item not found.");
  }

  if (record.systemKey) {
    throw new Error("This item name cannot be changed.");
  }

  const accessConfig = parseAccessConfig(record.accessConfigJson);

  if (!hasExplicitAccess(accessConfig, context.currentUserKey)) {
    throw new Error("You do not have access to this item.");
  }

  const updated = await prisma.fileRecord.update({
    where: {
      id: fileId,
    },
    data: {
      filename: trimmedName,
    },
    select: {
      accessConfigJson: true,
      createdAt: true,
      filename: true,
      id: true,
      isFolder: true,
      mimeType: true,
      owner: {
        select: {
          displayName: true,
        },
      },
      ownerUserId: true,
      parentId: true,
      sizeBytes: true,
      storageKey: true,
      sourceType: true,
      systemKey: true,
      teamId: true,
      updatedAt: true,
    },
  });

  return mapEntry(updated, context);
}

async function ensureNotDescendant(folderId: string, nextParentId: string | null) {
  let cursor = nextParentId;

  while (cursor) {
    if (cursor === folderId) {
      throw new Error("Folders cannot be moved into themselves.");
    }

    const next = await prisma.fileRecord.findUnique({
      where: {
        id: cursor,
      },
      select: {
        parentId: true,
      },
    });

    cursor = next?.parentId ?? null;
  }
}

export async function moveWorkspaceRecord(
  userId: string,
  fileId: string,
  nextParentId: string | null,
) {
  const context = await getFileWorkspaceContext(userId);
  const record = await prisma.fileRecord.findUnique({
    where: {
      id: fileId,
    },
    select: {
      accessConfigJson: true,
      id: true,
      isFolder: true,
      parentId: true,
      systemKey: true,
    },
  });

  if (!record) {
    throw new Error("Folder not found.");
  }

  if (record.systemKey) {
    throw new Error("This folder cannot be moved.");
  }

  const currentAccess = parseAccessConfig(record.accessConfigJson);

  if (!hasExplicitAccess(currentAccess, context.currentUserKey)) {
    throw new Error("You do not have access to this folder.");
  }

  if (record.isFolder) {
    await ensureNotDescendant(record.id, nextParentId);
  }

  if (nextParentId) {
    const targetFolder = await getFolderOrThrow(nextParentId);
    const targetAccess = parseAccessConfig(targetFolder.accessConfigJson);

    if (!hasExplicitAccess(targetAccess, context.currentUserKey)) {
      throw new Error("You can only move this into a folder you can access.");
    }
  }

  await prisma.fileRecord.update({
    where: {
      id: fileId,
    },
    data: {
      parentId: nextParentId,
    },
  });
}

async function collectFolderIds(folderId: string): Promise<string[]> {
  const childFolders = await prisma.fileRecord.findMany({
    where: {
      parentId: folderId,
      isFolder: true,
    },
    select: {
      id: true,
    },
  });

  const nestedIds = await Promise.all(
    childFolders.map((child) => collectFolderIds(child.id)),
  );

  return [folderId, ...nestedIds.flat()];
}

export async function deleteWorkspaceFolder(userId: string, folderId: string) {
  const context = await getFileWorkspaceContext(userId);
  const folder = await getFolderOrThrow(folderId);

  if (folder.systemKey) {
    throw new Error("This folder cannot be deleted.");
  }

  const accessConfig = parseAccessConfig(folder.accessConfigJson);

  if (!hasExplicitAccess(accessConfig, context.currentUserKey)) {
    throw new Error("You do not have access to this folder.");
  }

  const folderIds = await collectFolderIds(folderId);
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

  const root = await ensureStorageRoot();

  await Promise.all(
    files.map((file) => rm(path.join(root, file.storageKey), { force: true })),
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
}

export async function getDownloadableFile(userId: string, fileId: string) {
  const context = await getFileWorkspaceContext(userId);
  const record = await prisma.fileRecord.findUnique({
    where: {
      id: fileId,
    },
    select: {
      accessConfigJson: true,
      filename: true,
      isFolder: true,
      mimeType: true,
      parentId: true,
      storageKey: true,
    },
  });

  if (!record || record.isFolder) {
    return null;
  }

  if (record.parentId) {
    const parentFolder = await getFolderOrThrow(record.parentId);
    const accessConfig = parseAccessConfig(parentFolder.accessConfigJson);

    if (!hasExplicitAccess(accessConfig, context.currentUserKey)) {
      throw new Error("You do not have access to this file.");
    }
  }

  const root = await ensureStorageRoot();
  const absolutePath = path.join(root, record.storageKey);
  const buffer = await readFile(absolutePath);

  return {
    buffer,
    filename: record.filename,
    mimeType: record.mimeType || "application/octet-stream",
  };
}
