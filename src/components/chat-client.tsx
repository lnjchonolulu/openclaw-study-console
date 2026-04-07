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
    <>
      <article className="content-card">
        <h2>Conversation</h2>
        <div className="message-list">
          {messages.map((entry) => (
            <div className="message-row" key={entry.id}>
              <div className="message-meta">
                {entry.role === "USER" ? "Participant" : "Personal agent"}
              </div>
              <p>{entry.content}</p>
            </div>
          ))}
        </div>
      </article>

      <form className="message-composer" onSubmit={handleSubmit}>
        <h2>Message composer</h2>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask your personal agent for a plan, summary, or draft."
        />
        {error ? <p className="helper-text">{error}</p> : null}
        <div className="inline-actions">
          <button className="primary-button" disabled={isSending} type="submit">
            {isSending ? "Sending..." : "Send to agent"}
          </button>
        </div>
      </form>
    </>
  );
}
