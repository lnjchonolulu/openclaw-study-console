import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  attachmentPreviewText,
  normalizeChatAttachments,
  parseChatPayload,
} from "@/lib/chat-attachments";
import { runTeamAgentDispatch } from "@/lib/team-agent-dispatcher";
import {
  createTeamMessage,
  getTeamChannelDetail,
  markTeamChannelAsRead,
} from "@/lib/team";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");
  const detail = await getTeamChannelDetail(user.id, roomId);

  if (!detail) {
    return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  }

  await markTeamChannelAsRead(detail.id, user.id);

  return NextResponse.json(detail);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await parseChatPayload(request);
  const roomId = body.roomId;
  const message = body.message;
  const replyToMessageId = body.replyToMessageId || null;

  if (!roomId || (!message && body.attachments.length === 0)) {
    return NextResponse.json(
      { error: "Room and message or image are required." },
      { status: 400 },
    );
  }

  const created = await createTeamMessage(
    user.id,
    roomId,
    message,
    body.attachments,
    replyToMessageId,
  );

  if (!created) {
    return NextResponse.json({ error: "Message could not be created." }, { status: 404 });
  }

  await markTeamChannelAsRead(roomId, user.id);

  const agentMessages = await runTeamAgentDispatch({
    roomId,
    triggeringMessageId: created.id,
  });

  return NextResponse.json({
    agentMessages,
    message: {
      author: created.user?.displayName ?? user.displayName,
      attachments: body.attachments,
      content: created.content,
      createdAt: created.createdAt.toISOString(),
      id: created.id,
      replyTo: created.replyToMessage
        ? {
            author:
              created.replyToMessage.user?.displayName ??
              created.replyToMessage.agent?.displayName ??
              "Unknown",
            content:
              created.replyToMessage.content ||
              attachmentPreviewText(
                normalizeChatAttachments(created.replyToMessage.attachmentsJson),
              ),
            id: created.replyToMessage.id,
            userId:
              created.replyToMessage.userId ??
              `agent:${created.replyToMessage.agentId ?? "unknown"}`,
          }
        : null,
      senderKey: created.userId ?? `agent:${created.agentId ?? "unknown"}`,
      userId: created.userId ?? user.id,
    },
  });
}
