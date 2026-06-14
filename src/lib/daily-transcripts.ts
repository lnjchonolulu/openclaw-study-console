import { prisma } from "@/lib/prisma";

type JsonRecord = Record<string, unknown>;

type DailyTranscriptEvent = {
  directUrl?: string;
  eventType: string;
  roomName?: string;
  transcriptId?: string;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nested(record: JsonRecord | null, key: string): JsonRecord | null {
  return asRecord(record?.[key]);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = stringFrom(value);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function extractRoomName(payload: JsonRecord): string | undefined {
  const room = payload.room;
  const roomRecord = asRecord(room);

  return firstString(
    payload.room_name,
    payload.roomName,
    roomRecord?.name,
    typeof room === "string" ? room : undefined,
    nested(payload, "meeting_session")?.room_name,
    nested(payload, "meetingSession")?.roomName,
  );
}

function extractTranscriptId(payload: JsonRecord): string | undefined {
  const transcript = nested(payload, "transcript");

  return firstString(
    payload.transcript_id,
    payload.transcriptId,
    payload.transcription_id,
    payload.transcriptionId,
    transcript?.id,
    transcript?.transcript_id,
    payload.id,
  );
}

function extractDirectUrl(payload: JsonRecord): string | undefined {
  const transcript = nested(payload, "transcript");

  return firstString(
    payload.download_url,
    payload.downloadUrl,
    payload.access_link,
    payload.accessLink,
    payload.url,
    transcript?.download_url,
    transcript?.downloadUrl,
    transcript?.access_link,
    transcript?.accessLink,
    transcript?.url,
  );
}

function extractTranscriptEvent(body: unknown): DailyTranscriptEvent | null {
  const root = asRecord(body);

  if (!root) {
    return null;
  }

  const payload = asRecord(root.payload) ?? asRecord(root.data) ?? root;
  const eventType = firstString(root.type, root.event, root.name, payload.type) ?? "";
  const roomName = extractRoomName(payload);
  const transcriptId = extractTranscriptId(payload);
  const directUrl = extractDirectUrl(payload);
  const eventLooksRelevant =
    eventType.toLowerCase().includes("transcript") ||
    Boolean(roomName && (transcriptId || directUrl));

  if (!eventLooksRelevant) {
    return null;
  }

  return {
    directUrl,
    eventType,
    roomName,
    transcriptId,
  };
}

function extractAccessLink(payload: unknown): string | undefined {
  const record = asRecord(payload);

  if (!record) {
    return undefined;
  }

  return firstString(
    record.download_link,
    record.downloadLink,
    record.access_link,
    record.accessLink,
    record.url,
    record.link,
  );
}

function formatJsonTranscript(value: unknown): string | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const directText = firstString(record.transcript, record.text, record.content);

  if (directText) {
    return directText;
  }

  const utterances = Array.isArray(record.utterances)
    ? record.utterances
    : Array.isArray(record.words)
      ? record.words
      : null;

  if (!utterances) {
    return null;
  }

  const lines = utterances
    .map((entry) => {
      const utterance = asRecord(entry);

      if (!utterance) {
        return null;
      }

      const speaker = firstString(
        utterance.speaker,
        utterance.speaker_name,
        utterance.user_name,
        utterance.participant,
      );
      const text = firstString(utterance.text, utterance.transcript, utterance.content);

      if (!text) {
        return null;
      }

      return speaker ? `${speaker}: ${text}` : text;
    })
    .filter((line): line is string => Boolean(line));

  return lines.length ? lines.join("\n") : null;
}

export function normalizeDailyTranscript(rawTranscript: string): string {
  const trimmed = rawTranscript.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const formatted = formatJsonTranscript(parsed);

    if (formatted) {
      return formatted.trim();
    }
  } catch {
    // Daily can return plain text or WebVTT; fall through to text cleanup.
  }

  if (!trimmed.startsWith("WEBVTT")) {
    return trimmed;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line === "WEBVTT") {
        return false;
      }

      if (line.startsWith("NOTE")) {
        return false;
      }

      return !/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(
        line,
      );
    });

  return lines.join("\n").trim();
}

async function fetchTranscriptFromUrl(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Daily transcript download failed (${response.status}).`);
  }

  return response.text();
}

async function fetchDailyTranscript(args: {
  directUrl?: string;
  transcriptId?: string;
}) {
  if (args.directUrl) {
    return {
      rawTranscript: await fetchTranscriptFromUrl(args.directUrl),
      sourceUrl: args.directUrl,
    };
  }

  if (!args.transcriptId) {
    throw new Error("Daily transcript webhook did not include a transcript id.");
  }

  const apiKey = process.env.DAILY_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Daily API key is not configured.");
  }

  const accessLinkResponse = await fetch(
    `https://api.daily.co/v1/transcript/${encodeURIComponent(
      args.transcriptId,
    )}/access-link`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  const accessLinkPayload = (await accessLinkResponse.json().catch(() => null)) as unknown;
  const sourceUrl = extractAccessLink(accessLinkPayload);

  if (!accessLinkResponse.ok || !sourceUrl) {
    throw new Error(`Daily transcript access link failed (${accessLinkResponse.status}).`);
  }

  return {
    rawTranscript: await fetchTranscriptFromUrl(sourceUrl),
    sourceUrl,
  };
}

export async function storeDailyTranscriptWebhook(body: unknown) {
  const event = extractTranscriptEvent(body);

  if (!event?.roomName) {
    return {
      ignored: true,
      reason: "not_a_transcript_event",
    };
  }

  const call = await prisma.videoCall.findUnique({
    where: {
      dailyRoomName: event.roomName,
    },
    select: {
      id: true,
    },
  });

  if (!call) {
    return {
      ignored: true,
      reason: "unknown_room",
      roomName: event.roomName,
    };
  }

  try {
    const { rawTranscript, sourceUrl } = await fetchDailyTranscript({
      directUrl: event.directUrl,
      transcriptId: event.transcriptId,
    });
    const transcriptText = normalizeDailyTranscript(rawTranscript);

    await prisma.videoCall.update({
      where: {
        id: call.id,
      },
      data: {
        dailyTranscriptId: event.transcriptId,
        transcriptFetchedAt: new Date(),
        transcriptSourceUrl: sourceUrl,
        transcriptStatus: transcriptText ? "READY" : "EMPTY",
        transcriptText: transcriptText || null,
      },
    });

    return {
      callId: call.id,
      ignored: false,
      transcriptStatus: transcriptText ? "READY" : "EMPTY",
    };
  } catch (error) {
    await prisma.videoCall.update({
      where: {
        id: call.id,
      },
      data: {
        dailyTranscriptId: event.transcriptId,
        transcriptStatus: "FAILED",
      },
    });

    throw error;
  }
}
