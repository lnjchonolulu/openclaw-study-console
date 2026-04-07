import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ChatClient } from "@/components/chat-client";

export default async function ChatPage() {
  const user = await requireUser();
  const room = await prisma.room.findUnique({
    where: {
      ownerUserId: user.id,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        take: 20,
      },
    },
  });

  const initialMessages =
    room?.messages
      .filter(
        (
          entry,
        ): entry is typeof entry & {
          role: "USER" | "AGENT";
        } => entry.role === "USER" || entry.role === "AGENT",
      )
      .map((entry) => ({
        id: entry.id,
        role: entry.role,
        content: entry.content,
      })) ?? [
      {
        id: "welcome-agent",
        role: "AGENT" as const,
        content:
          "Your OpenClaw-backed personal agent is ready. Ask for a plan, summary, or draft to test the live pipeline.",
      },
    ];

  return (
    <section className="page-panel">
      <header className="page-header">
        <div>
          <span className="eyebrow">Chat</span>
          <h1>Your personal agent lives here.</h1>
          <p>
            The participant should feel like they are talking to one agent, even if the
            backend later routes some work to cheaper internal workers.
          </p>
        </div>
        <span className="pill">
          Agent: {user.agent?.displayName ?? user.agent?.openclawAgentId ?? "Unassigned"}
        </span>
      </header>

      <div className="stats-row">
        <article className="metric-card">
          <span className="metric-label">Current model path</span>
          <strong className="metric-value">MiniMax</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">Session mode</span>
          <strong className="metric-value">Personal</strong>
        </article>
        <article className="metric-card">
          <span className="metric-label">OpenClaw target</span>
          <strong className="metric-value">Local CLI</strong>
        </article>
      </div>

      <div className="chat-grid">
        <ChatClient initialMessages={initialMessages} />

        <aside className="content-card">
          <h2>Implementation notes</h2>
          <ul>
            <li>Store chat messages in Postgres.</li>
            <li>Map the logged-in user to exactly one OpenClaw agent id.</li>
            <li>For now the backend executes `openclaw agent --local` on the same server.</li>
          </ul>
        </aside>
      </div>
    </section>
  );
}
