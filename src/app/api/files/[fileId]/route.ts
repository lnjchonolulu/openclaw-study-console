import { NextResponse } from "next/server";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { triggerCyWorldDriveSyncAll } from "@/lib/cyworld-drive-sync";
import {
  deleteWorkspaceFolder,
  getDownloadableFile,
  moveWorkspaceRecord,
  renameWorkspaceEntry,
  updateWorkspaceFolderAccess,
} from "@/lib/files";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { fileId } = await context.params;
  try {
    const file = await getDownloadableFile(user.id, fileId);

    if (!file) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    return new NextResponse(file.buffer, {
      headers: {
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.filename)}"`,
        "Content-Type": file.mimeType,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "File could not be loaded.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { fileId } = await context.params;
  const body = (await request.json()) as {
    action?: string;
    name?: string;
    parentId?: string | null;
    participantKeys?: string[];
  };

  try {
    if (body.action === "rename") {
      const entry = await renameWorkspaceEntry(user.id, fileId, body.name ?? "");
      after(triggerCyWorldDriveSyncAll);
      return NextResponse.json({ entry });
    }

    if (body.action === "access") {
      const entry = await updateWorkspaceFolderAccess(
        user.id,
        fileId,
        Array.isArray(body.participantKeys)
          ? body.participantKeys.filter((value): value is string => typeof value === "string")
          : [],
      );
      after(triggerCyWorldDriveSyncAll);
      return NextResponse.json({ entry });
    }

    if (body.action === "move") {
      await moveWorkspaceRecord(user.id, fileId, body.parentId?.trim() || null);
      after(triggerCyWorldDriveSyncAll);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unsupported request." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Folder update failed.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { fileId } = await context.params;

  try {
    await deleteWorkspaceFolder(user.id, fileId);
    after(triggerCyWorldDriveSyncAll);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Folder could not be deleted.",
      },
      { status: 400 },
    );
  }
}
