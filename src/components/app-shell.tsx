"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { primaryNavItems, secondaryNavItems } from "@/lib/navigation";

type IconName = "dm" | "team" | "files" | "setting" | "sign-out";

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dm: (
      <>
        <path d="M4.75 5.75h14.5v10.5H9l-4.25 3.5v-14Z" />
      </>
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
  children,
  dmTargets,
  user,
}: {
  children: React.ReactNode;
  dmTargets: Array<{
    agentId: string;
    displayName: string;
    isOwnAgent: boolean;
  }>;
  user: {
    agentId: string | null;
    displayName: string;
    username: string;
    teamName: string | null;
  };
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [contextNotice, setContextNotice] = useState<string | null>(null);
  const contextMode =
    pathname === "/chat" ? "dm" : pathname === "/team" ? "team" : null;
  const selectedAgentId = searchParams.get("agent") ?? user.agentId;
  const selectedChannel = searchParams.get("channel") ?? "main";
  const teamChannels = [
    { id: "main", title: user.teamName ?? "Team 03", meta: "Main channel" },
    { id: "research", title: "Research", meta: "Draft channel" },
    { id: "outputs", title: "Outputs", meta: "Draft channel" },
  ];

  return (
    <div className={`app-shell${contextMode ? " app-shell-with-context" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-main">
          <nav className="nav-list" aria-label="Primary">
            {primaryNavItems.map((item) => {
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
          </nav>
        </div>

        <nav className="nav-list sidebar-bottom-nav" aria-label="Secondary">
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

      {contextMode ? (
        <aside className="context-sidebar">
          {contextMode === "dm" ? (
            <>
              <div className="context-header">
                <span className="context-label">DM</span>
                <button
                  className="context-action"
                  onClick={() => {
                    setContextNotice("New DM creation is coming next.");
                  }}
                  type="button"
                >
                  New
                </button>
              </div>
              <div className="context-list">
                {dmTargets.map((target) => {
                  const isActive = selectedAgentId === target.agentId;

                  return (
                    <Link
                      className={`context-item${
                        isActive ? " context-item-active" : ""
                      }`}
                      href={`/chat?agent=${encodeURIComponent(target.agentId)}`}
                      key={target.agentId}
                      onClick={() => {
                        setContextNotice(null);
                      }}
                    >
                      <span className="context-item-title">{target.displayName}</span>
                      <span className="context-item-meta">
                        {target.isOwnAgent ? "Personal agent" : "Shared agent"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="context-header">
                <span className="context-label">Team Chat</span>
                <button
                  className="context-action"
                  onClick={() => {
                    setContextNotice("Channel creation is coming next.");
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
                    <Link
                      className={`context-item${
                        isActive ? " context-item-active" : ""
                      }`}
                      href={`/team?channel=${encodeURIComponent(channel.id)}`}
                      key={channel.id}
                      onClick={() => {
                        setContextNotice(null);
                      }}
                    >
                      <span className="context-item-title">{channel.title}</span>
                      <span className="context-item-meta">{channel.meta}</span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
          {contextNotice ? <p className="context-notice">{contextNotice}</p> : null}
        </aside>
      ) : null}

      <main className="app-content">{children}</main>
    </div>
  );
}
