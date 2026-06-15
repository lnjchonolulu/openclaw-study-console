"use client";

import { useEffect, useState } from "react";
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

type ModalMode = "START" | "SCHEDULE";

const selectableTimes = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";

  return `${String(hour).padStart(2, "0")}:${minute}`;
});

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

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function formatTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0",
  )}`;
}

function getDefaultScheduleWindow() {
  const start = new Date();
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);

  return {
    endDate: formatDateInput(end),
    endTime: formatTimeInput(end),
    startDate: formatDateInput(start),
    startTime: formatTimeInput(start),
  };
}

function toIso(dateValue: string, timeValue: string) {
  const date = new Date(`${dateValue}T${timeValue}:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
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

function uniqueParticipants(call: VideoCallSummary) {
  const participants = [...call.joined, ...call.invited];
  const seen = new Set<string>();

  return participants.filter((participant) => {
    if (seen.has(participant.id)) {
      return false;
    }

    seen.add(participant.id);
    return true;
  });
}

function ParticipantRow({
  label,
  participants,
}: {
  label: string;
  participants: VideoCallUser[];
}) {
  return (
    <div className="video-call-participant-row">
      <span className="video-call-group-label">{label}</span>
      <div className="video-call-avatar-row">
        {participants.length > 0 ? (
          participants.map((participant) => (
            <span title={participantLabel(participant)} key={participant.id}>
              <ProfileAvatar avatar={participant.avatar} className="context-avatar" />
            </span>
          ))
        ) : (
          <span className="helper-text">None</span>
        )}
      </div>
    </div>
  );
}

export function VideoCallClient({
  currentUserId,
  initialActiveCalls,
  initialHistory,
  initialScheduledCalls,
  inviteCandidates,
  ownAgentId,
}: {
  currentUserId: string;
  initialActiveCalls: VideoCallSummary[];
  initialHistory: VideoCallSummary[];
  initialScheduledCalls: VideoCallSummary[];
  inviteCandidates: VideoCallInviteCandidate[];
  ownAgentId: string | null;
}) {
  const router = useRouter();
  const [activeCalls, setActiveCalls] = useState(initialActiveCalls);
  const [history, setHistory] = useState(initialHistory);
  const [scheduledCalls, setScheduledCalls] = useState(initialScheduledCalls);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("START");
  const [name, setName] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [openTimePicker, setOpenTimePicker] = useState<"end" | "start" | null>(null);
  const defaults = getDefaultScheduleWindow();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [endTime, setEndTime] = useState(defaults.endTime);

  const visibleActiveCalls = activeCalls.filter((call) => call.status === "ACTIVE");

  function openModal(mode: ModalMode) {
    const nextDefaults = getDefaultScheduleWindow();
    setModalMode(mode);
    setName("");
    setSelectedUserIds([]);
    setStartDate(nextDefaults.startDate);
    setStartTime(nextDefaults.startTime);
    setEndDate(nextDefaults.endDate);
    setEndTime(nextDefaults.endTime);
    setOpenTimePicker(null);
    setNotice(null);
    setIsModalOpen(true);
  }

  function resetModal() {
    setName("");
    setSelectedUserIds([]);
    setOpenTimePicker(null);
    setNotice(null);
    setIsModalOpen(false);
  }

  function activateCall(call: VideoCallSummary) {
    if (!call.dailyRoomUrl) {
      setNotice("This call is not ready yet.");
      return;
    }

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
      scheduledCalls?: VideoCallSummary[];
    };

    setActiveCalls(payload.activeCalls ?? []);
    setHistory(payload.history ?? []);
    setScheduledCalls(payload.scheduledCalls ?? []);
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshState();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  async function createCall() {
    const trimmedName = name.trim();

    if (!trimmedName) {
      setNotice("Call name is required.");
      return;
    }

    const body: {
      endAt?: string;
      invitedUserIds: string[];
      mode: ModalMode;
      name: string;
      startAt?: string;
    } = {
      invitedUserIds: selectedUserIds,
      mode: modalMode,
      name: trimmedName,
    };

    if (modalMode === "SCHEDULE") {
      const startAt = toIso(startDate, startTime);
      const endAt = toIso(endDate, endTime);

      if (!startAt || !endAt) {
        setNotice("Valid start and end times are required.");
        return;
      }

      if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
        setNotice("End time must be after start time.");
        return;
      }

      body.startAt = startAt;
      body.endAt = endAt;
    }

    setIsSaving(true);
    setNotice(null);

    const response = await fetch("/api/video-calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      call?: VideoCallSummary;
      error?: string;
    };

    setIsSaving(false);

    if (!response.ok || !payload.call) {
      setNotice(payload.error ?? "Call could not be created.");
      return;
    }

    resetModal();

    if (modalMode === "SCHEDULE") {
      setScheduledCalls((current) => [payload.call!, ...current]);
      window.dispatchEvent(new Event("calendar-pending-should-refresh"));
      return;
    }

    setActiveCalls((current) => [payload.call!, ...current]);
    activateCall(payload.call);
  }

  async function startScheduledCall(call: VideoCallSummary) {
    setNotice(null);

    const response = await fetch(`/api/video-calls/${encodeURIComponent(call.id)}/start`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as {
      call?: VideoCallSummary;
      error?: string;
    } | null;

    if (!response.ok || !payload?.call) {
      setNotice(payload?.error ?? "Scheduled call could not be started.");
      return;
    }

    setScheduledCalls((current) => current.filter((item) => item.id !== call.id));
    setActiveCalls((current) => [payload.call!, ...current.filter((item) => item.id !== call.id)]);
    activateCall(payload.call);
  }

  async function joinCall(call: VideoCallSummary) {
    setNotice(null);
    const response = await fetch(`/api/video-calls/${encodeURIComponent(call.id)}/join`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as {
      call?: VideoCallSummary;
      error?: string;
    } | null;

    if (!response.ok || !payload?.call) {
      setNotice(payload?.error ?? "Call could not be joined.");
      return;
    }

    setActiveCalls((current) => [
      payload.call!,
      ...current.filter((item) => item.id !== payload.call!.id),
    ]);
    activateCall(payload.call);
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

  function renderCallCard(call: VideoCallSummary) {
    const isJoined = call.joined.some((participant) => participant.id === currentUserId);
    const waiting = call.invited.filter((participant) => participant.status === "INVITED");

    return (
      <article className="video-call-card" key={call.id}>
        <div className="video-call-card-copy">
          <span className="context-label">Live Call</span>
          <h2>{call.name}</h2>
          <p>{formatCallDate(call.startedAt)}</p>
        </div>
        <div className="video-call-participant-groups">
          <ParticipantRow label="In call" participants={call.joined} />
          <ParticipantRow label="Invited" participants={waiting} />
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
  }

  return (
    <div className="video-call-panel">
      <div className="video-call-panel-header">
        <div>
          <span className="context-label">Video Call</span>
          <h1>Calls</h1>
        </div>
        <div className="video-call-top-actions">
          <button
            className="primary-button"
            onClick={() => {
              openModal("START");
            }}
            type="button"
          >
            Start Call
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              openModal("SCHEDULE");
            }}
            type="button"
          >
            Schedule Call
          </button>
        </div>
      </div>

      <div className="video-call-command">
        <VideoCallIcon />
        {visibleActiveCalls.length === 0 ? (
          <div className="video-call-empty">
            <p>No active invited calls.</p>
          </div>
        ) : (
          <div className="video-call-active-list">
            {visibleActiveCalls.map((call) => renderCallCard(call))}
          </div>
        )}
        {notice ? <p className="video-call-notice">{notice}</p> : null}
      </div>

      <div className="video-call-lists">
        <section className="video-call-list-section">
          <div className="video-call-list-header">
            <h2>Scheduled</h2>
            <span>{scheduledCalls.length}</span>
          </div>
          <div className="video-call-scheduled-list">
            {scheduledCalls.length > 0 ? (
              scheduledCalls.map((call) => (
                <article className="video-call-scheduled-item" key={call.id}>
                  <div>
                    <span className="context-label">
                      {formatCallDate(call.scheduledFor ?? call.startedAt)}
                    </span>
                    <h3>{call.name}</h3>
                    <p>{compactParticipants(uniqueParticipants(call))}</p>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void startScheduledCall(call);
                    }}
                    type="button"
                  >
                    Start
                  </button>
                </article>
              ))
            ) : (
              <p className="video-call-history-empty">No scheduled calls.</p>
            )}
          </div>
        </section>

        <section className="video-call-list-section">
          <div className="video-call-list-header">
            <h2>History</h2>
            <span>{history.length}</span>
          </div>
          <div className="video-call-history-list">
            {history.length > 0 ? (
              history.map((call) => (
                <article className="video-call-history-item" key={call.id}>
                  <div>
                    <span className="context-label">{formatCallDate(call.startedAt)}</span>
                    <h3>{call.name}</h3>
                    <p>{compactParticipants(uniqueParticipants(call))}</p>
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
      </div>

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
            <div className="video-call-modal-scroll">
              <div className="team-modal-header">
                <h2>{modalMode === "SCHEDULE" ? "Schedule call" : "Start call"}</h2>
                <p className="helper-text">
                  {modalMode === "SCHEDULE"
                    ? "Reserve a call time and choose the human participants to invite."
                    : "Name the call and choose the human participants to invite."}
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
              {modalMode === "SCHEDULE" ? (
                <div className="calendar-form-grid video-call-schedule-grid">
                  <fieldset className="calendar-date-group">
                    <legend>Start</legend>
                    <label className="calendar-date-input">
                      <span>Date</span>
                      <input
                        className="team-modal-input settings-input"
                        inputMode="numeric"
                        onChange={(event) => {
                          setStartDate(event.target.value);
                        }}
                        placeholder="YYYY-MM-DD"
                        type="text"
                        value={startDate}
                      />
                    </label>
                    <label className="calendar-date-input">
                      <span>Time</span>
                      <button
                        className="calendar-time-button"
                        onClick={() => {
                          setOpenTimePicker((current) =>
                            current === "start" ? null : "start",
                          );
                        }}
                        type="button"
                      >
                        {startTime}
                      </button>
                      {openTimePicker === "start" ? (
                        <div className="calendar-time-menu">
                          {selectableTimes.map((time) => (
                            <button
                              className={time === startTime ? "calendar-time-option-active" : ""}
                              key={time}
                              onClick={() => {
                                setStartTime(time);
                                setOpenTimePicker(null);
                              }}
                              type="button"
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </label>
                  </fieldset>
                  <fieldset className="calendar-date-group">
                    <legend>End</legend>
                    <label className="calendar-date-input">
                      <span>Date</span>
                      <input
                        className="team-modal-input settings-input"
                        inputMode="numeric"
                        onChange={(event) => {
                          setEndDate(event.target.value);
                        }}
                        placeholder="YYYY-MM-DD"
                        type="text"
                        value={endDate}
                      />
                    </label>
                    <label className="calendar-date-input">
                      <span>Time</span>
                      <button
                        className="calendar-time-button"
                        onClick={() => {
                          setOpenTimePicker((current) => (current === "end" ? null : "end"));
                        }}
                        type="button"
                      >
                        {endTime}
                      </button>
                      {openTimePicker === "end" ? (
                        <div className="calendar-time-menu">
                          {selectableTimes.map((time) => (
                            <button
                              className={time === endTime ? "calendar-time-option-active" : ""}
                              key={time}
                              onClick={() => {
                                setEndTime(time);
                                setOpenTimePicker(null);
                              }}
                              type="button"
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </label>
                  </fieldset>
                </div>
              ) : null}
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
            </div>
            <div className="team-modal-actions video-call-modal-actions">
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
                {isSaving
                  ? modalMode === "SCHEDULE"
                    ? "Scheduling..."
                    : "Starting..."
                  : modalMode === "SCHEDULE"
                    ? "Schedule Call"
                    : "Start Call"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
