import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

  return null;
}

function parseCliJson(stdout: string) {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const lastBrace = trimmed.lastIndexOf("{");

    if (lastBrace === -1) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(lastBrace));
    } catch {
      return null;
    }
  }
}

export async function runAgentTurn({
  agentId,
  message,
}: {
  agentId: string;
  message: string;
}) {
  const { stdout, stderr } = await execFileAsync(
    "openclaw",
    [
      "agent",
      "--local",
      "--agent",
      agentId,
      "--message",
      message,
      "--json",
      "--no-color",
    ],
    {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    },
  );

  const parsed = parseCliJson(stdout);
  const assistantText = extractAssistantText(parsed);

  return {
    assistantText: assistantText ?? stdout.trim(),
    stdout,
    stderr,
  };
}
