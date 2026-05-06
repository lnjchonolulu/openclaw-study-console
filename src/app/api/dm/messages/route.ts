import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");

  if (!roomId) {
    return NextResponse.json({ error: "Room is required." }, { status: 400 });
  }

  const room = await prisma.room.findFirst({
    where: {
      id: roomId,
      members: {
        some: {
          userId: user.id,
        },
      },
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        take: 50,
      },
    },
  });

  if (!room) {
    return NextResponse.json({ error: "Room was not found." }, { status: 404 });
  }

  return NextResponse.json({
    messages: room.messages
      .filter((message) => message.role === "USER" || message.role === "AGENT")
      .map((message) => ({
        id: message.id,
        role:
          message.role === "AGENT"
            ? "AGENT"
            : message.userId === user.id
              ? "USER"
              : "OTHER",
        content: message.content,
      })),
  });
}
