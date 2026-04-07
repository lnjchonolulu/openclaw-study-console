export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error =
    params.error === "credentials"
      ? "Username or password did not match."
      : params.error === "invalid"
        ? "Please enter both a username and a password."
        : null;

  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">Study-only access</span>
        <div>
          <h1>Log in with the account created for your study group.</h1>
          <p>
            No Google, no personal email linking. The admin creates usernames and assigns
            each participant to a personal OpenClaw agent.
          </p>
        </div>

        <form action="/api/auth/login" className="form-grid-single" method="post">
          <label className="split-label">
            Username
            <input name="username" type="text" placeholder="team03-user02" />
          </label>
          <label className="split-label">
            Password
            <input name="password" type="password" placeholder="Enter your study password" />
          </label>
          {error ? <p className="helper-text">{error}</p> : null}
          <div className="inline-actions">
            <button className="primary-button" type="submit">
              Sign in
            </button>
          </div>
        </form>

        <p className="helper-text">
          MVP note: password reset can stay admin-only at first. That keeps auth simple
          and avoids email infrastructure.
        </p>
      </section>
    </main>
  );
}
