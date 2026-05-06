import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDmCollections } from "@/lib/dm";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { dmConversations } = await getDmCollections(user.id);

  return NextResponse.json({
    conversations: dmConversations,
  });
}
