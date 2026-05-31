"use client";

import { useMemo, useState } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import type { CalendarMonthView } from "@/lib/calendar";

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, (monthNumber || 1) - 1, 1));
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function addMonths(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, (monthNumber || 1) - 1 + amount, 1));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getMonthCells(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, (monthNumber || 1) - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return date;
  });
}

function sameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function timeLabel(isoString: string, allDay: boolean) {
  if (allDay) {
    return "All day";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export function CalendarClient({ initialView }: { initialView: CalendarMonthView }) {
  const [view, setView] = useState(initialView);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const date = new Date();
    date.setHours(date.getHours() + 1, 0, 0, 0);
    return date;
  }, []);
  const defaultEnd = useMemo(() => {
    const date = new Date(defaultStart);
    date.setHours(date.getHours() + 1);
    return date;
  }, [defaultStart]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startAt, setStartAt] = useState(toDateInputValue(defaultStart));
  const [endAt, setEndAt] = useState(toDateInputValue(defaultEnd));
  const [invitedUserIds, setInvitedUserIds] = useState<string[]>([]);
  const people = view.participants.filter((participant) => participant.kind === "user");
  const cells = getMonthCells(view.month);

  async function loadMonth(month: string) {
    const response = await fetch(`/api/calendar?month=${encodeURIComponent(month)}`);

    if (!response.ok) {
      setNotice("Calendar could not be refreshed.");
      return;
    }

    setView((await response.json()) as CalendarMonthView);
  }

  async function createEvent() {
    setIsSaving(true);
    setNotice(null);

    const response = await fetch("/api/calendar", {
      body: JSON.stringify({
        description,
        endAt: new Date(endAt).toISOString(),
        invitedUserIds,
        location,
        startAt: new Date(startAt).toISOString(),
        title,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    setIsSaving(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(payload?.error ?? "Event could not be created.");
      return;
    }

    setTitle("");
    setDescription("");
    setLocation("");
    setInvitedUserIds([]);
    setIsEventModalOpen(false);
    await loadMonth(view.month);
  }

  async function respondToInvitation(invitationId: string, status: "ACCEPTED" | "DECLINED") {
    const response = await fetch(`/api/calendar/invitations/${encodeURIComponent(invitationId)}`, {
      body: JSON.stringify({ status }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });

    if (!response.ok) {
      setNotice("Invitation could not be updated.");
      return;
    }

    await loadMonth(view.month);
  }

  function toggleInvitee(userId: string) {
    setInvitedUserIds((current) =>
      current.includes(userId)
        ? current.filter((value) => value !== userId)
        : [...current, userId],
    );
  }

  return (
    <section className="chat-page calendar-page">
      <div className="content-card calendar-panel">
        <div className="calendar-header">
          <div>
            <span className="context-label">Calendar</span>
            <h1>{monthLabel(view.month)}</h1>
          </div>
          <div className="calendar-actions">
            <button
              className="secondary-button calendar-nav-button"
              onClick={() => void loadMonth(addMonths(view.month, -1))}
              type="button"
            >
              Previous
            </button>
            <button
              className="secondary-button calendar-nav-button"
              onClick={() => void loadMonth(addMonths(view.month, 1))}
              type="button"
            >
              Next
            </button>
            <button
              className="primary-button calendar-new-button"
              onClick={() => {
                setNotice(null);
                setIsEventModalOpen(true);
              }}
              type="button"
            >
              New Event
            </button>
          </div>
        </div>

        {view.invitations.length > 0 ? (
          <div className="calendar-invites">
            <span className="context-label">Pending invitations</span>
            <div className="calendar-invite-list">
              {view.invitations.map((invitation) => (
                <div className="calendar-invite-card" key={invitation.id}>
                  <div>
                    <strong>{invitation.event.title}</strong>
                    <span>
                      Invited by {invitation.invitedBy} ·{" "}
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(invitation.event.startAt))}
                    </span>
                  </div>
                  <div className="calendar-invite-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void respondToInvitation(invitation.id, "DECLINED")}
                      type="button"
                    >
                      Decline
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void respondToInvitation(invitation.id, "ACCEPTED")}
                      type="button"
                    >
                      Accept
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {notice ? <div className="context-notice calendar-notice">{notice}</div> : null}

        <div className="calendar-grid" role="grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div className="calendar-weekday" key={day}>
              {day}
            </div>
          ))}
          {cells.map((cell) => {
            const cellEvents = view.events.filter((event) =>
              sameLocalDay(new Date(event.startAt), cell),
            );
            const isOutside = cell.getMonth() !== Number(view.month.split("-")[1]) - 1;
            const isToday = sameLocalDay(cell, now);

            return (
              <div
                className={`calendar-day${isOutside ? " calendar-day-muted" : ""}${isToday ? " calendar-day-today" : ""}`}
                key={cell.toISOString()}
                role="gridcell"
              >
                <span className="calendar-day-number">{cell.getDate()}</span>
                <div className="calendar-event-list">
                  {cellEvents.map((event) => (
                    <button className="calendar-event-chip" key={event.id} type="button">
                      <span>{timeLabel(event.startAt, event.allDay)}</span>
                      <strong>{event.title}</strong>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isEventModalOpen ? (
        <div
          className="team-modal-backdrop"
          onClick={() => {
            if (!isSaving) {
              setIsEventModalOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="content-card team-modal calendar-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
            role="dialog"
          >
            <div className="team-modal-header">
              <h2>New Event</h2>
              <p>Create the event first. Invitees get access only after they accept.</p>
            </div>
            <div className="calendar-form-grid">
              <label className="split-label calendar-field-wide">
                Title
                <span className="team-modal-input-wrap">
                  <input
                    className="team-modal-input settings-input"
                    onChange={(event) => {
                      setTitle(event.target.value);
                    }}
                    placeholder="Meeting, check-in, workshop..."
                    value={title}
                  />
                </span>
              </label>
              <label className="split-label">
                Start
                <span className="team-modal-input-wrap">
                  <input
                    className="team-modal-input settings-input"
                    onChange={(event) => {
                      setStartAt(event.target.value);
                    }}
                    type="datetime-local"
                    value={startAt}
                  />
                </span>
              </label>
              <label className="split-label">
                End
                <span className="team-modal-input-wrap">
                  <input
                    className="team-modal-input settings-input"
                    onChange={(event) => {
                      setEndAt(event.target.value);
                    }}
                    type="datetime-local"
                    value={endAt}
                  />
                </span>
              </label>
              <label className="split-label calendar-field-wide">
                Location
                <span className="team-modal-input-wrap">
                  <input
                    className="team-modal-input settings-input"
                    onChange={(event) => {
                      setLocation(event.target.value);
                    }}
                    placeholder="Optional"
                    value={location}
                  />
                </span>
              </label>
              <label className="split-label calendar-field-wide">
                Notes
                <textarea
                  className="settings-textarea-field calendar-description"
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                  placeholder="Optional agenda or context"
                  value={description}
                />
              </label>
            </div>
            <div className="team-modal-section">
              <span className="context-label">Invite people</span>
              <div className="team-invite-list calendar-invite-picker">
                {people.map((participant) => (
                  <label
                    className={`team-invite-card${invitedUserIds.includes(participant.id) ? " team-invite-card-selected" : ""}`}
                    key={participant.id}
                  >
                    <input
                      checked={invitedUserIds.includes(participant.id)}
                      onChange={() => {
                        toggleInvitee(participant.id);
                      }}
                      type="checkbox"
                    />
                    <span className="team-invite-check">
                      {invitedUserIds.includes(participant.id) ? "✓" : ""}
                    </span>
                    <ProfileAvatar avatar={participant.avatar} className="context-avatar" />
                    <span className="team-invite-copy">
                      <span>{participant.name}</span>
                      <span>{participant.meta}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="team-modal-actions">
              <button
                className="secondary-button"
                disabled={isSaving}
                onClick={() => {
                  setIsEventModalOpen(false);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={isSaving}
                onClick={() => void createEvent()}
                type="button"
              >
                {isSaving ? "Saving..." : "Create Event"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
