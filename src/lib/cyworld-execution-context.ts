export type CyWorldExecutionContext = {
  actingAgentOpenclawId: string;
  currentHumanUserId?: string | null;
  initiatedByUserId?: string | null;
  originRoomId?: string | null;
  taskId?: string | null;
  triggerType?: string | null;
};

export function isExternalAgentHandoff(context: CyWorldExecutionContext) {
  return context.triggerType === "agent_handoff";
}
