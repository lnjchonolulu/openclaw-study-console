import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  deleteWorkspaceFolder,
  getDownloadableFile,
  moveWorkspaceRecord,
  renameWorkspaceFolder,
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
      const entry = await renameWorkspaceFolder(user.id, fileId, body.name ?? "");
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
      return NextResponse.json({ entry });
    }

    if (body.action === "move") {
      await moveWorkspaceRecord(user.id, fileId, body.parentId?.trim() || null);
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
