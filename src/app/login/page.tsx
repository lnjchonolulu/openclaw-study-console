import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();

  if (user) {
    redirect("/chat");
  }

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
        <h1>[TBA] Tool Name</h1>

        <form action="/api/auth/login" className="form-grid-single" method="post">
          <label className="split-label">
            Username
            <input autoComplete="username" name="username" type="text" />
          </label>
          <label className="split-label">
            Password
            <input autoComplete="current-password" name="password" type="password" />
          </label>
          {error ? <p className="helper-text login-error">{error}</p> : null}
          <button className="primary-button login-submit" type="submit">
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
