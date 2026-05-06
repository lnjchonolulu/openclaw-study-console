import { requireUser } from "@/lib/auth";
import {
  getOrCreateAgentDmRoom,
  getOrCreatePersonDmRoom,
  markRoomAsRead,
  serializeChatMessages,
} from "@/lib/dm";
import { prisma } from "@/lib/prisma";
import { ChatClient } from "@/components/chat-client";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[]; user?: string | string[] }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const selectedUserParam = query.user;
  const selectedUserId =
    typeof selectedUserParam === "string" ? selectedUserParam : null;
  const selectedAgentParam = query.agent;
  const selectedAgentId =
    !selectedUserId && typeof selectedAgentParam === "string"
      ? selectedAgentParam
      : user.agent?.openclawAgentId;
  const personDmRoom = selectedUserId
    ? await getOrCreatePersonDmRoom(user.id, selectedUserId)
    : null;
  const agentDmRoom =
    !selectedUserId && selectedAgentId
      ? await getOrCreateAgentDmRoom(user.id, selectedAgentId)
      : null;
  const selectedRoom = personDmRoom ?? agentDmRoom;

  if (selectedRoom) {
    await markRoomAsRead(selectedRoom.room.id, user.id);
  }

  const room =
    selectedRoom &&
    (await prisma.room.findUnique({
      where: {
        id: selectedRoom.room.id,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
          take: 100,
        },
      },
    }));

  const initialMessages =
    room?.messages.length
      ? serializeChatMessages(room.messages, user.id)
      : [
          {
            id: "welcome-agent",
            role: "AGENT" as const,
            content: `Hi. You are now talking with ${
              personDmRoom?.targetUser.displayName ??
              agentDmRoom?.targetAgent.displayName ??
              "your agent"
            }.`,
            createdAt: new Date().toISOString(),
          },
        ];

  return (
    <section className="chat-page">
      <ChatClient
        agentId={agentDmRoom?.targetAgent.openclawAgentId ?? null}
        initialMessages={initialMessages}
        key={
          personDmRoom
            ? `person:${personDmRoom.targetUser.id}`
            : `agent:${agentDmRoom?.targetAgent.openclawAgentId ?? "unassigned"}`
        }
        roomId={room?.id ?? null}
        recipientId={personDmRoom?.targetUser.id ?? null}
        recipientKind={personDmRoom ? "person" : "agent"}
      />
    </section>
  );
}
