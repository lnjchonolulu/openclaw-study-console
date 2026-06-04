import { AgentTaskEventType } from "@prisma/client";

import { getOrCreateAgentDmRoom } from "@/lib/dm";
import { recordAgentActionReceipt } from "@/lib/action-receipts";
import { prisma } from "@/lib/prisma";

export function verifyInternalAgentActionToken(request: Request) {
  const expected = process.env.INTERNAL_AGENT_ACTION_TOKEN?.trim();

  if (!expected) {
    return false;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  return token.length > 0 && token === expected;
}

export async function sendAgentDm({
  message,
  replyToMessageId,
  senderAgentOpenclawId,
  taskId,
  toUsername,
}: {
  message: string;
  replyToMessageId?: string | null;
  senderAgentOpenclawId: string;
  taskId?: string | null;
  toUsername: string;
}) {
  const recipient = await prisma.user.findUnique({
    where: {
      username: toUsername.toLowerCase(),
    },
    select: {
      id: true,
      status: true,
      username: true,
    },
  });

  if (!recipient || recipient.status !== "ACTIVE") {
    return {
      ok: false,
      reason: "recipient_not_found",
      toUsername,
    };
  }

  const dmRoom = await getOrCreateAgentDmRoom(recipient.id, senderAgentOpenclawId);

  if (!dmRoom) {
    return {
      ok: false,
      reason: "dm_room_unavailable",
      toUsername,
    };
  }

  const createdMessage = await prisma.message.create({
    data: {
      roomId: dmRoom.room.id,
      role: "AGENT",
      agentId: senderAgentOpenclawId,
      taskId: taskId ?? null,
      replyToMessageId: replyToMessageId ?? null,
      content: message,
    },
  });

  await prisma.room.update({
    where: {
      id: dmRoom.room.id,
    },
    data: {},
  });

  return {
    ok: true,
    messageId: createdMessage.id,
    roomId: dmRoom.room.id,
    toUsername: recipient.username,
  };
}

export async function scheduleAgentDm({
  deliverAt,
  message,
  senderAgentOpenclawId,
  taskId,
  toUsername,
}: {
  deliverAt: Date;
  message: string;
  senderAgentOpenclawId: string;
  taskId?: string | null;
  toUsername: string;
}) {
  const recipient = await prisma.user.findUnique({
    where: {
      username: toUsername.toLowerCase(),
    },
    select: {
      id: true,
      status: true,
      username: true,
    },
  });

  if (!recipient || recipient.status !== "ACTIVE") {
    return {
      ok: false,
      reason: "recipient_not_found",
      toUsername,
    };
  }

  const dmRoom = await getOrCreateAgentDmRoom(recipient.id, senderAgentOpenclawId);

  if (!dmRoom) {
    return {
      ok: false,
      reason: "dm_room_unavailable",
      toUsername,
    };
  }

  const scheduled = await prisma.scheduledMessage.create({
    data: {
      roomId: dmRoom.room.id,
      agentId: senderAgentOpenclawId,
      toUserId: recipient.id,
      taskId: taskId ?? null,
      content: message,
      deliverAt,
    },
  });

  return {
    ok: true,
    scheduledMessageId: scheduled.id,
    deliverAt: scheduled.deliverAt.toISOString(),
    roomId: dmRoom.room.id,
    toUsername: recipient.username,
  };
}

export async function deliverDueScheduledMessages(now = new Date()) {
  const dueMessages = await prisma.scheduledMessage.findMany({
    where: {
      status: "PENDING",
      deliverAt: {
        lte: now,
      },
    },
    orderBy: {
      deliverAt: "asc",
    },
    take: 25,
  });

  const results = [];

  for (const scheduled of dueMessages) {
    try {
      const createdMessage = await prisma.message.create({
        data: {
          roomId: scheduled.roomId,
          role: "AGENT",
          agentId: scheduled.agentId,
          taskId: scheduled.taskId,
          content: scheduled.content,
        },
      });

      await prisma.scheduledMessage.update({
        where: {
          id: scheduled.id,
        },
        data: {
          status: "SENT",
          error: null,
        },
      });

      await prisma.room.update({
        where: {
          id: scheduled.roomId,
        },
        data: {},
      });

      if (scheduled.taskId) {
        await recordAgentActionReceipt({
          action: "deliver_scheduled_dm",
          agentOpenclawId: scheduled.agentId,
          eventType: AgentTaskEventType.OUTBOUND_MESSAGE,
          payload: {
            messageId: createdMessage.id,
            scheduledMessageId: scheduled.id,
          },
          status: "success",
          summary: "Delivered scheduled CyWorld DM.",
          taskId: scheduled.taskId,
        });
      }

      results.push({
        ok: true,
        messageId: createdMessage.id,
        scheduledMessageId: scheduled.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown delivery error.";

      await prisma.scheduledMessage.update({
        where: {
          id: scheduled.id,
        },
        data: {
          status: "FAILED",
          error: message,
        },
      });

      if (scheduled.taskId) {
        await recordAgentActionReceipt({
          action: "deliver_scheduled_dm",
          agentOpenclawId: scheduled.agentId,
          eventType: AgentTaskEventType.SYSTEM_NOTE,
          payload: {
            error: message,
            scheduledMessageId: scheduled.id,
          },
          status: "failure",
          summary: `Scheduled CyWorld DM delivery failed: ${message}`,
          taskId: scheduled.taskId,
        });
      }

      results.push({
        ok: false,
        reason: message,
        scheduledMessageId: scheduled.id,
      });
    }
  }

  return results;
}
