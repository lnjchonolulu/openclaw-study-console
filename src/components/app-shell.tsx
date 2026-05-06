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
          <h1 className="brand-title">TBA: Tool Name</h1>
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
