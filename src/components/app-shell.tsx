"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { appNavItems } from "@/lib/navigation";

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: {
    displayName: string;
    username: string;
    teamName: string | null;
  };
}) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="eyebrow">Study Console</span>
          <h1 className="brand-title">OpenClaw Study Console</h1>
          <p>
            Participants log in with study-only accounts and interact with one personal
            agent each.
          </p>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {appNavItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                className={`nav-item${isActive ? " nav-item-active" : ""}`}
                href={item.href}
              >
                <span className="nav-title">{item.title}</span>
                <span className="nav-description">{item.description}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <span className="pill">MVP scope</span>
          <ul>
            <li>Hetzner single-server deployment</li>
            <li>OpenClaw gateway on the same host</li>
            <li>Study-only usernames and passwords</li>
          </ul>
        </div>

        <div className="sidebar-card">
          <span className="pill">Current agent model</span>
          <p>MiniMax now, Claude later for the user-facing chat layer if needed.</p>
        </div>

        <div className="sidebar-card">
          <span className="pill">{user.displayName}</span>
          <p>{user.username}</p>
          <p>{user.teamName ? `Assigned to ${user.teamName}` : "No team assigned yet"}</p>
          <form action="/api/auth/logout" method="post">
            <button className="secondary-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="app-content">{children}</main>
    </div>
  );
}
