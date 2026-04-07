import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-page">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">OpenClaw Study Console</p>
          <h1>One web app for personal agents, shared files, and team work.</h1>
          <p className="hero-text">
            This MVP sits in front of the OpenClaw gateway running on your Hetzner VPS.
            Participants log in with study-only accounts and interact with their own agent
            without touching the admin dashboard.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/login">
              Enter Study Console
            </Link>
            <Link className="secondary-button" href="/chat">
              View App Shell
            </Link>
          </div>
        </div>

        <div className="hero-panel">
          <div className="hero-panel-header">
            <span className="status-dot" />
            Hetzner Single-Server MVP
          </div>
          <ul className="hero-list">
            <li>Study-only usernames and passwords</li>
            <li>One personal agent per participant</li>
            <li>Team spaces without a separate team agent</li>
            <li>OpenClaw on the same VPS as the web app and database</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
