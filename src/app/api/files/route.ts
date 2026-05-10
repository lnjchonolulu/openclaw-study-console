import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
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
      type?: string;
    };

    if (body.type !== "folder") {
      return NextResponse.json({ error: "Unsupported request." }, { status: 400 });
    }

    try {
      const folder = await createWorkspaceFolder({
        createdByUserId: user.id,
        name: body.name ?? "",
        parentId: body.parentId?.trim() || null,
        participantKeys: Array.isArray(body.participantKeys)
          ? body.participantKeys.filter((value): value is string => typeof value === "string")
          : undefined,
      });

      return NextResponse.json({ entry: folder });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Folder could not be created.",
        },
        { status: 400 },
      );
    }
  }

  const formData = await request.formData();
  const parentId = (formData.get("parentId") as string | null)?.trim() || null;
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
      uploadedByUserId: user.id,
    });

    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Upload failed.",
      },
      { status: 400 },
    );
  }
}
