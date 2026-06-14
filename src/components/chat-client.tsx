"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import type { ChatMessage } from "@/lib/dm";
import type { AvatarViewModel } from "@/lib/profile";

const MAX_PENDING_IMAGES = 8;

type PendingImageAttachment = {
  file: File;
  filename: string;
  id: string;
  kind: "image";
  mimeType: string;
  previewUrl: string;
  size: number;
  url: string;
};

function createClientId() {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return `client-${globalThis.crypto.randomUUID()}`;
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

function attachmentPreviewText(attachments: ChatMessage["attachments"]) {
  if (attachments.length === 0) {
    return "";
  }

  return attachments.length === 1 ? "[Image]" : `[${attachments.length} images]`;
}

function messagePreviewContent(message: Pick<ChatMessage, "attachments" | "content">) {
  return message.content || attachmentPreviewText(message.attachments);
}

function MessageAttachments({
  attachments,
}: {
  attachments: ChatMessage["attachments"];
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="message-attachments">
      {attachments.map((attachment) => (
        <a
          className="message-attachment"
          href={attachment.url}
          key={attachment.id}
          rel="noreferrer"
          target="_blank"
        >
          <img alt={attachment.filename} src={attachment.url} />
        </a>
      ))}
    </div>
  );
}

function authorLabelForMessage(
  message: ChatMessage,
  counterpart: { displayName: string } | null,
) {
  if (message.role === "USER") {
    return "You";
  }

  return message.authorName ?? counterpart?.displayName ?? "Message";
}

type ReplyTarget = {
  authorName: string | null;
  content: string;
  id: string;
};

type PendingUserMessage = {
  attachments: ChatMessage["attachments"];
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
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const pendingImageUrlsRef = useRef<Set<string>>(new Set());
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
    const pendingImageUrls = pendingImageUrlsRef.current;

    return () => {
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }

      pendingImageUrls.forEach((previewUrl) => {
        URL.revokeObjectURL(previewUrl);
      });
    };
  }, []);

  function addPendingImageFiles(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      setError("Drop PNG, JPG, GIF, or WebP images.");
      return;
    }

    setPendingImages((current) => {
      const remainingSlots = Math.max(0, MAX_PENDING_IMAGES - current.length);
      const nextFiles = imageFiles.slice(0, remainingSlots);

      if (nextFiles.length < imageFiles.length) {
        setError(`Attach up to ${MAX_PENDING_IMAGES} images at a time.`);
      } else {
        setError(null);
      }

      return [
        ...current,
        ...nextFiles.map((file) => {
          const previewUrl = URL.createObjectURL(file);
          pendingImageUrlsRef.current.add(previewUrl);

          return {
            file,
            filename: file.name || "image",
            id: createClientId(),
            kind: "image" as const,
            mimeType: file.type,
            previewUrl,
            size: file.size,
            url: previewUrl,
          };
        }),
      ];
    });
  }

  function removePendingImage(id: string) {
    setPendingImages((current) => {
      const target = current.find((attachment) => attachment.id === id);

      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        pendingImageUrlsRef.current.delete(target.previewUrl);
      }

      return current.filter((attachment) => attachment.id !== id);
    });
  }

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

    if (!trimmedMessage && pendingImages.length === 0) {
      setError("Write a message or attach an image.");
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
    const previousPendingImages = pendingImages;
    const optimisticAttachments = previousPendingImages.map((attachment) => ({
      filename: attachment.filename,
      id: attachment.id,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: attachment.url,
    }));

    const optimisticMessage: ChatMessage = {
      id: clientMessageId,
      role: "USER",
      content: trimmedMessage,
      createdAt: new Date().toISOString(),
      attachments: optimisticAttachments,
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
    setPendingImages([]);
    setReplyTarget(null);
    setIsOtherTyping(false);

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    void sendTypingState(false);

    try {
      const formData = new FormData();
      formData.set("clientMessageId", clientMessageId);
      formData.set("message", trimmedMessage);

      if (agentId) {
        formData.set("agentId", agentId);
      }

      if (recipientId) {
        formData.set("recipientId", recipientId);
      }

      if (previousReplyTarget?.id) {
        formData.set("replyToMessageId", previousReplyTarget.id);
      }

      previousPendingImages.forEach((attachment) => {
        formData.append("images", attachment.file, attachment.filename);
      });

      const response = await fetch(recipientKind === "agent" ? "/api/chat" : "/api/dm", {
        method: "POST",
        body: formData,
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
          attachments?: ChatMessage["attachments"];
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
        setPendingImages(previousPendingImages);
        setReplyTarget(previousReplyTarget);
        setError(payload.error ?? "The message could not be sent.");
        setIsSending(false);
        return;
      }

      if (payload.userMessage) {
        setMessages((current) =>
          replacePendingUserMessage(current, {
            clientMessageId,
            attachments: payload.userMessage!.attachments ?? optimisticAttachments,
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
            attachments: [],
            content: payload.replyMessage!.content,
            createdAt: payload.replyMessage!.createdAt,
            replyTo: null,
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

      previousPendingImages.forEach((attachment) => {
        URL.revokeObjectURL(attachment.previewUrl);
        pendingImageUrlsRef.current.delete(attachment.previewUrl);
      });
      setIsSending(false);
    } catch (sendError) {
      setMessages((current) =>
        current.filter((currentMessage) => currentMessage.id !== clientMessageId),
      );
      setMessage(previousMessageDraft);
      setPendingImages(previousPendingImages);
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
              {row.message.role === "USER" ? (
                <span className="message-meta-stack message-meta-stack-user">
                  <button
                    className="message-reply-button"
                    onClick={() =>
                      setReplyTarget({
                        authorName: authorLabelForMessage(row.message, counterpart),
                        content: messagePreviewContent(row.message),
                        id: row.message.id,
                      })
                    }
                    type="button"
                  >
                    Reply
                  </button>
                  {row.showTimestamp ? (
                    <span className="message-timestamp message-timestamp-user">
                      {formatMessageTime(row.message.createdAt)}
                    </span>
                  ) : null}
                </span>
              ) : null}
              <div
                className={`message-content-stack ${
                  row.message.role === "USER"
                    ? "message-content-stack-user"
                    : "message-content-stack-other"
                }`}
              >
                <div className="message-author-label">
                  {authorLabelForMessage(row.message, counterpart)}
                </div>
                <div
                  className={`message-row ${
                    row.message.role === "USER"
                      ? "message-row-user"
                      : "message-row-agent"
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
                  {row.message.content ? <p>{row.message.content}</p> : null}
                  <MessageAttachments attachments={row.message.attachments} />
                </div>
              </div>
              {row.message.role !== "USER" ? (
                <span className="message-meta-stack message-meta-stack-other">
                  <button
                    className="message-reply-button"
                    onClick={() =>
                      setReplyTarget({
                        authorName: authorLabelForMessage(row.message, counterpart),
                        content: messagePreviewContent(row.message),
                        id: row.message.id,
                      })
                    }
                    type="button"
                  >
                    Reply
                  </button>
                  {row.showTimestamp ? (
                    <span className="message-timestamp message-timestamp-other">
                      {formatMessageTime(row.message.createdAt)}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {row.message.role === "USER" ? (
                <ProfileAvatar avatar={selfAvatar} className="message-avatar" />
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

      <form
        className={`message-composer ${isDraggingImages ? "message-composer-dragging" : ""}`}
        onDragEnter={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
            event.preventDefault();
            setIsDraggingImages(true);
          }
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
            event.preventDefault();
            setIsDraggingImages(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDraggingImages(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDraggingImages(false);
          addPendingImageFiles(Array.from(event.dataTransfer.files));
        }}
        onSubmit={handleSubmit}
      >
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
        {pendingImages.length > 0 ? (
          <div className="composer-attachments">
            {pendingImages.map((attachment) => (
              <div className="composer-attachment-preview" key={attachment.id}>
                <img alt={attachment.filename} src={attachment.previewUrl} />
                <button
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() => removePendingImage(attachment.id)}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="composer-bar">
          <input
            accept="image/gif,image/jpeg,image/png,image/webp"
            hidden
            multiple
            onChange={(event) => {
              addPendingImageFiles(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="composer-attach-button"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            +
          </button>
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

  const merged = removeResolvedOptimisticMessages(Array.from(byId.values())).sort(
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
        JSON.stringify(previous[index].attachments) === JSON.stringify(message.attachments) &&
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
  const persistedAlreadyExists = current.some((message) => message.id === persistedId);

  if (persistedAlreadyExists) {
    return current.filter((message) => message.id !== pending.clientMessageId);
  }

  return removeResolvedOptimisticMessages(
    current.map((message) => {
      if (message.id !== pending.clientMessageId) {
        return message;
      }

      return {
        ...message,
        attachments: pending.attachments,
        content: pending.content,
        createdAt: pending.createdAt,
        id: persistedId,
        replyTo: pending.replyTo,
      };
    }),
  );
}

function isOptimisticUserMessage(message: ChatMessage) {
  return message.role === "USER" && message.id.startsWith("client-");
}

function isSameUserMessage(left: ChatMessage, right: ChatMessage) {
  if (left.role !== "USER" || right.role !== "USER") {
    return false;
  }

  if (left.content !== right.content) {
    return false;
  }

  if (JSON.stringify(left.attachments) !== JSON.stringify(right.attachments)) {
    return false;
  }

  if ((left.replyTo?.id ?? null) !== (right.replyTo?.id ?? null)) {
    return false;
  }

  return (
    Math.abs(
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    ) < 1000 * 60 * 2
  );
}

function removeResolvedOptimisticMessages(messages: ChatMessage[]) {
  return messages.filter((message) => {
    if (!isOptimisticUserMessage(message)) {
      return true;
    }

    return !messages.some(
      (candidate) =>
        candidate.id !== message.id &&
        !isOptimisticUserMessage(candidate) &&
        isSameUserMessage(message, candidate),
    );
  });
}
