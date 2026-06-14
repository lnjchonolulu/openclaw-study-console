"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProfileAvatar } from "@/components/profile-avatar";
import type {
  VideoCallInviteCandidate,
  VideoCallSummary,
  VideoCallUser,
} from "@/lib/video-calls";

type ActiveVideoCallPayload = {
  dailyRoomUrl: string;
  id: string;
  name: string;
};

function VideoCallIcon() {
  return (
    <svg
      aria-hidden="true"
      className="video-call-hero-icon"
      fill="none"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect height="30" rx="8" stroke="currentColor" strokeWidth="3.5" width="38" x="9" y="17" />
      <path
        d="M47 27.5 56 22v20l-9-5.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.5"
      />
    </svg>
  );
}

function formatCallDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function participantLabel(participant: VideoCallUser) {
  return `${participant.displayName} (@${participant.username})`;
}

function compactParticipants(participants: VideoCallUser[]) {
  if (participants.length === 0) {
    return "No participants";
  }

  if (participants.length <= 3) {
    return participants.map((participant) => participant.displayName).join(", ");
  }

  return `${participants
    .slice(0, 3)
    .map((participant) => participant.displayName)
    .join(", ")} +${participants.length - 3}`;
}

export function VideoCallClient({
  currentUserId,
  initialActiveCalls,
  initialHistory,
  inviteCandidates,
  ownAgentId,
}: {
  currentUserId: string;
  initialActiveCalls: VideoCallSummary[];
  initialHistory: VideoCallSummary[];
  inviteCandidates: VideoCallInviteCandidate[];
  ownAgentId: string | null;
}) {
  const router = useRouter();
  const [activeCalls, setActiveCalls] = useState(initialActiveCalls);
  const [history, setHistory] = useState(initialHistory);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const visibleActiveCalls = activeCalls.filter((call) => call.status === "ACTIVE");

  function resetModal() {
    setName("");
    setSelectedUserIds([]);
    setNotice(null);
    setIsModalOpen(false);
  }

  function activateCall(call: VideoCallSummary) {
    const payload: ActiveVideoCallPayload = {
      dailyRoomUrl: call.dailyRoomUrl,
      id: call.id,
      name: call.name,
    };

    window.localStorage.setItem("cyworld-active-video-call", JSON.stringify(payload));
    window.dispatchEvent(
      new CustomEvent("cyworld-video-call-active", {
        detail: payload,
      }),
    );
  }

  async function refreshState() {
    const response = await fetch("/api/video-calls");

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      activeCalls?: VideoCallSummary[];
      history?: VideoCallSummary[];
    };

    setActiveCalls(payload.activeCalls ?? []);
    setHistory(payload.history ?? []);
  }

  async function createCall() {
    const trimmedName = name.trim();

    if (!trimmedName) {
      setNotice("Call name is required.");
      return;
    }

    setIsSaving(true);
    setNotice(null);

    const response = await fetch("/api/video-calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        invitedUserIds: selectedUserIds,
        name: trimmedName,
      }),
    });
    const payload = (await response.json()) as {
      call?: VideoCallSummary;
      error?: string;
    };

    setIsSaving(false);

    if (!response.ok || !payload.call) {
      setNotice(payload.error ?? "Call could not be started.");
      return;
    }

    resetModal();
    setActiveCalls((current) => [payload.call!, ...current]);
    activateCall(payload.call);
  }

  async function joinCall(call: VideoCallSummary) {
    setNotice(null);
    const response = await fetch(`/api/video-calls/${encodeURIComponent(call.id)}/join`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setNotice(payload?.error ?? "Call could not be joined.");
      return;
    }

    activateCall(call);
    await refreshState();
  }

  async function deleteHistory(call: VideoCallSummary) {
    const response = await fetch(`/api/video-calls/${encodeURIComponent(call.id)}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setNotice("History item could not be deleted.");
      return;
    }

    setHistory((current) => current.filter((item) => item.id !== call.id));
  }

  async function shareTranscript(call: VideoCallSummary) {
    const response = await fetch(
      `/api/video-calls/${encodeURIComponent(call.id)}/transcript`,
    );

    if (!response.ok) {
      setNotice("Transcript could not be loaded.");
      return;
    }

    const text = await response.text();
    const filename =
      response.headers
        .get("content-disposition")
        ?.match(/filename="([^"]+)"/)?.[1] ?? `${call.name}-transcript.txt`;

    window.localStorage.setItem(
      "cyworld-pending-chat-draft",
      JSON.stringify({
        filename,
        text,
        type: "video-call-transcript",
      }),
    );

    router.push(ownAgentId ? `/chat?agent=${encodeURIComponent(ownAgentId)}` : "/chat");
  }

  return (
    <div className="video-call-panel">
      <div className="video-call-main">
        <VideoCallIcon />
        {visibleActiveCalls.length === 0 ? (
          <div className="video-call-empty">
            <p>No active invited calls.</p>
            <button
              className="primary-button"
              onClick={() => {
                setIsModalOpen(true);
              }}
              type="button"
            >
              Start Call
            </button>
          </div>
        ) : (
          <div className="video-call-active-list">
            {visibleActiveCalls.map((call) => {
              const isJoined = call.joined.some((participant) => participant.id === currentUserId);

              return (
                <article className="video-call-card" key={call.id}>
                  <div className="video-call-card-copy">
                    <span className="context-label">Live Call</span>
                    <h2>{call.name}</h2>
                    <p>{formatCallDate(call.startedAt)}</p>
                  </div>
                  <div className="video-call-participant-groups">
                    <div>
                      <span className="video-call-group-label">In call</span>
                      <div className="video-call-avatar-row">
                        {call.joined.length > 0 ? (
                          call.joined.map((participant) => (
                            <span title={participantLabel(participant)} key={participant.id}>
                              <ProfileAvatar avatar={participant.avatar} className="context-avatar" />
                            </span>
                          ))
                        ) : (
                          <span className="helper-text">No one yet</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="video-call-group-label">Invited</span>
                      <div className="video-call-avatar-row">
                        {call.invited.length > 0 ? (
                          call.invited.map((participant) => (
                            <span title={participantLabel(participant)} key={participant.id}>
                              <ProfileAvatar avatar={participant.avatar} className="context-avatar" />
                            </span>
                          ))
                        ) : (
                          <span className="helper-text">Everyone has joined</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => {
                      void joinCall(call);
                    }}
                    type="button"
                  >
                    {isJoined ? "Open Call" : "Join Call"}
                  </button>
                </article>
              );
            })}
            <button
              className="secondary-button video-call-start-secondary"
              onClick={() => {
                setIsModalOpen(true);
              }}
              type="button"
            >
              Start Call
            </button>
          </div>
        )}
        {notice ? <p className="video-call-notice">{notice}</p> : null}
      </div>

      <section className="video-call-history">
        <div className="video-call-history-header">
          <h2>History</h2>
          <p>Previous calls you participated in.</p>
        </div>
        <div className="video-call-history-list">
          {history.length > 0 ? (
            history.map((call) => (
              <article className="video-call-history-item" key={call.id}>
                <div>
                  <span className="context-label">{formatCallDate(call.startedAt)}</span>
                  <h3>{call.name}</h3>
                  <p>{compactParticipants([...call.joined, ...call.invited])}</p>
                </div>
                <div className="video-call-history-actions">
                  <a
                    className="secondary-button"
                    href={`/api/video-calls/${encodeURIComponent(call.id)}/transcript`}
                  >
                    Download
                  </a>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void shareTranscript(call);
                    }}
                    type="button"
                  >
                    Share to Agent
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void deleteHistory(call);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="video-call-history-empty">No call history yet.</p>
          )}
        </div>
      </section>

      {isModalOpen ? (
        <div
          className="team-modal-backdrop"
          onClick={() => {
            resetModal();
          }}
        >
          <div
            className="team-modal video-call-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="team-modal-header">
              <h2>Start call</h2>
              <p className="helper-text">
                Name the call and choose the human participants to invite.
              </p>
            </div>
            <label className="split-label">
              Call Name
              <span className="team-modal-input-wrap">
                <input
                  className="team-modal-input"
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  placeholder="e.g. weekly sync, design review"
                  type="text"
                  value={name}
                />
              </span>
            </label>
            <div className="team-modal-section">
              <span className="context-label">Participants</span>
              <div className="team-invite-list video-call-invite-list">
                {inviteCandidates.map((candidate) => {
                  const checked =
                    candidate.id === currentUserId || selectedUserIds.includes(candidate.id);
                  const disabled = candidate.id === currentUserId;

                  return (
                    <label
                      className={`team-invite-card${
                        checked ? " team-invite-card-selected" : ""
                      }${disabled ? " team-invite-card-disabled" : ""}`}
                      key={candidate.id}
                    >
                      <input
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => {
                          setSelectedUserIds((current) =>
                            event.target.checked
                              ? [...current, candidate.id]
                              : current.filter((item) => item !== candidate.id),
                          );
                        }}
                        type="checkbox"
                      />
                      <span className="team-invite-check" aria-hidden="true">
                        {checked ? "✓" : ""}
                      </span>
                      <ProfileAvatar avatar={candidate.avatar} className="context-avatar" />
                      <span className="team-invite-copy">
                        <span>{candidate.isCurrentUser ? "You" : candidate.displayName}</span>
                        <span className="context-item-meta">@{candidate.username}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            {notice ? <p className="context-notice">{notice}</p> : null}
            <div className="team-modal-actions">
              <button
                className="secondary-button"
                disabled={isSaving}
                onClick={() => {
                  resetModal();
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={isSaving}
                onClick={() => {
                  void createCall();
                }}
                type="button"
              >
                {isSaving ? "Starting..." : "Start Call"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
