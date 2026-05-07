import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type WorkspaceEntry = {
  id: string;
  filename: string;
  isFolder: boolean;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: string;
};

export type WorkspaceBreadcrumb = {
  id: string | null;
  label: string;
};

export type WorkspaceFolderView = {
  breadcrumbs: WorkspaceBreadcrumb[];
  currentFolder: {
    id: string | null;
    label: string;
  };
  entries: WorkspaceEntry[];
};

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

async function getFolderOrThrow(folderId: string) {
  const folder = await prisma.fileRecord.findUnique({
    where: {
      id: folderId,
    },
  });

  if (!folder || !folder.isFolder) {
    throw new Error("Folder not found.");
  }

  return folder;
}

async function buildBreadcrumbs(folderId: string | null): Promise<WorkspaceBreadcrumb[]> {
  const crumbs: WorkspaceBreadcrumb[] = [{ id: null, label: "Shared Workspace" }];

  if (!folderId) {
    return crumbs;
  }

  const stack: WorkspaceBreadcrumb[] = [];
  let currentId: string | null = folderId;

  while (currentId) {
    const folder = (await prisma.fileRecord.findUnique({
      where: {
        id: currentId,
      },
      select: {
        id: true,
        filename: true,
        parentId: true,
      },
    })) as { id: string; filename: string; parentId: string | null } | null;

    if (!folder) {
      break;
    }

    stack.unshift({
      id: folder.id,
      label: folder.filename,
    });

    currentId = folder.parentId;
  }

  return [...crumbs, ...stack];
}

export async function listWorkspaceFolder(parentId: string | null): Promise<WorkspaceFolderView> {
  if (parentId) {
    await getFolderOrThrow(parentId);
  }

  const [entries, breadcrumbs] = await Promise.all([
    prisma.fileRecord.findMany({
      where: {
        parentId,
      },
      orderBy: [{ isFolder: "desc" }, { filename: "asc" }],
      select: {
        id: true,
        filename: true,
        isFolder: true,
        mimeType: true,
        sizeBytes: true,
        updatedAt: true,
      },
    }),
    buildBreadcrumbs(parentId),
  ]);

  const normalizedEntries: WorkspaceEntry[] = entries.map((entry) => ({
    id: entry.id,
    filename: entry.filename,
    isFolder: entry.isFolder,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    updatedAt: entry.updatedAt.toISOString(),
  }));

  return {
    breadcrumbs,
    currentFolder: {
      id: parentId,
      label: breadcrumbs[breadcrumbs.length - 1]?.label ?? "Shared Workspace",
    },
    entries: normalizedEntries,
  };
}

export async function createWorkspaceFolder({
  createdByUserId,
  name,
  parentId,
}: {
  createdByUserId: string;
  name: string;
  parentId: string | null;
}) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Folder name is required.");
  }

  if (parentId) {
    await getFolderOrThrow(parentId);
  }

  const folder = await prisma.fileRecord.create({
    data: {
      ownerUserId: createdByUserId,
      parentId,
      filename: trimmedName,
      storageKey: `folder:${randomUUID()}`,
      isFolder: true,
      visibility: "TEAM",
      sourceType: "USER_FOLDER",
    },
    select: {
      id: true,
      filename: true,
      isFolder: true,
      mimeType: true,
      sizeBytes: true,
      updatedAt: true,
    },
  });

  return {
    ...folder,
    updatedAt: folder.updatedAt.toISOString(),
  } satisfies WorkspaceEntry;
}

export async function uploadWorkspaceFiles({
  files,
  parentId,
  uploadedByUserId,
}: {
  files: File[];
  parentId: string | null;
  uploadedByUserId: string;
}) {
  if (parentId) {
    await getFolderOrThrow(parentId);
  }

  const root = await ensureStorageRoot();
  const createdEntries: WorkspaceEntry[] = [];

  for (const file of files) {
    const safeName = sanitizeFilename(file.name);
    const recordId = randomUUID();
    const storageKey = `${recordId}-${safeName}`;
    const absolutePath = path.join(root, storageKey);
    const bytes = Buffer.from(await file.arrayBuffer());

    await writeFile(absolutePath, bytes);

    const created = await prisma.fileRecord.create({
      data: {
        id: recordId,
        ownerUserId: uploadedByUserId,
        parentId,
        filename: safeName,
        storageKey,
        mimeType: file.type || null,
        sizeBytes: bytes.byteLength,
        visibility: "TEAM",
        sourceType: "USER_UPLOAD",
      },
      select: {
        id: true,
        filename: true,
        isFolder: true,
        mimeType: true,
        sizeBytes: true,
        updatedAt: true,
      },
    });

    createdEntries.push({
      ...created,
      updatedAt: created.updatedAt.toISOString(),
    });
  }

  return createdEntries;
}

export async function getDownloadableFile(fileId: string) {
  const record = await prisma.fileRecord.findUnique({
    where: {
      id: fileId,
    },
    select: {
      filename: true,
      isFolder: true,
      mimeType: true,
      storageKey: true,
    },
  });

  if (!record || record.isFolder) {
    return null;
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
