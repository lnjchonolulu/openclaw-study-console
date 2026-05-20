"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import type { ChatMessage } from "@/lib/dm";
import type { AvatarViewModel } from "@/lib/profile";

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

function getSenderKey(message: ChatMessage) {
  return message.role === "USER" ? "USER" : "OTHER";
}

function truncateReplyPreview(value: string, maxLength = 120) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1)}…`;
}

type ReplyTarget = {
  authorName: string | null;
  content: string;
  id: string;
};

type PendingUserMessage = {
  clientMessageId: string;
  content: string;
  createdAt: string;
  replyTo: ChatMessage["replyTo"];
};

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
    const nextSenderKey = next ? getSenderKey(next) : null;
    const currentSenderKey = getSenderKey(message);
    const showTimestamp =
      nextMinuteKey !== currentMinuteKey || nextSenderKey !== currentSenderKey;

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
  counterpart,
  initialHasOlderMessages,
  initialMessages,
  recipientId,
  recipientKind,
  roomId,
  selfAvatar,
}: {
  agentId: string | null;
  counterpart: {
    avatar: AvatarViewModel;
    displayName: string;
    meta: string;
  } | null;
  initialHasOlderMessages: boolean;
  initialMessages: ChatMessage[];
  recipientId: string | null;
  recipientKind: "agent" | "person";
  roomId: string | null;
  selfAvatar: AvatarViewModel;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [hasOlderMessages, setHasOlderMessages] = useState(initialHasOlderMessages);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<{
    previousScrollHeight: number;
    previousScrollTop: number;
  } | null>(null);
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
    const messageList = messageListRef.current;
    const pendingRestore = pendingScrollRestoreRef.current;

    if (messageList && pendingRestore) {
      const nextScrollHeight = messageList.scrollHeight;
      messageList.scrollTop =
        nextScrollHeight -
        pendingRestore.previousScrollHeight +
        pendingRestore.previousScrollTop;
      pendingScrollRestoreRef.current = null;
      return;
    }

    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [renderRows, isSending, error, isOtherTyping]);

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
    if (!roomId) {
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
        hasOlderMessages?: boolean;
        isOtherTyping?: boolean;
        messages?: ChatMessage[];
      };

      if (!isMounted) {
        return;
      }

      if (payload.messages) {
        setMessages((current) => mergeMessages(current, payload.messages ?? []));
      }

      if (typeof payload.hasOlderMessages === "boolean") {
        setHasOlderMessages(payload.hasOlderMessages);
      }

      setIsOtherTyping(recipientKind === "person" ? Boolean(payload.isOtherTyping) : false);
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

    const clientMessageId = createClientId();
    const previousMessageDraft = message;
    const previousReplyTarget = replyTarget;

    const optimisticMessage: ChatMessage = {
      id: clientMessageId,
      role: "USER",
      content: trimmedMessage,
      createdAt: new Date().toISOString(),
      replyTo: previousReplyTarget
        ? {
            authorName: previousReplyTarget.authorName,
            content: previousReplyTarget.content,
            id: previousReplyTarget.id,
            role: "OTHER",
          }
        : null,
    };

    setIsSending(true);
    setError(null);
    setMessages((current) => [...current, optimisticMessage]);
    setMessage("");
    setReplyTarget(null);
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
          clientMessageId,
          message: trimmedMessage,
          recipientId,
          replyToMessageId: previousReplyTarget?.id ?? null,
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
        userMessage?: {
          clientMessageId?: string | null;
          createdAt: string;
          id: string;
        };
      };

      if (!response.ok) {
        setMessages((current) =>
          current.filter((currentMessage) => currentMessage.id !== clientMessageId),
        );
        setMessage(previousMessageDraft);
        setReplyTarget(previousReplyTarget);
        setError(payload.error ?? "The message could not be sent.");
        setIsSending(false);
        return;
      }

      if (payload.userMessage) {
        setMessages((current) =>
          replacePendingUserMessage(current, {
            clientMessageId,
            content: trimmedMessage,
            createdAt: payload.userMessage!.createdAt,
            replyTo: optimisticMessage.replyTo,
          }, payload.userMessage!.id),
        );
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
      setMessages((current) =>
        current.filter((currentMessage) => currentMessage.id !== clientMessageId),
      );
      setMessage(previousMessageDraft);
      setReplyTarget(previousReplyTarget);
      setError(
        sendError instanceof Error ? sendError.message : "The message could not be sent.",
      );
      setIsSending(false);
    }
  }

  async function loadOlderMessages() {
    if (!roomId || isLoadingOlder || !hasOlderMessages || messages.length === 0) {
      return;
    }

    const oldestMessage = messages[0];
    const messageList = messageListRef.current;

    if (messageList) {
      pendingScrollRestoreRef.current = {
        previousScrollHeight: messageList.scrollHeight,
        previousScrollTop: messageList.scrollTop,
      };
    }

    setIsLoadingOlder(true);

    try {
      const response = await fetch(
        `/api/dm/messages?roomId=${encodeURIComponent(roomId)}&before=${encodeURIComponent(
          oldestMessage.createdAt,
        )}`,
      );

      if (!response.ok) {
        setIsLoadingOlder(false);
        return;
      }

      const payload = (await response.json()) as {
        hasOlderMessages?: boolean;
        messages?: ChatMessage[];
      };

      const olderMessages = payload.messages ?? [];

      if (olderMessages.length > 0) {
        setMessages((current) => mergeMessages(olderMessages, current));
      }

      setHasOlderMessages(Boolean(payload.hasOlderMessages));
      setIsLoadingOlder(false);
    } catch {
      pendingScrollRestoreRef.current = null;
      setIsLoadingOlder(false);
    }
  }

  return (
    <div className="chat-panel">
      <div
        className="message-list"
        aria-live="polite"
        onScroll={(event) => {
          if (event.currentTarget.scrollTop < 48) {
            void loadOlderMessages();
          }
        }}
        ref={messageListRef}
      >
        {isLoadingOlder ? (
          <div className="message-load-state">Loading older messages...</div>
        ) : null}
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
              {row.message.role !== "USER" && counterpart ? (
                <ProfileAvatar avatar={counterpart.avatar} className="message-avatar" />
              ) : null}
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
                {row.message.replyTo ? (
                  <div className="message-reply-preview">
                    <span className="message-reply-author">
                      {row.message.replyTo.authorName ??
                        (row.message.replyTo.role === "USER" ? "You" : "Earlier message")}
                    </span>
                    <span className="message-reply-content">
                      {truncateReplyPreview(row.message.replyTo.content)}
                    </span>
                  </div>
                ) : null}
                <p>{row.message.content}</p>
              </div>
              <button
                className="message-reply-button"
                onClick={() =>
                  setReplyTarget({
                    authorName:
                      row.message.authorName ??
                      (row.message.role === "USER"
                        ? "You"
                        : counterpart?.displayName ?? "Message"),
                    content: row.message.content,
                    id: row.message.id,
                  })
                }
                type="button"
              >
                Reply
              </button>
              {row.message.role === "USER" ? (
                <ProfileAvatar avatar={selfAvatar} className="message-avatar" />
              ) : null}
              {row.showTimestamp && row.message.role !== "USER" ? (
                <span className="message-timestamp message-timestamp-other">
                  {formatMessageTime(row.message.createdAt)}
                </span>
              ) : null}
            </div>
          ),
        )}
        {isSending && recipientKind === "agent" ? (
          <div className="message-line message-line-other">
            {counterpart ? (
              <ProfileAvatar avatar={counterpart.avatar} className="message-avatar" />
            ) : null}
            <div className="message-row message-row-agent message-row-pending">
              <p>Writing...</p>
            </div>
          </div>
        ) : null}
        {!isSending && recipientKind === "person" && isOtherTyping ? (
          <div className="message-line message-line-other">
            {counterpart ? (
              <ProfileAvatar avatar={counterpart.avatar} className="message-avatar" />
            ) : null}
            <div className="message-row message-row-agent message-row-pending">
              <p>Writing...</p>
            </div>
          </div>
        ) : null}
        <div ref={messageEndRef} />
      </div>

      <form className="message-composer" onSubmit={handleSubmit}>
        {error ? <p className="helper-text message-error">{error}</p> : null}
        {replyTarget ? (
          <div className="composer-reply-banner">
            <div className="composer-reply-copy">
              <span className="composer-reply-label">
                Replying to {replyTarget.authorName ?? "message"}
              </span>
              <span className="composer-reply-snippet">
                {truncateReplyPreview(replyTarget.content, 160)}
              </span>
            </div>
            <button
              className="composer-reply-clear"
              onClick={() => setReplyTarget(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        ) : null}
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

function mergeMessages(
  previous: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();

  [...previous, ...incoming].forEach((message) => {
    byId.set(message.id, message);
  });

  const merged = Array.from(byId.values()).sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  if (
    merged.length === previous.length &&
    merged.every(
      (message, index) =>
        previous[index] &&
        previous[index].id === message.id &&
        previous[index].content === message.content &&
        previous[index].createdAt === message.createdAt &&
        previous[index].role === message.role &&
        previous[index].replyTo?.id === message.replyTo?.id &&
        previous[index].replyTo?.content === message.replyTo?.content,
    )
  ) {
    return previous;
  }

  return merged;
}

function replacePendingUserMessage(
  current: ChatMessage[],
  pending: PendingUserMessage,
  persistedId: string,
) {
  return current.map((message) => {
    if (message.id !== pending.clientMessageId) {
      return message;
    }

    return {
      ...message,
      content: pending.content,
      createdAt: pending.createdAt,
      id: persistedId,
      replyTo: pending.replyTo,
    };
  });
}
