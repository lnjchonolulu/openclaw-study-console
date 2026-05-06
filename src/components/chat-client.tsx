"use client";

import { useState } from "react";

type ChatMessage = {
  id: string;
  role: "USER" | "AGENT";
  content: string;
};

export function ChatClient({
  initialMessages,
}: {
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (!trimmedMessage || isSending) {
      return;
    }

    const optimisticMessage = {
      id: crypto.randomUUID(),
      role: "USER" as const,
      content: trimmedMessage,
    };

    setIsSending(true);
    setError(null);
    setMessages((current) => [...current, optimisticMessage]);
    setMessage("");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: trimmedMessage,
      }),
    });

    const payload = (await response.json()) as { error?: string; reply?: string };

    if (!response.ok || !payload.reply) {
      setError(payload.error ?? "The agent could not respond.");
      setIsSending(false);
      return;
    }

    const reply = payload.reply;

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "AGENT",
        content: reply,
      },
    ]);
    setIsSending(false);
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
            <p>답변을 작성하는 중...</p>
          </div>
        ) : null}
      </div>

      <form className="message-composer" onSubmit={handleSubmit}>
        {error ? <p className="helper-text message-error">{error}</p> : null}
        <div className="composer-bar">
          <textarea
            aria-label="Message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="메시지를 입력하세요"
            rows={1}
          />
          <button className="primary-button" disabled={isSending} type="submit">
            {isSending ? "전송 중" : "전송"}
          </button>
        </div>
      </form>
    </div>
  );
}
