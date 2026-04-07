export default function TeamPage() {
  return (
    <section className="page-panel">
      <header className="page-header">
        <div>
          <span className="eyebrow">Team</span>
          <h1>Team collaboration without inventing a separate team agent.</h1>
          <p>
            The room belongs to humans. Each participant uses their own agent in parallel
            and brings outputs back into the team workflow.
          </p>
        </div>
        <span className="pill">Team 03</span>
      </header>

      <div className="team-grid">
        <article className="content-card">
          <h2>Team roster</h2>
          <ul>
            <li>Jiyeon — personal agent active</li>
            <li>Hyungjun — personal agent active</li>
            <li>Minseo — invited</li>
            <li>Daniel — invited</li>
          </ul>
        </article>

        <article className="content-card">
          <h2>Team room</h2>
          <div className="message-list">
            <div className="message-row">
              <div className="message-meta">Jiyeon</div>
              <p>I asked my agent to turn the brief into a milestone list.</p>
            </div>
            <div className="message-row">
              <div className="message-meta">Hyungjun</div>
              <p>Mine extracted open questions and missing dependencies. We can merge them.</p>
            </div>
          </div>
          <div className="inline-actions">
            <button className="primary-button" type="button">
              Post to team room
            </button>
            <button className="secondary-button" type="button">
              Share file
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
