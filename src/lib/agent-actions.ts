import { getOrCreateAgentDmRoom } from "@/lib/dm";
import { prisma } from "@/lib/prisma";

type SendHumanDmAction = {
  message: string;
  toUsername: string;
};

type AgentActionParseResult = {
  actions: SendHumanDmAction[];
  visibleText: string;
};

const SEND_HUMAN_DM_BLOCK_REGEX =
  /<send-human-dm>\s*to:\s*@?([a-z0-9_-]+)\s*message:\s*([\s\S]*?)<\/send-human-dm>/gi;

export function parseAgentActions(text: string): AgentActionParseResult {
  const actions: SendHumanDmAction[] = [];

  const visibleText = text
    .replace(SEND_HUMAN_DM_BLOCK_REGEX, (_, rawUsername: string, rawMessage: string) => {
      const toUsername = rawUsername.trim().toLowerCase();
      const message = rawMessage.trim();

      if (toUsername && message) {
        actions.push({
          message,
          toUsername,
        });
      }

      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    actions,
    visibleText,
  };
}

export async function executeAgentActions({
  actions,
  senderAgentOpenclawId,
}: {
  actions: SendHumanDmAction[];
  senderAgentOpenclawId: string;
}) {
  const delivered: Array<{ roomId: string; toUsername: string }> = [];

  for (const action of actions) {
    const recipient = await prisma.user.findUnique({
      where: {
        username: action.toUsername,
      },
      select: {
        id: true,
        status: true,
        username: true,
      },
    });

    if (!recipient || recipient.status !== "ACTIVE") {
      continue;
    }

    const dmRoom = await getOrCreateAgentDmRoom(recipient.id, senderAgentOpenclawId);

    if (!dmRoom) {
      continue;
    }

    await prisma.message.create({
      data: {
        roomId: dmRoom.room.id,
        role: "AGENT",
        agentId: senderAgentOpenclawId,
        content: action.message,
      },
    });

    await prisma.room.update({
      where: {
        id: dmRoom.room.id,
      },
      data: {},
    });

    delivered.push({
      roomId: dmRoom.room.id,
      toUsername: recipient.username,
    });
  }

  return delivered;
}
