import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ChatClient } from "@/components/chat-client";

export default async function ChatPage() {
  const user = await requireUser();
  const room = await prisma.room.findFirst({
    where: {
      type: "PERSONAL",
      ownerUserId: user.id,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        take: 20,
      },
    },
  });

  const initialMessages =
    room?.messages
      .filter(
        (
          entry,
        ): entry is typeof entry & {
          role: "USER" | "AGENT";
        } => entry.role === "USER" || entry.role === "AGENT",
      )
      .map((entry) => ({
        id: entry.id,
        role: entry.role,
        content: entry.content,
      })) ?? [
      {
        id: "welcome-agent",
        role: "AGENT" as const,
        content: "안녕하세요. 무엇을 도와드릴까요?",
      },
    ];

  return (
    <section className="chat-page">
      <ChatClient initialMessages={initialMessages} />
    </section>
  );
}
