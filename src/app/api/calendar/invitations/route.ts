import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { countPendingCalendarInvitations } from "@/lib/calendar";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const pendingCount = await countPendingCalendarInvitations(user.id);

  return NextResponse.json({ pendingCount });
}
