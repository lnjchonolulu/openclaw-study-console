"use client";

import { useState } from "react";

const teamMembers = [
  { id: "hyungjun", name: "Hyungjun", status: "Personal agent active" },
  { id: "jiyeon", name: "Jiyeon", status: "Personal agent active" },
  { id: "minseo", name: "Minseo", status: "Invited" },
  { id: "daniel", name: "Daniel", status: "Invited" },
];

const sampleMessages = [
  {
    id: "team-1",
    author: "Jiyeon",
    content: "I asked my agent to turn the brief into a milestone list.",
    timestamp: "9:42 AM",
  },
  {
    id: "team-2",
    author: "Hyungjun",
    content: "Mine extracted open questions and missing dependencies. We can merge them.",
    timestamp: "9:47 AM",
  },
];

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

export function TeamChatClient() {
  const [isRosterOpen, setIsRosterOpen] = useState(false);

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
            <span>{teamMembers.length}</span>
          </button>
          {isRosterOpen ? (
            <div className="team-members-popover">
              <span className="context-label">Participants</span>
              <div className="context-list">
                {teamMembers.map((member) => (
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
          {sampleMessages.map((entry) => (
            <div className="team-message-block" key={entry.id}>
              <div className="team-message-author">{entry.author}</div>
              <div className="message-line message-line-other">
                <div className="message-row message-row-agent">
                  <p>{entry.content}</p>
                </div>
                <span className="message-timestamp message-timestamp-other">
                  {entry.timestamp}
                </span>
              </div>
            </div>
          ))}
        </div>

        <form className="message-composer">
          <div className="composer-bar">
            <textarea
              aria-label="Team message"
              placeholder="Write a message"
              rows={1}
            />
            <button className="primary-button" type="button">
              Send
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
