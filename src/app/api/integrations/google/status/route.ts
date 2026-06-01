import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  disconnectGoogleIntegration,
  getGoogleIntegrationStatus,
} from "@/lib/google-integration";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json(await getGoogleIntegrationStatus());
}

export async function DELETE() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await disconnectGoogleIntegration();

  return NextResponse.json({ ok: true });
}
