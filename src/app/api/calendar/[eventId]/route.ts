import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteCalendarEventForUser, updateCalendarEvent } from "@/lib/calendar";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await params;
  const body = (await request.json()) as {
    description?: string;
    endAt?: string;
    invitedUserIds?: string[];
    location?: string;
    startAt?: string;
    title?: string;
  };
  const startAt = body.startAt ? new Date(body.startAt) : undefined;
  const endAt = body.endAt ? new Date(body.endAt) : undefined;

  if (
    (startAt && Number.isNaN(startAt.getTime())) ||
    (endAt && Number.isNaN(endAt.getTime()))
  ) {
    return NextResponse.json({ error: "Valid start and end times are required." }, { status: 400 });
  }

  try {
    await updateCalendarEvent({
      description: body.description,
      endAt,
      eventId,
      invitedUserIds: Array.isArray(body.invitedUserIds) ? body.invitedUserIds : undefined,
      location: body.location,
      startAt,
      title: body.title,
      userId: user.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Event could not be updated.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { eventId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    mode?: "DECLINE" | "HIDE";
  };

  try {
    await deleteCalendarEventForUser({
      eventId,
      mode: body.mode === "DECLINE" ? "DECLINE" : "HIDE",
      userId: user.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Event could not be deleted.",
      },
      { status: 400 },
    );
  }
}
