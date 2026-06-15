import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createVideoCall,
  hasJoinedActiveVideoCall,
  listVideoCallInviteCandidates,
  listVideoCallState,
  scheduleVideoCall,
} from "@/lib/video-calls";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [state, inviteCandidates] = await Promise.all([
    listVideoCallState(user.id),
    listVideoCallInviteCandidates(user.id),
  ]);

  return NextResponse.json({
    ...state,
    inviteCandidates,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    endAt?: string;
    invitedUserIds?: string[];
    mode?: "START" | "SCHEDULE";
    name?: string;
    startAt?: string;
  };
  const name = body.name?.trim();
  const invitedUserIds = Array.isArray(body.invitedUserIds) ? body.invitedUserIds : [];

  if (!name) {
    return NextResponse.json({ error: "Call name is required." }, { status: 400 });
  }

  try {
    if (body.mode === "SCHEDULE") {
      const startAt = body.startAt ? new Date(body.startAt) : null;
      const endAt = body.endAt ? new Date(body.endAt) : null;

      if (!startAt || Number.isNaN(startAt.getTime()) || !endAt || Number.isNaN(endAt.getTime())) {
        return NextResponse.json(
          { error: "Valid start and end times are required." },
          { status: 400 },
        );
      }

      const call = await scheduleVideoCall({
        createdByUserId: user.id,
        endAt,
        invitedUserIds,
        name,
        startAt,
      });

      return NextResponse.json({ call });
    }

    if (await hasJoinedActiveVideoCall(user.id)) {
      return NextResponse.json(
        { error: "Leave your current call before starting another one." },
        { status: 409 },
      );
    }

    const call = await createVideoCall({
      createdByUserId: user.id,
      invitedUserIds,
      name,
    });

    return NextResponse.json({ call });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Call could not be created." },
      { status: 400 },
    );
  }
}
