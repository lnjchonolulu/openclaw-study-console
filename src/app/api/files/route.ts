import { NextResponse } from "next/server";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { triggerCyWorldDriveSyncAll } from "@/lib/cyworld-drive-sync";
import {
  createGoogleWorkspaceEntry,
  createWorkspaceFolder,
  listWorkspaceFolder,
  uploadWorkspaceFiles,
} from "@/lib/files";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parentId = url.searchParams.get("parentId");
  try {
    const view = await listWorkspaceFolder(parentId, user.id);

    return NextResponse.json(view);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Workspace could not be loaded.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      name?: string;
      parentId?: string | null;
      participantKeys?: string[];
      fileType?: "docs" | "sheets" | "slides";
      type?: string;
    };

    try {
      if (
        body.type === "google-file" &&
        body.fileType &&
        ["docs", "sheets", "slides"].includes(body.fileType)
      ) {
        const entry = await createGoogleWorkspaceEntry({
          createdByUserId: user.id,
          fileType: body.fileType,
          parentId: body.parentId?.trim() || null,
          title: body.name ?? "",
        });

        after(triggerCyWorldDriveSyncAll);
        return NextResponse.json({ entry });
      }

      if (body.type !== "folder") {
        return NextResponse.json({ error: "Unsupported request." }, { status: 400 });
      }

      const folder = await createWorkspaceFolder({
        createdByUserId: user.id,
        name: body.name ?? "",
        parentId: body.parentId?.trim() || null,
        participantKeys: Array.isArray(body.participantKeys)
          ? body.participantKeys.filter((value): value is string => typeof value === "string")
          : undefined,
      });

      after(triggerCyWorldDriveSyncAll);
      return NextResponse.json({ entry: folder });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Item could not be created.",
        },
        { status: 400 },
      );
    }
  }

  const formData = await request.formData();
  const parentId = (formData.get("parentId") as string | null)?.trim() || null;
  const replaceExisting = formData.get("replaceExisting") === "true";
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: "No files were provided." }, { status: 400 });
  }

  try {
    const entries = await uploadWorkspaceFiles({
      files,
      parentId,
      replaceExisting,
      uploadedByUserId: user.id,
    });

    if (entries.conflicts.length > 0) {
      return NextResponse.json(
        {
          conflicts: entries.conflicts,
          error: "Upload conflict.",
        },
        { status: 409 },
      );
    }

    after(triggerCyWorldDriveSyncAll);
    return NextResponse.json({ entries: entries.entries });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Upload failed.",
      },
      { status: 400 },
    );
  }
}
