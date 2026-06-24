import { createHash } from "node:crypto";
import { syncAgentMarkdownProjection } from "@/lib/agent-markdown-sync";
import {
  readAgentMarkdownFile,
  writeAgentMarkdownFile,
} from "@/lib/agent-workspace";
import type { OpenClawImageAttachment } from "@/lib/chat-attachments";

function extractAssistantText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const directTextKeys = ["output_text", "text", "message", "response"];

  for (const key of directTextKeys) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const output = candidate.output;
  if (Array.isArray(output)) {
    const fragments = output
      .flatMap((item) => {
        if (!item || typeof item !== "object") {
          return [];
        }

        const record = item as Record<string, unknown>;
        const content = record.content;

        if (!Array.isArray(content)) {
          return [];
        }

        return content
          .map((part) => {
            if (!part || typeof part !== "object") {
              return null;
            }

            const text = (part as Record<string, unknown>).text;
            return typeof text === "string" ? text : null;
          })
          .filter((text): text is string => Boolean(text));
      })
      .join("\n")
      .trim();

    if (fragments) {
      return fragments;
    }
  }

  const payloads = candidate.payloads;
  if (Array.isArray(payloads)) {
    const fragments = payloads
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const text = (item as Record<string, unknown>).text;
        return typeof text === "string" ? text : null;
      })
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n")
      .trim();

    if (fragments) {
      return fragments;
    }
  }

  return null;
}

export type OpenClawFunctionTool = {
  description?: string;
  name: string;
  parameters: Record<string, unknown>;
};

export type OpenClawFunctionCall = {
  argumentsJson: string;
  callId: string;
  name: string;
};

const PROTECTED_MARKDOWN_FILES = [
  "USER.md",
  "IDENTITY.md",
  "SOUL.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "WORKLOG.md",
] as const;

const SESSION_MEMORY_VERSION_FILES = [
  "USER.md",
  "IDENTITY.md",
  "SOUL.md",
  "HEARTBEAT.md",
] as const;

function readPositiveInteger(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getResponsesEndpoint() {
  const configuredUrl = process.env.OPENCLAW_RESPONSES_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();

  if (!gatewayUrl) {
    throw new Error("Missing OPENCLAW_GATEWAY_URL or OPENCLAW_RESPONSES_URL.");
  }

  if (gatewayUrl.startsWith("ws://")) {
    return `${gatewayUrl.replace(/^ws:\/\//, "http://")}/v1/responses`;
  }

  if (gatewayUrl.startsWith("wss://")) {
    return `${gatewayUrl.replace(/^wss:\/\//, "https://")}/v1/responses`;
  }

  if (gatewayUrl.startsWith("http://") || gatewayUrl.startsWith("https://")) {
    return gatewayUrl.endsWith("/v1/responses") ? gatewayUrl : `${gatewayUrl}/v1/responses`;
  }

  throw new Error("Unsupported OpenClaw gateway URL format.");
}

async function snapshotProtectedMarkdown(agentId: string) {
  const entries = await Promise.all(
    PROTECTED_MARKDOWN_FILES.map(async (fileName) => [
      fileName,
      await readAgentMarkdownFile(agentId, fileName),
    ] as const),
  );

  return new Map(entries);
}

async function buildAgentMemoryVersion(agentId: string) {
  const hash = createHash("sha256");

  for (const fileName of SESSION_MEMORY_VERSION_FILES) {
    hash.update(`\n--- ${fileName} ---\n`);
    hash.update(await readAgentMarkdownFile(agentId, fileName));
  }

  if (process.env.CYWORLD_AGENT_SESSION_INCLUDE_AGENTS_MD === "1") {
    hash.update("\n--- AGENTS.md ---\n");
    hash.update(await readAgentMarkdownFile(agentId, "AGENTS.md"));
  }

  return hash.digest("hex").slice(0, 12);
}

function formatOpenClawConversationKey({
  logicalKey,
  memoryVersion,
}: {
  logicalKey: string;
  memoryVersion: string;
}) {
  const digest = createHash("sha256").update(logicalKey).digest("hex").slice(0, 10);
  const safeLabel =
    logicalKey
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "turn";

  return `cyworld-${safeLabel}-${digest}-mem-${memoryVersion}`;
}

function shouldLogConversationKeyDebug() {
  return process.env.CYWORLD_OPENCLAW_SESSION_DEBUG === "1";
}

function looksLikeDangerousMarkdownOverwrite({
  after,
  before,
}: {
  after: string;
  before: string;
}) {
  const beforeTrimmed = before.trim();
  const afterTrimmed = after.trim();

  if (beforeTrimmed.length < 400 || !afterTrimmed) {
    return false;
  }

  const beforeHeading = before.match(/^# .+$/m)?.[0] ?? null;
  const afterHasOriginalHeading = beforeHeading ? after.includes(beforeHeading) : true;
  const lostMostContent = afterTrimmed.length < Math.min(300, beforeTrimmed.length * 0.35);
  const collapsedToOneSection = beforeTrimmed.split(/\r?\n/).length >= 12 &&
    afterTrimmed.split(/\r?\n/).length <= 4;

  return !afterHasOriginalHeading || lostMostContent || collapsedToOneSection;
}

function responseContainsMarkdownEditFailure(text: string) {
  return /(?:^|\n)[^\n]*(?:⚠️\s*)?(?:📝\s*)?Edit:\s*[^\n]*\bfailed\b/i.test(text);
}

function guardMarkdownEditFailureClaim(text: string) {
  if (!responseContainsMarkdownEditFailure(text)) {
    return text;
  }

  return `${text}\n\nCyWorld detected that a markdown edit failed, so any preference, memory, or file change mentioned above was not confirmed as saved. Treat it as unsaved until the workspace file is successfully updated.`;
}

async function restoreDangerousMarkdownOverwrites({
  agentId,
  beforeSnapshot,
}: {
  agentId: string;
  beforeSnapshot: Map<string, string>;
}) {
  const restoredFiles: string[] = [];

  for (const fileName of PROTECTED_MARKDOWN_FILES) {
    const before = beforeSnapshot.get(fileName) ?? "";
    const after = await readAgentMarkdownFile(agentId, fileName);

    if (!looksLikeDangerousMarkdownOverwrite({ after, before })) {
      continue;
    }

    await writeAgentMarkdownFile(agentId, fileName, before);
    restoredFiles.push(fileName);
  }

  return restoredFiles;
}

async function invokeOpenClawResponse({
  agentId,
  input,
  instructions,
  previousResponseId,
  tools,
  conversationKey,
}: {
  agentId: string;
  input: string | Array<Record<string, unknown>>;
  instructions?: string;
  previousResponseId?: string;
  tools?: OpenClawFunctionTool[];
  conversationKey: string;
}) {
  const endpoint = getResponsesEndpoint();
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      ...(instructions ? { instructions } : {}),
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      ...(tools?.length
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          }
        : {}),
      input,
      user: conversationKey,
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const structuredError =
      payload.error && typeof payload.error === "object"
        ? JSON.stringify(payload.error)
        : null;
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : structuredError
          ? structuredError
        : `OpenClaw HTTP API returned ${response.status}.`,
    );
  }

  return payload;
}

function buildOpenClawUserInput(
  message: string,
  imageAttachments?: OpenClawImageAttachment[],
) {
  const images = imageAttachments ?? [];

  if (images.length === 0) {
    return message;
  }

  return [
    {
      role: "user",
      content: [
        ...(message.trim()
          ? [
              {
                type: "input_text",
                text: message,
              },
            ]
          : []),
        ...images.map((image) => ({
          type: "input_image",
          image_url: image.dataUrl,
        })),
      ],
    },
  ];
}

function extractFunctionCalls(payload: unknown): OpenClawFunctionCall[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidate = payload as Record<string, unknown>;
  const output = candidate.output;

  if (!Array.isArray(output)) {
    return [];
  }

  return output.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const type = record.type;

    if (type !== "function_call") {
      return [];
    }

    const name =
      typeof record.name === "string"
        ? record.name
        : typeof (record.function as Record<string, unknown> | undefined)?.name === "string"
          ? ((record.function as Record<string, unknown>).name as string)
          : null;

    const callId =
      typeof record.call_id === "string"
        ? record.call_id
        : typeof record.id === "string"
          ? record.id
          : null;

    const argumentsJson =
      typeof record.arguments === "string"
        ? record.arguments
        : typeof (record.function as Record<string, unknown> | undefined)?.arguments === "string"
          ? ((record.function as Record<string, unknown>).arguments as string)
          : null;

    if (!name || !callId || !argumentsJson) {
      return [];
    }

    return [
      {
        argumentsJson,
        callId,
        name,
      },
    ];
  });
}

export async function runAgentTurn({
  agentId,
  imageAttachments,
  instructions,
  message,
  conversationKey,
  tools,
  onToolCall,
  onToolRoundCheckpoint,
}: {
  agentId: string;
  imageAttachments?: OpenClawImageAttachment[];
  instructions?: string;
  message: string;
  conversationKey: string;
  tools?: OpenClawFunctionTool[];
  onToolCall?: (call: OpenClawFunctionCall) => Promise<string>;
  onToolRoundCheckpoint?: (input: {
    pendingCalls: OpenClawFunctionCall[];
    responseId?: string;
    toolRounds: number;
  }) => Promise<void>;
}) {
  const markdownSnapshot = await snapshotProtectedMarkdown(agentId);
  const memoryVersion = await buildAgentMemoryVersion(agentId);
  const versionedConversationKey = formatOpenClawConversationKey({
    logicalKey: conversationKey,
    memoryVersion,
  });

  if (shouldLogConversationKeyDebug()) {
    console.info("[openclaw] conversation key", {
      agentId,
      logicalKey: conversationKey,
      memoryVersion,
      requestUser: versionedConversationKey,
    });
  }

  const checkpointInterval = readPositiveInteger(
    "CYWORLD_OPENCLAW_TOOL_ROUND_CHECKPOINT",
    10,
  );
  const emergencyRoundLimit = Math.max(
    checkpointInterval,
    readPositiveInteger("CYWORLD_OPENCLAW_EMERGENCY_TOOL_ROUND_LIMIT", 100),
  );
  let toolRounds = 0;
  let payload = await invokeOpenClawResponse({
    agentId,
    input: buildOpenClawUserInput(message, imageAttachments),
    instructions,
    tools,
    conversationKey: versionedConversationKey,
  });

  if (tools?.length && onToolCall) {
    while (toolRounds < emergencyRoundLimit) {
      const functionCalls = extractFunctionCalls(payload);

      if (functionCalls.length === 0) {
        break;
      }

      const outputs = await Promise.all(
        functionCalls.map(async (call) => ({
          call_id: call.callId,
          output: await onToolCall(call),
          type: "function_call_output",
        })),
      );

      payload = await invokeOpenClawResponse({
        agentId,
        input: outputs,
        instructions,
        previousResponseId: typeof payload.id === "string" ? payload.id : undefined,
        tools,
        conversationKey: versionedConversationKey,
      });
      toolRounds += 1;

      const pendingCalls = extractFunctionCalls(payload);

      if (
        pendingCalls.length > 0 &&
        toolRounds % checkpointInterval === 0
      ) {
        const checkpoint = {
          pendingCalls,
          responseId: typeof payload.id === "string" ? payload.id : undefined,
          toolRounds,
        };

        if (onToolRoundCheckpoint) {
          await onToolRoundCheckpoint(checkpoint);
        } else {
          console.info("[openclaw] continuing after tool-round checkpoint", {
            agentId,
            conversationKey,
            pendingToolNames: pendingCalls.map((call) => call.name),
            toolRounds,
          });
        }
      }
    }

    if (extractFunctionCalls(payload).length > 0) {
      throw new Error(
        `OpenClaw exceeded the emergency tool execution limit (${emergencyRoundLimit} rounds).`,
      );
    }
  }

  const assistantText = extractAssistantText(payload);

  if (!assistantText) {
    console.log("[openclaw] empty assistant payload", { agentId, conversationKey, payload });
    throw new Error("OpenClaw returned an empty assistant response.");
  }

  const restoredMarkdownFiles = await restoreDangerousMarkdownOverwrites({
    agentId,
    beforeSnapshot: markdownSnapshot,
  });

  try {
    await syncAgentMarkdownProjection(agentId);
  } catch (error) {
    console.warn("[openclaw] failed to sync markdown projection", {
      agentId,
      error,
    });
  }

  const guardedAssistantText = guardMarkdownEditFailureClaim(assistantText);

  return {
    assistantText: restoredMarkdownFiles.length
      ? `${guardedAssistantText}\n\nCyWorld blocked a risky full-file markdown overwrite in ${restoredMarkdownFiles.join(
          ", ",
        )}. Please make a smaller targeted edit that preserves the existing file structure.`
      : guardedAssistantText,
    payload,
    toolRounds,
  };
}
