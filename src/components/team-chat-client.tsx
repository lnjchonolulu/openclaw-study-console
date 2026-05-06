"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  createTeamMessageId,
  DEFAULT_TEAM_MEMBERS,
  loadTeamChannels,
  saveTeamChannels,
  TEAM_CHAT_EVENT,
  type TeamChannelMessage,
} from "@/lib/team-chat";

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
      message: TeamChannelMessage;
      showTimestamp: boolean;
      isOwnMessage: boolean;
    };

function buildRenderRows(messages: TeamChannelMessage[], currentUserId: string): RenderRow[] {
  const rows: RenderRow[] = [];

  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];
    const dateKey = getDateKey(message.createdAt);
    const previousDateKey = previous ? getDateKey(previous.createdAt) : null;
    const nextMinuteKey = next ? getMinuteKey(next.createdAt) : null;
    const currentMinuteKey = getMinuteKey(message.createdAt);

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
      showTimestamp: nextMinuteKey !== currentMinuteKey,
      isOwnMessage: message.userId === currentUserId,
    });
  });

  return rows;
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
  user,
}: {
  user: {
    displayName: string;
    username: string;
  };
}) {
  const searchParams = useSearchParams();
  const selectedChannelId = searchParams.get("channel") ?? "main";
  const [channels, setChannels] = useState(loadTeamChannels);
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [message, setMessage] = useState("");
  const messageEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function syncChannels() {
      setChannels(loadTeamChannels());
    }

    window.addEventListener(TEAM_CHAT_EVENT, syncChannels);
    window.addEventListener("storage", syncChannels);

    return () => {
      window.removeEventListener(TEAM_CHAT_EVENT, syncChannels);
      window.removeEventListener("storage", syncChannels);
    };
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [message]);

  const activeChannel =
    channels.find((channel) => channel.id === selectedChannelId) ?? channels[0] ?? null;
  const renderRows = useMemo(
    () =>
      activeChannel
        ? buildRenderRows(activeChannel.messages, user.username)
        : [],
    [activeChannel, user.username],
  );

  useLayoutEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [renderRows]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeChannel) {
      return;
    }

    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    const nextChannels = channels.map((channel) =>
      channel.id === activeChannel.id
        ? {
            ...channel,
            messages: [
              ...channel.messages,
              {
                id: createTeamMessageId(),
                author: user.displayName,
                content: trimmedMessage,
                createdAt: new Date().toISOString(),
                userId: user.username,
              },
            ],
          }
        : channel,
    );

    setChannels(nextChannels);
    saveTeamChannels(nextChannels);
    setMessage("");
  }

  const members = activeChannel?.members ?? DEFAULT_TEAM_MEMBERS;

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
            <span>{members.length}</span>
          </button>
          {isRosterOpen ? (
            <div className="team-members-popover">
              <span className="context-label">Participants</span>
              <div className="context-list">
                {members.map((member) => (
                  <div className="context-item" key={member.id}>
                    <span className="context-item-title">{member.name}</span>
                    <span className="context-item-meta">{member.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="message-list" aria-live="polite">
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
                  {!row.isOwnMessage ? (
                    <div className="team-message-author">{row.message.author}</div>
                  ) : null}
                  <div
                    className={`message-line ${
                      row.isOwnMessage ? "message-line-user" : "message-line-other"
                    }`}
                  >
                    {row.showTimestamp && row.isOwnMessage ? (
                      <span className="message-timestamp message-timestamp-user">
                        {formatMessageTime(row.message.createdAt)}
                      </span>
                    ) : null}
                    <div
                      className={`message-row ${
                        row.isOwnMessage ? "message-row-user" : "message-row-agent"
                      }`}
                    >
                      <p>{row.message.content}</p>
                    </div>
                    {row.showTimestamp && !row.isOwnMessage ? (
                      <span className="message-timestamp message-timestamp-other">
                        {formatMessageTime(row.message.createdAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ),
            )
          )}
          <div ref={messageEndRef} />
        </div>

        <form className="message-composer" onSubmit={handleSubmit}>
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
