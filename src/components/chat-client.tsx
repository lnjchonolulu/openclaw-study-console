"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/dm";

function createClientId() {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatMessageTime(isoString: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoString));
}

function formatDateDivider(isoString: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(isoString));
}

function getDateKey(isoString: string) {
  return isoString.slice(0, 10);
}

function getMinuteKey(isoString: string) {
  return isoString.slice(0, 16);
}

type RenderRow =
  | {
      type: "date";
      key: string;
      label: string;
    }
  | {
      type: "message";
      key: string;
      message: ChatMessage;
      showTimestamp: boolean;
    };

function buildRenderRows(messages: ChatMessage[]): RenderRow[] {
  const rows: RenderRow[] = [];

  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const dateKey = getDateKey(message.createdAt);
    const previousDateKey = previous ? getDateKey(previous.createdAt) : null;
    const nextMinuteKey = next ? getMinuteKey(next.createdAt) : null;
    const currentMinuteKey = getMinuteKey(message.createdAt);
    const showTimestamp = nextMinuteKey !== currentMinuteKey;

    if (dateKey !== previousDateKey) {
      rows.push({
        type: "date",
        key: `date:${dateKey}`,
        label: formatDateDivider(message.createdAt),
      });
    }

    rows.push({
      type: "message",
      key: message.id,
      message,
      showTimestamp,
    });
  });

  return rows;
}

export function ChatClient({
  agentId,
  initialMessages,
  recipientId,
  recipientKind,
  roomId,
}: {
  agentId: string | null;
  initialMessages: ChatMessage[];
  recipientId: string | null;
  recipientKind: "agent" | "person";
  roomId: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentAtRef = useRef(0);
  const typingTimeoutRef = useRef<number | null>(null);

  const renderRows = useMemo(() => buildRenderRows(messages), [messages]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [message]);

  useLayoutEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [renderRows, isSending, error, isOtherTyping]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    void fetch("/api/dm/read", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roomId }),
    });
  }, [roomId]);

  useEffect(() => {
    if (recipientKind !== "person" || !roomId) {
      return;
    }

    const currentRoomId = roomId;
    let isMounted = true;

    async function refreshMessages() {
      const response = await fetch(
        `/api/dm/messages?roomId=${encodeURIComponent(currentRoomId)}`,
      );

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        isOtherTyping?: boolean;
        messages?: ChatMessage[];
      };

      if (!isMounted) {
        return;
      }

      if (payload.messages) {
        setMessages(payload.messages);
      }

      setIsOtherTyping(Boolean(payload.isOtherTyping));
    }

    void refreshMessages();
    const intervalId = window.setInterval(refreshMessages, 1200);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [recipientKind, roomId]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  async function sendTypingState(isTyping: boolean) {
    if (recipientKind !== "person" || !roomId) {
      return;
    }

    await fetch("/api/dm/typing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roomId,
        isTyping,
      }),
    });
  }

  function handleTypingHeartbeat(nextValue: string) {
    if (recipientKind !== "person" || !roomId) {
      return;
    }

    if (!nextValue.trim()) {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      void sendTypingState(false);
      return;
    }

    const now = Date.now();

    if (now - lastTypingSentAtRef.current > 1200) {
      lastTypingSentAtRef.current = now;
      void sendTypingState(true);
    }

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      void sendTypingState(false);
      typingTimeoutRef.current = null;
    }, 1800);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (isSending) {
      return;
    }

    if (!trimmedMessage) {
      setError("Write a message first.");
      return;
    }

    if (recipientKind === "agent" && !agentId) {
      setError("Choose an agent DM before sending.");
      return;
    }

    if (recipientKind === "person" && !recipientId) {
      setError("Choose a person DM before sending.");
      return;
    }

    const optimisticMessage: ChatMessage = {
      id: createClientId(),
      role: "USER",
      content: trimmedMessage,
      createdAt: new Date().toISOString(),
    };

    setIsSending(true);
    setError(null);
    setMessages((current) => [...current, optimisticMessage]);
    setMessage("");
    setIsOtherTyping(false);

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    void sendTypingState(false);

    try {
      const response = await fetch(recipientKind === "agent" ? "/api/chat" : "/api/dm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId,
          message: trimmedMessage,
          recipientId,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        reply?: string;
        replyMessage?: {
          id: string;
          content: string;
          createdAt: string;
        };
      };

      if (!response.ok) {
        setError(payload.error ?? "The message could not be sent.");
        setIsSending(false);
        return;
      }

      if (payload.replyMessage) {
        setMessages((current) => [
          ...current,
          {
            id: payload.replyMessage!.id,
            role: "AGENT",
            content: payload.replyMessage!.content,
            createdAt: payload.replyMessage!.createdAt,
          },
        ]);
      }

      if (roomId) {
        void fetch("/api/dm/read", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roomId }),
        });
      }

      setIsSending(false);
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "The message could not be sent.",
      );
      setIsSending(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="message-list" aria-live="polite">
        {renderRows.map((row) =>
          row.type === "date" ? (
            <div className="message-date-divider" key={row.key}>
              <span>{row.label}</span>
            </div>
          ) : (
            <div
              className={`message-line ${
                row.message.role === "USER"
                  ? "message-line-user"
                  : "message-line-other"
              }`}
              key={row.key}
            >
              {row.showTimestamp && row.message.role === "USER" ? (
                <span className="message-timestamp message-timestamp-user">
                  {formatMessageTime(row.message.createdAt)}
                </span>
              ) : null}
              <div
                className={`message-row ${
                  row.message.role === "USER" ? "message-row-user" : "message-row-agent"
                }`}
              >
                <p>{row.message.content}</p>
              </div>
              {row.showTimestamp && row.message.role !== "USER" ? (
                <span className="message-timestamp message-timestamp-other">
                  {formatMessageTime(row.message.createdAt)}
                </span>
              ) : null}
            </div>
          ),
        )}
        {isSending && recipientKind === "agent" ? (
          <div className="message-row message-row-agent message-row-pending">
            <p>Writing...</p>
          </div>
        ) : null}
        {!isSending && recipientKind === "person" && isOtherTyping ? (
          <div className="message-row message-row-agent message-row-pending">
            <p>Writing...</p>
          </div>
        ) : null}
        <div ref={messageEndRef} />
      </div>

      <form className="message-composer" onSubmit={handleSubmit}>
        {error ? <p className="helper-text message-error">{error}</p> : null}
        <div className="composer-bar">
          <textarea
            aria-label="Message"
            ref={textareaRef}
            value={message}
            onChange={(event) => {
              const nextValue = event.target.value;
              setMessage(nextValue);
              handleTypingHeartbeat(nextValue);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Write a message"
            rows={1}
          />
          <button className="primary-button" disabled={isSending} type="submit">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
