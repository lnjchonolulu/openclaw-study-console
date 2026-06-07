import { AgentTaskEventType, type Prisma } from "@prisma/client";

import { recordAgentActionReceipt } from "@/lib/action-receipts";
import { sendAgentDm } from "@/lib/internal-agent-actions";
import { prisma } from "@/lib/prisma";

export type AgentReportDestination =
  | "source_room"
  | "requester_dm"
  | "owner_dm";

type ReportDeliveryResult =
  | {
      destination: AgentReportDestination;
      messageId: string;
      ok: true;
      roomId: string;
    }
  | {
      attemptedDestinations: AgentReportDestination[];
      ok: false;
      reason: string;
    };

async function deliverToSourceRoom({
  agentOpenclawId,
  message,
  sourceRoomId,
  taskId,
}: {
  agentOpenclawId: string;
  message: string;
  sourceRoomId?: string | null;
  taskId?: string | null;
}) {
  if (!sourceRoomId) {
    return {
      ok: false as const,
      reason: "source_room_missing",
    };
  }

  const room = await prisma.room.findFirst({
    where: {
      id: sourceRoomId,
      agents: {
        some: {
          agent: {
            openclawAgentId: agentOpenclawId,
          },
          canRespond: true,
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (!room) {
    return {
      ok: false as const,
      reason: "source_room_unavailable",
    };
  }

  const createdMessage = await prisma.message.create({
    data: {
      agentId: agentOpenclawId,
      content: message,
      role: "AGENT",
      roomId: room.id,
      taskId: taskId ?? null,
    },
  });

  await prisma.room.update({
    where: {
      id: room.id,
    },
    data: {},
  });

  return {
    messageId: createdMessage.id,
    ok: true as const,
    roomId: room.id,
  };
}

function uniqueDestinations(destinations: AgentReportDestination[]) {
  return destinations.filter(
    (destination, index) => destinations.indexOf(destination) === index,
  );
}

export async function deliverAgentReport({
  agentOpenclawId,
  message,
  requestedDestination,
  requesterUserId,
  requesterUsername,
  sourceRoomId,
  taskId,
}: {
  agentOpenclawId: string;
  message: string;
  requestedDestination?: AgentReportDestination | null;
  requesterUserId?: string | null;
  requesterUsername?: string | null;
  sourceRoomId?: string | null;
  taskId?: string | null;
}): Promise<ReportDeliveryResult> {
  const agent = await prisma.agent.findUnique({
    where: {
      openclawAgentId: agentOpenclawId,
    },
    select: {
      user: {
        select: {
          username: true,
        },
      },
    },
  });

  if (!agent) {
    return {
      attemptedDestinations: [],
      ok: false,
      reason: "agent_not_found",
    };
  }

  const destinations = uniqueDestinations([
    ...(requestedDestination ? [requestedDestination] : []),
    "source_room",
    "owner_dm",
  ]);
  const failures: Array<{
    destination: AgentReportDestination;
    reason: string;
  }> = [];

  for (const destination of destinations) {
    if (destination === "source_room") {
      const delivery = await deliverToSourceRoom({
        agentOpenclawId,
        message,
        sourceRoomId,
        taskId,
      });

      if (delivery.ok) {
        await recordAgentActionReceipt({
          action: "report_result",
          agentOpenclawId,
          eventType: AgentTaskEventType.OUTBOUND_MESSAGE,
          payload: {
            destination,
            message,
            messageId: delivery.messageId,
            roomId: delivery.roomId,
          } satisfies Prisma.InputJsonValue,
          status: "success",
          summary: "Reported task result to its source CyWorld room.",
          requesterUserId,
          sourceRoomId,
          taskId,
        });

        return {
          destination,
          messageId: delivery.messageId,
          ok: true,
          roomId: delivery.roomId,
        };
      }

      failures.push({
        destination,
        reason: delivery.reason,
      });
      continue;
    }

    const toUsername =
      destination === "requester_dm"
        ? requesterUsername?.trim()
        : agent.user.username;

    if (!toUsername) {
      failures.push({
        destination,
        reason: "recipient_missing",
      });
      continue;
    }

    const delivery = await sendAgentDm({
      message,
      senderAgentOpenclawId: agentOpenclawId,
      taskId,
      toUsername,
    });

    if (delivery.ok && delivery.messageId && delivery.roomId) {
      await recordAgentActionReceipt({
        action: "report_result",
        agentOpenclawId,
        eventType: AgentTaskEventType.OUTBOUND_MESSAGE,
        payload: {
          destination,
          message,
          messageId: delivery.messageId,
          roomId: delivery.roomId,
          toUsername,
        } satisfies Prisma.InputJsonValue,
        status: "success",
        summary:
          destination === "requester_dm"
            ? `Reported task result to requester @${toUsername}.`
            : `Reported task result to owner @${toUsername}.`,
        requesterUserId,
        sourceRoomId,
        taskId,
      });

      return {
        destination,
        messageId: delivery.messageId,
        ok: true,
        roomId: delivery.roomId,
      };
    }

    failures.push({
      destination,
      reason: delivery.reason ?? "delivery_failed",
    });
  }

  await recordAgentActionReceipt({
    action: "report_result",
    agentOpenclawId,
    eventType: AgentTaskEventType.SYSTEM_NOTE,
    payload: {
      failures,
      message,
    } satisfies Prisma.InputJsonValue,
    status: "failure",
    summary: "Could not deliver the task result to an available CyWorld destination.",
    requesterUserId,
    sourceRoomId,
    taskId,
  });

  return {
    attemptedDestinations: destinations,
    ok: false,
    reason: failures.map((failure) => failure.reason).join(", ") || "delivery_failed",
  };
}
