import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { respondToCalendarInvitation } from "@/lib/calendar";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { invitationId } = await params;
  const body = (await request.json()) as {
    status?: string;
  };
  const status = body.status === "ACCEPTED" ? "ACCEPTED" : body.status === "DECLINED" ? "DECLINED" : null;

  if (!status) {
    return NextResponse.json({ error: "Unsupported invitation response." }, { status: 400 });
  }

  try {
    await respondToCalendarInvitation({
      invitationId,
      status,
      userId: user.id,
    });

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invitation could not be updated.",
      },
      { status: 400 },
    );
  }
}
