export default function AgentPage() {
  return (
    <section className="page-panel">
      <header className="page-header">
        <div>
          <span className="eyebrow">Agent</span>
          <h1>Agent settings should edit the soul without exposing raw internals.</h1>
          <p>
            The first version can treat this as a structured form that later renders into
            the participant&apos;s `SOUL.md` and related OpenClaw bootstrap files.
          </p>
        </div>
      </header>

      <div className="form-grid">
        <article className="content-card">
          <h2>Persona controls</h2>
          <label className="split-label">
            Agent display name
            <input type="text" defaultValue="Hyungjun Agent" />
          </label>
          <label className="split-label">
            Response style
            <select defaultValue="concise">
              <option value="concise">Concise</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label className="split-label">
            Persona summary
            <textarea defaultValue="Calm, analytical, practical, and slightly opinionated." />
          </label>
        </article>

        <article className="content-card">
          <h2>How this should work later</h2>
          <ul>
            <li>Persist structured settings in Postgres.</li>
            <li>Generate `SOUL.md` from a template plus user choices.</li>
            <li>Keep language and safety rules in shared agent instructions.</li>
          </ul>
          <div className="inline-actions">
            <button className="primary-button" type="button">
              Save agent settings
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
