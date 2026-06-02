"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProfileAvatar } from "@/components/profile-avatar";
import type { TeamChannelDetail } from "@/lib/team";

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

function getSenderKey(message: TeamChannelDetail["messages"][number]) {
  return message.senderKey;
}

function truncateReplyPreview(value: string, maxLength = 120) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1)}…`;
}

function teamAuthorLabel(
  message: TeamMessage,
  memberMap: Map<string, TeamChannelDetail["members"][number]>,
  isOwnMessage: boolean,
) {
  if (isOwnMessage) {
    return "You";
  }

  return memberMap.get(message.userId)?.name ?? message.author;
}

type ReplyTarget = {
  author: string;
  content: string;
  id: string;
};

type TeamMessage = TeamChannelDetail["messages"][number];

type RenderRow =
  | {
      type: "date";
      key: string;
      label: string;
    }
  | {
      type: "message";
      key: string;
      message: TeamChannelDetail["messages"][number];
      showTimestamp: boolean;
      isOwnMessage: boolean;
    };

function buildRenderRows(
  messages: TeamMessage[],
  currentUserId: string,
): RenderRow[] {
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
      showTimestamp:
        nextMinuteKey !== currentMinuteKey || nextSenderKey !== currentSenderKey,
      isOwnMessage: message.userId === currentUserId,
    });
  });

  return rows;
}

function isNearBottom(element: HTMLElement) {
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;

  return distanceFromBottom < 96;
}

function TeamMembersIcon() {
  return (
    <svg
      aria-hidden="true"
      className="team-members-icon"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      >
        <path d="M9.25 11.25a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M15.5 10.75a2.5 2.5 0 1 0 0-5" />
        <path d="M4.75 19.25v-1.1c0-2.4 2-4.35 4.5-4.35s4.5 1.95 4.5 4.35v1.1" />
        <path d="M14.75 14.15c2.25.25 3.75 1.95 3.75 4v1.1" />
      </g>
    </svg>
  );
}

export function TeamChatClient({
  initialChannel,
  selfAvatar,
  user,
}: {
  initialChannel: TeamChannelDetail | null;
  selfAvatar: TeamChannelDetail["members"][number]["avatar"];
  user: {
    displayName: string;
    id: string;
    username: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawSelectedChannelId = searchParams.get("channel");
  const selectedChannelId =
    !rawSelectedChannelId || rawSelectedChannelId === "main"
      ? initialChannel?.id ?? null
      : rawSelectedChannelId;
  const [channel, setChannel] = useState(initialChannel);
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setChannel(initialChannel);
  }, [initialChannel]);

  useEffect(() => {
    setReplyTarget(null);
    shouldStickToBottomRef.current = true;
  }, [selectedChannelId]);

  useEffect(() => {
    if (!selectedChannelId) {
      return;
    }

    const currentChannelId = selectedChannelId;
    let isMounted = true;

    async function refreshChannel() {
      const response = await fetch(
        `/api/team/messages?roomId=${encodeURIComponent(currentChannelId)}`,
      );

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as TeamChannelDetail;

      if (isMounted) {
        const messageList = messageListRef.current;
        shouldStickToBottomRef.current = messageList
          ? isNearBottom(messageList)
          : shouldStickToBottomRef.current;
        setChannel((current) =>
          current?.id === payload.id
            ? {
                ...payload,
                messages: mergeTeamMessages(current.messages, payload.messages),
              }
            : payload,
        );
      }
    }

    void refreshChannel();
    const intervalId = window.setInterval(refreshChannel, 1200);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [selectedChannelId]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [message]);

  const renderRows = useMemo(
    () => buildRenderRows(channel?.messages ?? [], user.id),
    [channel?.messages, user.id],
  );
  const memberMap = useMemo(
    () =>
      new Map(
        (channel?.members ?? [])
          .map((member) => [member.messageKey, member]),
      ),
    [channel?.members],
  );

  useLayoutEffect(() => {
    if (shouldStickToBottomRef.current) {
      messageEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [renderRows]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!channel) {
      return;
    }

    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    const clientMessageId = createClientId();
    const previousReplyTarget = replyTarget;
    const optimisticMessage: TeamMessage = {
      author: user.displayName,
      content: trimmedMessage,
      createdAt: new Date().toISOString(),
      id: clientMessageId,
      replyTo: previousReplyTarget
        ? {
            author: previousReplyTarget.author,
            content: previousReplyTarget.content,
            id: previousReplyTarget.id,
            userId: user.id,
          }
        : null,
      senderKey: user.id,
      userId: user.id,
    };

    setChannel((current) =>
      current
        ? {
            ...current,
            messages: mergeTeamMessages(current.messages, [optimisticMessage]),
          }
        : current,
    );
    shouldStickToBottomRef.current = true;
    setMessage("");
    setReplyTarget(null);

    const response = await fetch("/api/team/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: trimmedMessage,
        replyToMessageId: previousReplyTarget?.id ?? null,
        roomId: channel.id,
      }),
    });

    const payload = (await response.json()) as {
      error?: string;
      agentMessages?: TeamChannelDetail["messages"];
      message?: TeamChannelDetail["messages"][number];
    };

    if (!response.ok || !payload.message) {
      setChannel((current) =>
        current
          ? {
              ...current,
              messages: current.messages.filter(
                (currentMessage) => currentMessage.id !== clientMessageId,
              ),
            }
          : current,
      );
      setMessage(trimmedMessage);
      setReplyTarget(previousReplyTarget);
      return;
    }

    setChannel((current) =>
      current
        ? {
            ...current,
            messages: replacePendingTeamMessage(
              mergeTeamMessages(current.messages, [
                {
                  ...payload.message!,
                  replyTo: payload.message?.replyTo ?? optimisticMessage.replyTo,
                },
                ...(payload.agentMessages ?? []),
              ]),
              clientMessageId,
              payload.message!.id,
            ),
          }
        : current,
    );
    router.refresh();
  }

  return (
    <section className="chat-page">
      <div className="chat-panel team-chat-panel">
        <div className="team-chat-toolbar">
          <button
            className="team-members-button"
            onClick={() => {
              setIsRosterOpen((current) => !current);
            }}
            type="button"
          >
            <TeamMembersIcon />
            <span>{channel?.members.length ?? 0}</span>
          </button>
          {isRosterOpen ? (
            <div className="team-members-popover">
              <span className="context-label">Participants</span>
              <div className="context-list">
                {(channel?.members ?? []).map((member) => (
                  <div className="context-item" key={member.id}>
                    <span className="context-item-identity">
                      <ProfileAvatar avatar={member.avatar} className="context-avatar" />
                      <span className="context-item-copy">
                        <span className="context-item-title">{member.name}</span>
                        <span className="context-item-meta">{member.meta}</span>
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div
          className="message-list"
          aria-live="polite"
          onScroll={(event) => {
            shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
          }}
          ref={messageListRef}
        >
          {renderRows.length === 0 ? (
            <div className="team-empty-state">No messages yet.</div>
          ) : (
            renderRows.map((row) =>
              row.type === "date" ? (
                <div className="message-date-divider" key={row.key}>
                  <span>{row.label}</span>
                </div>
              ) : (
                <div className="team-message-block" key={row.key}>
                  <div
                    className={`message-line ${
                      row.isOwnMessage ? "message-line-user" : "message-line-other"
                    }`}
                  >
                    {!row.isOwnMessage ? (
                      <ProfileAvatar
                        avatar={
                          memberMap.get(row.message.userId)?.avatar ?? {
                            kind: "user",
                            config: { bgColor: "#EFEFEF", fgColor: "#111111" },
                          }
                        }
                        className="message-avatar"
                      />
                    ) : null}
                    {row.isOwnMessage ? (
                      <span className="message-meta-stack message-meta-stack-user">
                        <button
                          className="message-reply-button"
                          onClick={() =>
                            setReplyTarget({
                              author: teamAuthorLabel(
                                row.message,
                                memberMap,
                                row.isOwnMessage,
                              ),
                              content: row.message.content,
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
                    {!row.isOwnMessage ? (
                      <div className="message-content-stack message-content-stack-other">
                        <div className="message-author-label">
                          {teamAuthorLabel(row.message, memberMap, row.isOwnMessage)}
                        </div>
                        <div
                          className={`message-row ${
                            row.isOwnMessage ? "message-row-user" : "message-row-agent"
                          }`}
                        >
                          {row.message.replyTo ? (
                            <div className="message-reply-preview">
                              <span className="message-reply-author">
                                {row.message.replyTo.author}
                              </span>
                              <span className="message-reply-content">
                                {truncateReplyPreview(row.message.replyTo.content)}
                              </span>
                            </div>
                          ) : null}
                          <p>{row.message.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="message-content-stack message-content-stack-user"
                      >
                        <div className="message-author-label">
                          {teamAuthorLabel(row.message, memberMap, row.isOwnMessage)}
                        </div>
                        <div className="message-row message-row-user">
                          {row.message.replyTo ? (
                            <div className="message-reply-preview">
                              <span className="message-reply-author">
                                {row.message.replyTo.author}
                              </span>
                              <span className="message-reply-content">
                                {truncateReplyPreview(row.message.replyTo.content)}
                              </span>
                            </div>
                          ) : null}
                          <p>{row.message.content}</p>
                        </div>
                      </div>
                    )}
                    {!row.isOwnMessage ? (
                      <span className="message-meta-stack message-meta-stack-other">
                        <button
                          className="message-reply-button"
                          onClick={() =>
                            setReplyTarget({
                              author: teamAuthorLabel(
                                row.message,
                                memberMap,
                                row.isOwnMessage,
                              ),
                              content: row.message.content,
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
                    {row.isOwnMessage ? (
                      <ProfileAvatar avatar={selfAvatar} className="message-avatar" />
                    ) : null}
                  </div>
                </div>
              ),
            )
          )}
          <div ref={messageEndRef} />
        </div>

      <form className="message-composer" onSubmit={handleSubmit}>
        {replyTarget ? (
          <div className="composer-reply-banner">
            <div className="composer-reply-copy">
              <span className="composer-reply-label">
                Replying to {replyTarget.author}
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
              aria-label="Team message"
              placeholder="Write a message"
              ref={textareaRef}
              rows={1}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button className="primary-button" type="submit">
              Send
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function mergeTeamMessages(previous: TeamMessage[], incoming: TeamMessage[]) {
  const byId = new Map<string, TeamMessage>();

  [...previous, ...incoming].forEach((message) => {
    byId.set(message.id, message);
  });

  return removeResolvedOptimisticTeamMessages(Array.from(byId.values())).sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function replacePendingTeamMessage(
  messages: TeamMessage[],
  pendingId: string,
  persistedId: string,
) {
  if (messages.some((message) => message.id === persistedId)) {
    return messages.filter((message) => message.id !== pendingId);
  }

  return messages;
}

function isOptimisticTeamMessage(message: TeamMessage) {
  return message.id.startsWith("client-");
}

function isSameTeamUserMessage(left: TeamMessage, right: TeamMessage) {
  if (left.userId !== right.userId || left.senderKey !== right.senderKey) {
    return false;
  }

  if (left.content !== right.content) {
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

function removeResolvedOptimisticTeamMessages(messages: TeamMessage[]) {
  return messages.filter((message) => {
    if (!isOptimisticTeamMessage(message)) {
      return true;
    }

    return !messages.some(
      (candidate) =>
        candidate.id !== message.id &&
        !isOptimisticTeamMessage(candidate) &&
        isSameTeamUserMessage(message, candidate),
    );
  });
}
