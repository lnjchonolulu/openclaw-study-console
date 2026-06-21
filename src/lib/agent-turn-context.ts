import { prisma } from "@/lib/prisma";

const DEFAULT_TURN_CONTEXT_TTL_MINUTES = 45;

function turnContextExpiresAt() {
  return new Date(Date.now() + DEFAULT_TURN_CONTEXT_TTL_MINUTES * 60 * 1000);
}

export async function createAgentTurnContext({
  agentOpenclawId,
  currentHumanUserId,
  objective,
  requesterUserId,
  sourceRoomId,
  taskId,
  triggerType,
}: {
  agentOpenclawId: string;
  currentHumanUserId?: string | null;
  objective?: string | null;
  requesterUserId?: string | null;
  sourceRoomId?: string | null;
  taskId?: string | null;
  triggerType?: string | null;
}) {
  return prisma.agentTurnContext.create({
    data: {
      agentId: agentOpenclawId,
      currentHumanUserId: currentHumanUserId ?? null,
      expiresAt: turnContextExpiresAt(),
      objective: objective?.trim() || null,
      requesterUserId: requesterUserId ?? null,
      sourceRoomId: sourceRoomId ?? null,
      taskId: taskId ?? null,
      triggerType: triggerType ?? null,
    },
  });
}

export async function loadValidAgentTurnContext({
  agentOpenclawId,
  turnContextId,
}: {
  agentOpenclawId: string;
  turnContextId: string;
}) {
  const context = await prisma.agentTurnContext.findUnique({
    where: {
      id: turnContextId,
    },
  });

  if (!context || context.agentId !== agentOpenclawId) {
    return null;
  }

  if (context.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return context;
}

export function formatAgentTurnContextInstruction(turnContextId: string) {
  return `## CyWorld Plugin Turn Context

If a CyWorld plugin tool asks for a turnContextId, use this exact value: ${turnContextId}

This id is only for CyWorld plugin tool execution. Do not mention it to users.`;
}
