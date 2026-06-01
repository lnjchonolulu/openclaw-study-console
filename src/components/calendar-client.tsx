"use client";

import { useMemo, useRef, useState, type WheelEvent } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import type { CalendarEventView, CalendarMonthView } from "@/lib/calendar";
import {
  addMonthsToMonthKey,
  dateKeyInTimeZone,
  formatDateTimeInTimeZone,
  monthKeyInTimeZone,
  timeInputValueInTimeZone,
  zonedDateTimeToUtc,
} from "@/lib/timezone";

type EventModalMode = "create" | "edit";
type TimePickerTarget = "end" | "start";

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, (monthNumber || 1) - 1, 1));
}

function dateInputValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseZonedDateTime(date: string, time: string, timeZone: string) {
  const trimmedDate = date.trim();
  const trimmedTime = time.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate) || !/^\d{2}:\d{2}$/.test(trimmedTime)) {
    return null;
  }

  const value = zonedDateTimeToUtc(trimmedDate, trimmedTime, timeZone);

  return value && !Number.isNaN(value.getTime()) ? value : null;
}

function timeOptions() {
  return Array.from({ length: 96 }, (_, index) => {
    const hours = Math.floor(index / 4);
    const minutes = String((index % 4) * 15).padStart(2, "0");

    return `${String(hours).padStart(2, "0")}:${minutes}`;
  });
}

function addMonths(month: string, amount: number) {
  return addMonthsToMonthKey(month, amount);
}

function getMonthCells(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, (monthNumber || 1) - 1, 1);
  const last = new Date(year, monthNumber || 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));
  const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return date;
  });
}

function timeLabel(isoString: string, allDay: boolean, timeZone: string) {
  if (allDay) {
    return "All day";
  }

  return formatDateTimeInTimeZone(isoString, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInviteDate(isoString: string, timeZone: string) {
  return formatDateTimeInTimeZone(isoString, timeZone, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function defaultRangeForDate(date?: Date) {
  const start = date ? new Date(date) : new Date();

  if (date) {
    start.setHours(10, 0, 0, 0);
  } else {
    start.setHours(start.getHours() + 1, 0, 0, 0);
  }

  const end = new Date(start);
  end.setHours(start.getHours() + 1);

  return { end, start };
}

export function CalendarClient({ initialView }: { initialView: CalendarMonthView }) {
  const [view, setView] = useState(initialView);
  const timeZone = view.timeZone;
  const [modalMode, setModalMode] = useState<EventModalMode>("create");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isInvitePopoverOpen, setIsInvitePopoverOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [openTimePicker, setOpenTimePicker] = useState<TimePickerTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const wheelLockRef = useRef(0);
  const now = useMemo(() => new Date(), []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(
    dateKeyInTimeZone(defaultRangeForDate().start, initialView.timeZone),
  );
  const [startTime, setStartTime] = useState(
    timeInputValueInTimeZone(defaultRangeForDate().start, initialView.timeZone),
  );
  const [endDate, setEndDate] = useState(
    dateKeyInTimeZone(defaultRangeForDate().end, initialView.timeZone),
  );
  const [endTime, setEndTime] = useState(
    timeInputValueInTimeZone(defaultRangeForDate().end, initialView.timeZone),
  );
  const [invitedUserIds, setInvitedUserIds] = useState<string[]>([]);
  const selectableTimes = useMemo(() => timeOptions(), []);
  const people = view.participants.filter(
    (participant) => participant.kind === "user" && participant.id !== view.currentUserId,
  );
  const cells = getMonthCells(view.month);

  async function loadMonth(month: string) {
    const response = await fetch(`/api/calendar?month=${encodeURIComponent(month)}`);

    if (!response.ok) {
      setNotice("Calendar could not be refreshed.");
      return;
    }

    setView((await response.json()) as CalendarMonthView);
  }

  function resetModalForCreate(date?: Date) {
    const range = defaultRangeForDate(date);

    setModalMode("create");
    setEditingEventId(null);
    setTitle("");
    setDescription("");
    setLocation("");
    setStartDate(date ? dateInputValue(date) : dateKeyInTimeZone(range.start, timeZone));
    setStartTime(date ? "10:00" : timeInputValueInTimeZone(range.start, timeZone));
    setEndDate(date ? dateInputValue(date) : dateKeyInTimeZone(range.end, timeZone));
    setEndTime(date ? "11:00" : timeInputValueInTimeZone(range.end, timeZone));
    setInvitedUserIds([]);
  }

  function openCreateModal(date?: Date) {
    setNotice(null);
    setOpenTimePicker(null);
    resetModalForCreate(date);
    setIsEventModalOpen(true);
  }

  function openEditModal(event: CalendarEventView) {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);

    setNotice(null);
    setOpenTimePicker(null);
    setModalMode("edit");
    setEditingEventId(event.id);
    setTitle(event.title);
    setDescription(event.description);
    setLocation(event.location);
    setStartDate(dateKeyInTimeZone(start, timeZone));
    setStartTime(timeInputValueInTimeZone(start, timeZone));
    setEndDate(dateKeyInTimeZone(end, timeZone));
    setEndTime(timeInputValueInTimeZone(end, timeZone));
    setInvitedUserIds(
      event.invitees
        .filter((invitee) => invitee.status !== "CANCELED")
        .map((invitee) => invitee.invitedUserId),
    );
    setIsEventModalOpen(true);
  }

  async function saveEvent() {
    setIsSaving(true);
    setNotice(null);

    try {
      const startAt = parseZonedDateTime(startDate, startTime, timeZone);
      const endAt = parseZonedDateTime(endDate, endTime, timeZone);

      if (!title.trim()) {
        setNotice("Event title is required.");
        return;
      }

      if (!startAt || !endAt) {
        setNotice("Use YYYY-MM-DD for dates and HH:MM for times.");
        return;
      }

      if (endAt <= startAt) {
        setNotice("End time must be after start time.");
        return;
      }

      const payload = {
        description,
        endAt: endAt.toISOString(),
        invitedUserIds,
        location,
        startAt: startAt.toISOString(),
        title,
      };
      const response = await fetch(
        modalMode === "edit" && editingEventId
          ? `/api/calendar/${encodeURIComponent(editingEventId)}`
          : "/api/calendar",
        {
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
          },
          method: modalMode === "edit" ? "PATCH" : "POST",
        },
      );

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        setNotice(errorPayload?.error ?? "Event could not be saved.");
        return;
      }

      setIsEventModalOpen(false);
      await loadMonth(view.month);
    } finally {
      setIsSaving(false);
    }
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

    window.dispatchEvent(new Event("calendar-pending-should-refresh"));
    await loadMonth(view.month);
  }

  function toggleInvitee(userId: string) {
    setInvitedUserIds((current) =>
      current.includes(userId)
        ? current.filter((value) => value !== userId)
        : [...current, userId],
    );
  }

  function handleCalendarWheel(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaY) < 24) {
      return;
    }

    const nowMs = Date.now();

    if (nowMs - wheelLockRef.current < 480) {
      return;
    }

    wheelLockRef.current = nowMs;
    void loadMonth(addMonths(view.month, event.deltaY > 0 ? 1 : -1));
  }

  return (
    <section className="chat-page calendar-page">
      <div className="content-card calendar-panel">
        <div className="calendar-header">
          <div className="calendar-title-row">
            <div>
              <span className="context-label">Calendar</span>
              <h1>{monthLabel(view.month)}</h1>
            </div>
            <button
              className="primary-button calendar-new-button"
              onClick={() => {
                openCreateModal();
              }}
              type="button"
            >
              New Event
            </button>
          </div>

          <div className="calendar-right-tools">
            <div className="calendar-invite-summary">
              <button
                className={`secondary-button calendar-invite-chip${view.invitations.length > 0 ? " calendar-invite-chip-active" : ""}`}
                onClick={() => {
                  setIsInvitePopoverOpen((current) => !current);
                }}
                type="button"
              >
                {view.invitations.length} pending
              </button>
              {isInvitePopoverOpen ? (
                <div className="calendar-invite-popover">
                  <span className="context-label">Pending invitations</span>
                  {view.invitations.length === 0 ? (
                    <p>No pending invitations.</p>
                  ) : (
                    <div className="calendar-invite-list">
                      {view.invitations.map((invitation) => (
                        <div className="calendar-invite-card" key={invitation.id}>
                          <div>
                            <strong>{invitation.event.title}</strong>
                            <span>
                              Invited by {invitation.invitedBy}
                            </span>
                            <span>
                              {formatInviteDate(invitation.event.startAt, timeZone)}
                            </span>
                          </div>
                          <div className="calendar-invite-actions">
                            <button
                              className="secondary-button"
                              onClick={() =>
                                void respondToInvitation(invitation.id, "DECLINED")
                              }
                              type="button"
                            >
                              Decline
                            </button>
                            <button
                              className="primary-button"
                              onClick={() =>
                                void respondToInvitation(invitation.id, "ACCEPTED")
                              }
                              type="button"
                            >
                              Accept
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="calendar-actions">
              <button
                aria-label="Previous month"
                className="secondary-button calendar-square-button"
                onClick={() => void loadMonth(addMonths(view.month, -1))}
                type="button"
              >
                ‹
              </button>
              <button
                className="secondary-button calendar-today-button"
                onClick={() => void loadMonth(monthKeyInTimeZone(new Date(), timeZone))}
                type="button"
              >
                Today
              </button>
              <button
                aria-label="Next month"
                className="secondary-button calendar-square-button"
                onClick={() => void loadMonth(addMonths(view.month, 1))}
                type="button"
              >
                ›
              </button>
            </div>
          </div>
        </div>

        {notice ? <div className="context-notice calendar-notice">{notice}</div> : null}

        <div
          className="calendar-grid"
          onWheel={handleCalendarWheel}
          role="grid"
          style={{
            gridTemplateRows: `32px repeat(${cells.length / 7}, minmax(0, 1fr))`,
          }}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div className="calendar-weekday" key={day}>
              {day}
            </div>
          ))}
          {cells.map((cell) => {
            const cellDateKey = dateInputValue(cell);
            const cellEvents = view.events.filter(
              (event) => dateKeyInTimeZone(new Date(event.startAt), timeZone) === cellDateKey,
            );
            const isOutside = cell.getMonth() !== Number(view.month.split("-")[1]) - 1;
            const isToday = cellDateKey === dateKeyInTimeZone(now, timeZone);

            return (
              <div
                className={`calendar-day${isOutside ? " calendar-day-muted" : ""}${isToday ? " calendar-day-today" : ""}`}
                key={cell.toISOString()}
                onClick={() => {
                  openCreateModal(cell);
                }}
                role="gridcell"
              >
                <span className="calendar-day-number">{cell.getDate()}</span>
                <div className="calendar-event-list">
                  {cellEvents.map((event) => (
                    <button
                      className="calendar-event-chip"
                      key={event.id}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        openEditModal(event);
                      }}
                      type="button"
                    >
                      <span>{timeLabel(event.startAt, event.allDay, timeZone)}</span>
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
          className="team-modal-backdrop calendar-modal-backdrop"
          onClick={() => {
            if (!isSaving) {
              setOpenTimePicker(null);
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
            <div className="calendar-modal-scroll">
              <div className="team-modal-header">
                <h2>{modalMode === "edit" ? "Edit Event" : "New Event"}</h2>
              </div>
              {notice ? <div className="context-notice calendar-modal-notice">{notice}</div> : null}
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
                        setOpenTimePicker((current) => (current === "start" ? null : "start"));
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
            </div>
            <div className="team-modal-actions calendar-modal-actions">
              <button
                className="secondary-button"
                disabled={isSaving}
                onClick={() => {
                  setOpenTimePicker(null);
                  setIsEventModalOpen(false);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={isSaving}
                onClick={() => void saveEvent()}
                type="button"
              >
                {isSaving ? "Saving..." : modalMode === "edit" ? "Save Event" : "Create Event"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
