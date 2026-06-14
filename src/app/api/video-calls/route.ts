import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createVideoCall,
  hasJoinedActiveVideoCall,
  listVideoCallInviteCandidates,
  listVideoCallState,
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
    invitedUserIds?: string[];
    name?: string;
  };
  const name = body.name?.trim();
  const invitedUserIds = Array.isArray(body.invitedUserIds) ? body.invitedUserIds : [];

  if (!name) {
    return NextResponse.json({ error: "Call name is required." }, { status: 400 });
  }

  if (await hasJoinedActiveVideoCall(user.id)) {
    return NextResponse.json(
      { error: "Leave your current call before joining or starting another one." },
      { status: 409 },
    );
  }

  try {
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
