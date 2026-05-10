import { homedir } from "node:os";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const OPENCLAW_ROOT = path.join(homedir(), ".openclaw");
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_ROOT, "openclaw.json");

export function getAgentWorkspacePath(agentId: string) {
  return path.join(OPENCLAW_ROOT, `workspace-${agentId}`);
}

export function getAgentFilePath(agentId: string, fileName: string) {
  return path.join(getAgentWorkspacePath(agentId), fileName);
}

export async function readAgentMarkdownFile(agentId: string, fileName: string) {
  try {
    return await readFile(getAgentFilePath(agentId, fileName), "utf8");
  } catch {
    return "";
  }
}

export async function writeAgentMarkdownFile(
  agentId: string,
  fileName: string,
  content: string,
) {
  await writeFile(getAgentFilePath(agentId, fileName), content, "utf8");
}

export function extractMarkdownBulletValue(source: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`- \\*\\*${escapedLabel}:\\*\\*\\s*(.+)$`, "m"));
  return match?.[1]?.trim() || null;
}

type OpenClawConfig = {
  agents?: {
    list?: Array<{
      id?: string;
      heartbeat?: {
        every?: string;
        target?: string;
        lightContext?: boolean;
        isolatedSession?: boolean;
      };
    }>;
  };
};

async function readOpenClawConfig(): Promise<OpenClawConfig | null> {
  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return null;
  }
}

export async function readHeartbeatEnabled(agentId: string) {
  const config = await readOpenClawConfig();
  const agent = config?.agents?.list?.find((candidate) => candidate.id === agentId);
  return Boolean(agent?.heartbeat?.every && agent.heartbeat.every !== "0m");
}

export async function writeHeartbeatEnabled(agentId: string, enabled: boolean) {
  const config = await readOpenClawConfig();

  if (!config?.agents?.list) {
    return;
  }

  const agent = config.agents.list.find((candidate) => candidate.id === agentId);

  if (!agent) {
    return;
  }

  agent.heartbeat = {
    every: enabled ? "3h" : "0m",
    target: "none",
    lightContext: true,
    isolatedSession: true,
  };

  await writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
