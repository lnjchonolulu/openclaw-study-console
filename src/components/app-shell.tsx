"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { primaryNavItems, secondaryNavItems } from "@/lib/navigation";
import type { DmItem } from "@/lib/dm";
import type { TeamChannelDetail, TeamChannelSummary, TeamParticipant } from "@/lib/team";

type IconName = "calendar" | "dm" | "files" | "setting" | "sign-out" | "team";

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dm: (
      <path d="M4.75 5.75h14.5v10.5H9l-4.25 3.5v-14Z" />
    ),
    team: (
      <>
        <path d="M9.25 11.25a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M15.5 10.75a2.5 2.5 0 1 0 0-5" />
        <path d="M4.75 19.25v-1.1c0-2.4 2-4.35 4.5-4.35s4.5 1.95 4.5 4.35v1.1" />
        <path d="M14.75 14.15c2.25.25 3.75 1.95 3.75 4v1.1" />
      </>
    ),
    files: (
      <>
        <path d="M5.75 6.75h5l1.6 2h5.9v8.5a2 2 0 0 1-2 2H7.75a2 2 0 0 1-2-2V6.75Z" />
        <path d="M5.75 9.25h12.5" />
      </>
    ),
    calendar: (
      <>
        <path d="M6.25 5.75h11.5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.25a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" />
        <path d="M7.75 3.75v4" />
        <path d="M16.25 3.75v4" />
        <path d="M4.25 9.5h15.5" />
        <path d="M8 13h.1" />
        <path d="M12 13h.1" />
        <path d="M16 13h.1" />
        <path d="M8 16h.1" />
        <path d="M12 16h.1" />
      </>
    ),
    setting: (
      <>
        <path d="M12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" />
        <path d="M18.25 13.4v-2.8l-2.05-.45a5 5 0 0 0-.55-1.35l1.15-1.75-1.95-1.95-1.75 1.15a5 5 0 0 0-1.35-.55L11.3 3.75H8.7L8.25 5.8a5 5 0 0 0-1.35.55L5.15 5.2 3.2 7.15 4.35 8.9a5 5 0 0 0-.55 1.35l-2.05.45v2.6l2.05.45c.13.48.32.93.55 1.35L3.2 16.85l1.95 1.95 1.75-1.15c.42.23.87.42 1.35.55l.45 2.05h2.6l.45-2.05c.48-.13.93-.32 1.35-.55l1.75 1.15 1.95-1.95-1.15-1.75c.23-.42.42-.87.55-1.35l2.05-.35Z" />
      </>
    ),
    "sign-out": (
      <>
        <path d="M10.25 5.25h-3.5a2 2 0 0 0-2 2v9.5a2 2 0 0 0 2 2h3.5" />
        <path d="M13.75 8.25 17.5 12l-3.75 3.75" />
        <path d="M8.75 12H17.5" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
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
        {paths[name]}
      </g>
    </svg>
  );
}

export function AppShell({
  availableDmTargets,
  calendarPendingInvitationCount,
  children,
  dmConversations,
  initialTeamChannels,
  teamParticipants,
  user,
}: {
  availableDmTargets: DmItem[];
  calendarPendingInvitationCount: number;
  children: React.ReactNode;
  dmConversations: DmItem[];
  initialTeamChannels: TeamChannelSummary[];
  teamParticipants: TeamParticipant[];
  user: {
    agentId: string | null;
    displayName: string;
    id: string;
    role: "ADMIN" | "PARTICIPANT";
    username: string;
    teamName: string | null;
  };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [availableDms, setAvailableDms] = useState(availableDmTargets);
  const [calendarPendingCount, setCalendarPendingCount] = useState(calendarPendingInvitationCount);
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const [dmItems, setDmItems] = useState(dmConversations);
  const [teamChannels, setTeamChannels] = useState(initialTeamChannels);
  const [participants, setParticipants] = useState(teamParticipants);
  const [isNewDmOpen, setIsNewDmOpen] = useState(false);
  const [isTeamChannelModalOpen, setIsTeamChannelModalOpen] = useState(false);
  const [teamChannelName, setTeamChannelName] = useState("");
  const [teamChannelPurpose, setTeamChannelPurpose] = useState("");
  const [teamInviteKeys, setTeamInviteKeys] = useState<string[]>([]);
  const [channelMenuId, setChannelMenuId] = useState<string | null>(null);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [teamModalMode, setTeamModalMode] = useState<"create" | "members" | "rename">("create");
  const contextMode =
    pathname === "/chat" ? "dm" : pathname === "/team" ? "team" : null;
  const hasContext = Boolean(contextMode);
  const generalChannelId =
    teamChannels.find((channel) => channel.title === "General")?.id ??
    initialTeamChannels.find((channel) => channel.title === "General")?.id ??
    "";
  const selectedDmKey = searchParams.get("user")
    ? `person:${searchParams.get("user")}`
    : `agent:${searchParams.get("agent") ?? user.agentId ?? ""}`;
  const rawSelectedChannel = searchParams.get("channel");
  const selectedChannel =
    !rawSelectedChannel || rawSelectedChannel === "main"
      ? generalChannelId
      : rawSelectedChannel;
  const displayedDmItems = dmItems.map((item) =>
    pathname === "/chat" && `${item.kind}:${item.id}` === selectedDmKey
      ? {
          ...item,
          unreadCount: 0,
        }
      : item,
  );

  useEffect(() => {
    setTeamChannels(initialTeamChannels);
  }, [initialTeamChannels]);

  useEffect(() => {
    setParticipants(teamParticipants);
  }, [teamParticipants]);

  useEffect(() => {
    let isMounted = true;

    async function refreshCalendarPendingCount() {
      const response = await fetch("/api/calendar/invitations");

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { pendingCount?: number };

      if (isMounted && typeof payload.pendingCount === "number") {
        setCalendarPendingCount(payload.pendingCount);
      }
    }

    const intervalId = window.setInterval(refreshCalendarPendingCount, 5000);
    window.addEventListener("calendar-pending-should-refresh", refreshCalendarPendingCount);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("calendar-pending-should-refresh", refreshCalendarPendingCount);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function refreshDmSidebar() {
      const response = await fetch("/api/dm/sidebar");

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { conversations?: DmItem[] };

      if (isMounted && payload.conversations) {
        setDmItems(payload.conversations);
      }
    }

    const intervalId = window.setInterval(refreshDmSidebar, 2000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (pathname !== "/chat") {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      const response = await fetch("/api/dm/sidebar");

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { conversations?: DmItem[] };

      if (payload.conversations) {
        setDmItems(payload.conversations);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pathname, selectedDmKey]);

  useEffect(() => {
    if (pathname !== "/team") {
      return;
    }

    let isMounted = true;

    async function refreshTeamSidebar() {
      const response = await fetch("/api/team/channels");

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        channels?: TeamChannelSummary[];
        participants?: TeamParticipant[];
      };

      if (!isMounted) {
        return;
      }

      if (payload.channels) {
        setTeamChannels(payload.channels);
      }

      if (payload.participants) {
        setParticipants(payload.participants);
      }
    }

    void refreshTeamSidebar();

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  function getDmHref(target: DmItem) {
    const paramName = target.kind === "agent" ? "agent" : "user";

    return `/chat?${paramName}=${encodeURIComponent(target.id)}`;
  }

  function startDm(target: DmItem) {
    setContextNotice(null);
    setIsNewDmOpen(false);
    setDmItems((current) =>
      current.some((item) => item.id === target.id && item.kind === target.kind)
        ? current
        : [target, ...current],
    );
    setAvailableDms((current) =>
      current.filter(
        (item) => !(item.id === target.id && item.kind === target.kind),
      ),
    );
  }

  function resetTeamChannelModal() {
    setTeamChannelName("");
    setTeamChannelPurpose("");
    setTeamInviteKeys([]);
    setEditingChannelId(null);
    setTeamModalMode("create");
  }

  function openCreateTeamChannelModal() {
    setContextNotice(null);
    resetTeamChannelModal();
    setTeamModalMode("create");
    setIsTeamChannelModalOpen(true);
  }

  async function openEditTeamChannelModal(
    channel: TeamChannelSummary,
    mode: "members" | "rename",
  ) {
    setChannelMenuId(null);
    setContextNotice(null);

    const response = await fetch(`/api/team/messages?roomId=${encodeURIComponent(channel.id)}`);

    if (!response.ok) {
      setContextNotice("Channel details could not be loaded.");
      return;
    }

    const detail = (await response.json()) as TeamChannelDetail;

    setTeamModalMode(mode);
    setTeamChannelName(detail.title);
    setTeamChannelPurpose(detail.purpose ?? "");
    setTeamInviteKeys(
      detail.members
        .filter((member) => !(member.kind === "user" && member.id === user.id))
        .map((member) => `${member.kind ?? "user"}:${member.id}`),
    );
    setEditingChannelId(channel.id);
    setIsTeamChannelModalOpen(true);
  }

  async function submitTeamChannelModal() {
    const trimmedName = teamChannelName.trim();

    if (!trimmedName) {
      setContextNotice("Channel name is required.");
      return;
    }

    const invitedUserIds = teamInviteKeys
      .filter((key) => key.startsWith("user:"))
      .map((key) => key.slice(5));
    const invitedAgentIds = teamInviteKeys
      .filter((key) => key.startsWith("agent:"))
      .map((key) => key.slice(6));

    const response = await fetch(
      editingChannelId
        ? `/api/team/channels/${encodeURIComponent(editingChannelId)}`
        : "/api/team/channels",
      {
        method: editingChannelId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invitedAgentIds,
          invitedUserIds,
          name: trimmedName,
          purpose: teamChannelPurpose.trim(),
        }),
      },
    );

    const payload = (await response.json()) as {
      channelId?: string;
      error?: string;
    };

    if (!response.ok) {
      setContextNotice(payload.error ?? "Channel could not be saved.");
      return;
    }

    setIsTeamChannelModalOpen(false);
    resetTeamChannelModal();

    if (editingChannelId) {
      router.refresh();
      return;
    }

    router.push(
      `/team?channel=${encodeURIComponent(payload.channelId ?? generalChannelId)}`,
    );
    router.refresh();
  }

  async function deleteTeamChannel(channel: TeamChannelSummary) {
    setChannelMenuId(null);

    const response = await fetch(
      `/api/team/channels/${encodeURIComponent(channel.id)}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      setContextNotice("Channel could not be deleted.");
      return;
    }

    if (selectedChannel === channel.id) {
      router.push(`/team?channel=${encodeURIComponent(generalChannelId)}`);
    }

    router.refresh();
  }

  return (
    <div className={`app-shell${hasContext ? " app-shell-context-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-main">
          <div className="sidebar-brand" aria-label="CyWorld">
            CyWorld
          </div>
          <nav className="nav-list" aria-label="Primary">
            {primaryNavItems.map((item) => {
              const isActive = pathname === item.href;
              const badgeCount = item.href === "/calendar" ? calendarPendingCount : 0;

              return (
                <Link
                  key={item.href}
                  className={`nav-item${isActive ? " nav-item-active" : ""}`}
                  href={item.href}
                >
                  <NavIcon name={item.icon} />
                  <span className="nav-title">{item.title}</span>
                  {badgeCount > 0 ? (
                    <span className="nav-unread-badge">
                      {badgeCount >= 10 ? "10+" : badgeCount}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <nav className="nav-list sidebar-bottom-nav" aria-label="Secondary">
          {user.role === "ADMIN" ? (
            <Link
              className={`nav-item${pathname === "/admin" ? " nav-item-active" : ""}`}
              href="/admin"
            >
              <NavIcon name="setting" />
              <span className="nav-title">Admin Setting</span>
            </Link>
          ) : null}
          {secondaryNavItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                className={`nav-item${isActive ? " nav-item-active" : ""}`}
                href={item.href}
              >
                <NavIcon name={item.icon} />
                <span className="nav-title">{item.title}</span>
              </Link>
            );
          })}
          <form action="/api/auth/logout" method="post">
            <button className="nav-item nav-button" type="submit">
              <NavIcon name="sign-out" />
              <span className="nav-title">Sign out</span>
            </button>
          </form>
        </nav>
      </aside>

      <aside
        aria-hidden={!hasContext}
        className={`context-sidebar${hasContext ? " context-sidebar-open" : ""}`}
      >
        {contextMode === "dm" ? (
          <>
            <div className="context-header">
              <span className="context-label">DM</span>
              <button
                className="context-action"
                onClick={() => {
                  setContextNotice(null);
                  setIsNewDmOpen((current) => !current);
                }}
                type="button"
              >
                New
              </button>
            </div>
            <div className="context-list">
              {displayedDmItems.map((target) => {
                const isActive = selectedDmKey === `${target.kind}:${target.id}`;
                const unreadCount = isActive ? 0 : target.unreadCount;

                return (
                  <Link
                    className={`context-item${isActive ? " context-item-active" : ""}`}
                    href={getDmHref(target)}
                    key={`${target.kind}:${target.id}`}
                    onClick={() => {
                      setContextNotice(null);
                    }}
                  >
                    <span className="context-item-identity">
                      <ProfileAvatar avatar={target.avatar} className="context-avatar" />
                      <span className="context-item-copy">
                        <span className="context-item-topline">
                          <span className="context-item-title">{target.displayName}</span>
                          {unreadCount > 0 ? (
                            <span className="context-unread-badge">
                              {unreadCount >= 10 ? "10+" : unreadCount}
                            </span>
                          ) : null}
                        </span>
                        <span className="context-item-meta">{target.meta}</span>
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
            {isNewDmOpen ? (
              <div className="context-list context-new-list">
                <span className="context-label">Start New DM</span>
                {availableDms.length > 0 ? (
                  availableDms.map((target) => (
                    <Link
                      className="context-item"
                      href={getDmHref(target)}
                      key={`${target.kind}:${target.id}`}
                      onClick={() => {
                        startDm(target);
                      }}
                    >
                      <span className="context-item-identity">
                        <ProfileAvatar avatar={target.avatar} className="context-avatar" />
                        <span className="context-item-copy">
                          <span className="context-item-title">{target.displayName}</span>
                          <span className="context-item-meta">{target.meta}</span>
                        </span>
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="context-notice">No new DM targets.</p>
                )}
              </div>
            ) : null}
          </>
        ) : contextMode === "team" ? (
          <>
            <div className="context-header">
              <span className="context-label">Team Chat</span>
              <button
                className="context-action"
                onClick={() => {
                  openCreateTeamChannelModal();
                }}
                type="button"
              >
                New
              </button>
            </div>
            <div className="context-list">
              {teamChannels.map((channel) => {
                const isActive = selectedChannel === channel.id;

                return (
                  <div
                    className={`context-team-row${isActive ? " context-team-row-active" : ""}`}
                    key={channel.id}
                  >
                    <Link
                      className={`context-item${isActive ? " context-item-active" : ""}`}
                      href={`/team?channel=${encodeURIComponent(channel.id)}`}
                      onClick={() => {
                        setContextNotice(null);
                      }}
                    >
                      <span className="context-item-title">{channel.title}</span>
                    </Link>
                    {channel.title !== "General" ? (
                      <div className="context-team-actions">
                        <button
                          className="context-team-menu-button"
                          onClick={() => {
                            setChannelMenuId((current) =>
                              current === channel.id ? null : channel.id,
                            );
                          }}
                          type="button"
                        >
                          <span />
                          <span />
                          <span />
                        </button>
                        {channelMenuId === channel.id ? (
                          <div className="context-team-menu">
                            <button
                              className="context-team-menu-item"
                              onClick={() => {
                                void openEditTeamChannelModal(channel, "rename");
                              }}
                              type="button"
                            >
                              Edit Channel Name
                            </button>
                            <button
                              className="context-team-menu-item"
                              onClick={() => {
                                void openEditTeamChannelModal(channel, "members");
                              }}
                              type="button"
                            >
                              Add Participants
                            </button>
                            {channel.createdBy === user.id ? (
                              <button
                                className="context-team-menu-item context-team-menu-danger"
                                onClick={() => {
                                  void deleteTeamChannel(channel);
                                }}
                                type="button"
                              >
                                Delete Channel
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
        {contextNotice ? <p className="context-notice">{contextNotice}</p> : null}
      </aside>

      {isTeamChannelModalOpen ? (
        <div
          className="team-modal-backdrop"
          onClick={() => {
            setIsTeamChannelModalOpen(false);
            resetTeamChannelModal();
          }}
        >
          <div
            className="team-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="team-modal-header">
              <h2>
                {teamModalMode === "create"
                  ? "New channel"
                  : teamModalMode === "members"
                    ? "Add participants"
                    : "Edit channel name"}
              </h2>
              <p className="helper-text">
                {teamModalMode === "create"
                  ? "Create a channel and choose exactly who belongs in it."
                  : teamModalMode === "members"
                    ? "Update the people and agents who can access this channel."
                    : "Rename the channel without changing its members."}
              </p>
            </div>
            {teamModalMode !== "members" ? (
              <div className="team-modal-field-grid">
                <label className="split-label">
                  Channel Name
                  <span className="team-modal-input-wrap">
                    <input
                      className="team-modal-input"
                      placeholder="e.g. planning, design review, launch prep"
                      value={teamChannelName}
                      onChange={(event) => {
                        setTeamChannelName(event.target.value);
                      }}
                      type="text"
                    />
                  </span>
                </label>
                <label className="split-label">
                  Purpose
                  <span className="team-modal-input-wrap team-modal-textarea-wrap">
                    <textarea
                      className="team-modal-input team-modal-textarea"
                      placeholder="What is this channel for?"
                      value={teamChannelPurpose}
                      onChange={(event) => {
                        setTeamChannelPurpose(event.target.value);
                      }}
                      rows={2}
                    />
                  </span>
                </label>
              </div>
            ) : null}
            {teamModalMode !== "rename" ? (
              <div className="team-modal-section">
                <span className="context-label">Participants</span>
                <div className="team-invite-list">
                  {participants
                    .filter((member) => !(member.kind === "user" && member.id === user.id))
                    .map((member) => {
                      const memberKey = `${member.kind ?? "user"}:${member.id}`;
                      const checked = teamInviteKeys.includes(memberKey);

                      return (
                        <label
                          className={`team-invite-card${
                            checked ? " team-invite-card-selected" : ""
                          }`}
                          key={memberKey}
                        >
                          <input
                            checked={checked}
                            onChange={(event) => {
                              setTeamInviteKeys((current) =>
                                event.target.checked
                                  ? [...current, memberKey]
                                  : current.filter((item) => item !== memberKey),
                              );
                            }}
                            type="checkbox"
                          />
                          <span className="team-invite-check" aria-hidden="true">
                            {checked ? "✓" : ""}
                          </span>
                          <ProfileAvatar avatar={member.avatar} className="context-avatar" />
                          <span className="team-invite-copy">
                            <span>{member.name}</span>
                            <span className="context-item-meta">{member.meta}</span>
                          </span>
                        </label>
                      );
                    })}
                </div>
              </div>
            ) : null}
            <div className="team-modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setIsTeamChannelModalOpen(false);
                  resetTeamChannelModal();
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  void submitTeamChannelModal();
                }}
                type="button"
              >
                {teamModalMode === "create"
                  ? "Create"
                  : teamModalMode === "members"
                    ? "Save Participants"
                    : "Save Name"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="app-content">{children}</main>
    </div>
  );
}
