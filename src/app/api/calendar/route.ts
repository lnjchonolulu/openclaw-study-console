import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createCalendarEvent, listCalendarMonth } from "@/lib/calendar";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const view = await listCalendarMonth(user.id, url.searchParams.get("month"));

  if (!view) {
    return NextResponse.json({ error: "Calendar could not be loaded." }, { status: 400 });
  }

  return NextResponse.json(view);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    allDay?: boolean;
    description?: string;
    endAt?: string;
    invitedUserIds?: string[];
    location?: string;
    startAt?: string;
    title?: string;
  };
  const startAt = body.startAt ? new Date(body.startAt) : null;
  const endAt = body.endAt ? new Date(body.endAt) : null;

  if (!startAt || Number.isNaN(startAt.getTime()) || !endAt || Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: "Valid start and end times are required." }, { status: 400 });
  }

  try {
    const event = await createCalendarEvent({
      allDay: body.allDay,
      createdByUserId: user.id,
      description: body.description,
      endAt,
      invitedUserIds: Array.isArray(body.invitedUserIds) ? body.invitedUserIds : [],
      location: body.location,
      startAt,
      title: body.title ?? "",
    });

    return NextResponse.json({
      eventId: event.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Event could not be created.",
      },
      { status: 400 },
    );
  }
}
