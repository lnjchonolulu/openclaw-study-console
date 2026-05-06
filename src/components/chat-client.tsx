"use client";

import { useLayoutEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "USER" | "AGENT" | "OTHER";
  content: string;
};

function createClientId() {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ChatClient({
  agentId,
  initialMessages,
  recipientId,
  recipientKind,
}: {
  agentId: string | null;
  initialMessages: ChatMessage[];
  recipientId: string | null;
  recipientKind: "agent" | "person";
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  }, [messages, isSending, error]);

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

    const optimisticMessage = {
      id: createClientId(),
      role: "USER" as const,
      content: trimmedMessage,
    };

    setIsSending(true);
    setError(null);
    setMessages((current) => [...current, optimisticMessage]);
    setMessage("");

    try {
      const response = await fetch(
        recipientKind === "agent" ? "/api/chat" : "/api/dm",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentId,
            message: trimmedMessage,
            recipientId,
          }),
        },
      );

      const payload = (await response.json()) as { error?: string; reply?: string };

      if (!response.ok) {
        setError(payload.error ?? "The message could not be sent.");
        setIsSending(false);
        return;
      }

      const reply = payload.reply;

      if (reply) {
        setMessages((current) => [
          ...current,
          {
            id: createClientId(),
            role: "AGENT",
            content: reply,
          },
        ]);
      }
      setIsSending(false);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "The message could not be sent.",
      );
      setIsSending(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="message-list" aria-live="polite">
        {messages.map((entry) => (
          <div
            className={`message-row ${
              entry.role === "USER" ? "message-row-user" : "message-row-agent"
            }`}
            key={entry.id}
          >
            <p>{entry.content}</p>
          </div>
        ))}
        {isSending ? (
          <div className="message-row message-row-agent message-row-pending">
            <p>{recipientKind === "agent" ? "Writing..." : "Sending..."}</p>
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
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Write a message"
            rows={1}
          />
          <button
            className="primary-button"
            disabled={isSending}
            type="submit"
          >
            {isSending ? "Sending" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
