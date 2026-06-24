import { requireUser } from "@/lib/auth";
import {
  getOrCreateAgentDmRoom,
  getOrCreatePersonDmRoom,
  getDmCollections,
  markRoomAsRead,
  serializeChatMessages,
} from "@/lib/dm";
import {
  getAgentMeta,
  getUserMeta,
  normalizeProfileConfig,
} from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { ChatClient } from "@/components/chat-client";
import { ensureFirstAgentOnboardingMessage } from "@/lib/agent-onboarding";

const INITIAL_DM_PAGE_SIZE = 100;

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[]; user?: string | string[] }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const selectedUserParam = query.user;
  let selectedUserId: string | null =
    typeof selectedUserParam === "string" ? selectedUserParam : null;
  const selectedAgentParam = query.agent;
  let selectedAgentId: string | null | undefined =
    !selectedUserId && typeof selectedAgentParam === "string"
      ? selectedAgentParam
      : user.agent?.openclawAgentId;

  if (!selectedUserId && !selectedAgentParam) {
    const { dmConversations } = await getDmCollections(user.id);
    const defaultConversation = dmConversations[0];

    if (defaultConversation?.kind === "person") {
      selectedUserId = defaultConversation.id;
      selectedAgentId = null;
    } else if (defaultConversation?.kind === "agent") {
      selectedAgentId = defaultConversation.id;
    }
  }

  if (
    !selectedUserId &&
    selectedAgentId &&
    selectedAgentId === user.agent?.openclawAgentId
  ) {
    await ensureFirstAgentOnboardingMessage(user.id);
  }

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
            createdAt: "desc",
          },
          take: INITIAL_DM_PAGE_SIZE + 1,
          include: {
            agent: {
              include: {
                user: true,
              },
            },
            replyToMessage: {
              include: {
                agent: {
                  include: {
                    user: true,
                  },
                },
                user: true,
              },
            },
            user: true,
          },
        },
      },
    }));

  const initialHasOlderMessages = Boolean(
    room && room.messages.length > INITIAL_DM_PAGE_SIZE,
  );

  if (room) {
    if (room.messages.length > INITIAL_DM_PAGE_SIZE) {
      room.messages = room.messages.slice(0, INITIAL_DM_PAGE_SIZE);
    }
    room.messages.reverse();
  }

  const initialMessages = room?.messages.length
    ? serializeChatMessages(room.messages, user.id)
    : [];

  return (
    <section className="chat-page">
      <ChatClient
        agentId={agentDmRoom?.targetAgent.openclawAgentId ?? null}
        counterpart={
          personDmRoom
            ? {
                avatar: {
                  kind: "user" as const,
                  config: normalizeProfileConfig(
                    personDmRoom.targetUser.profileConfigJson,
                    personDmRoom.targetUser.username,
                    "user",
                  ),
                },
                displayName: personDmRoom.targetUser.displayName,
                meta: getUserMeta(personDmRoom.targetUser.username),
              }
            : agentDmRoom
              ? {
                  avatar: {
                    kind: "agent" as const,
                    config: normalizeProfileConfig(
                      agentDmRoom.targetAgent.profileConfigJson,
                      `${agentDmRoom.targetAgent.user.username}-agent`,
                      "agent",
                    ),
                  },
                  displayName: agentDmRoom.targetAgent.displayName,
                  meta: getAgentMeta(agentDmRoom.targetAgent.user.username),
                }
              : null
        }
        initialHasOlderMessages={initialHasOlderMessages}
        initialMessages={initialMessages}
        key={
          personDmRoom
            ? `person:${personDmRoom.targetUser.id}`
            : `agent:${agentDmRoom?.targetAgent.openclawAgentId ?? "unassigned"}`
        }
        roomId={room?.id ?? null}
        recipientId={personDmRoom?.targetUser.id ?? null}
        recipientKind={personDmRoom ? "person" : "agent"}
        selfAvatar={{
          kind: "user" as const,
          config: normalizeProfileConfig(user.profileConfigJson, user.username, "user"),
        }}
      />
    </section>
  );
}
