"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryNavItems, secondaryNavItems } from "@/lib/navigation";

export function AppShell({
  children,
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
        <div className="sidebar-main">
          <div className="brand-row">
            <h1 className="brand-title">TBA: Tool Name</h1>
            <form action="/api/auth/logout" method="post">
              <button className="text-button" type="submit">
                Sign out
              </button>
            </form>
          </div>

          <nav className="nav-list" aria-label="Primary">
            {primaryNavItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  className={`nav-item${isActive ? " nav-item-active" : ""}`}
                  href={item.href}
                >
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
                <span className="nav-title">{item.title}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="app-content">{children}</main>
    </div>
  );
}
