"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type GoogleIntegrationStatus = {
  accountEmail: string | null;
  connected: boolean;
  connectedAt: string | null;
  scopes: string[];
};

const GOOGLE_SLIDES_SCOPE =
  "https://www.googleapis.com/auth/presentations";
const GOOGLE_DOCS_SCOPE =
  "https://www.googleapis.com/auth/documents";
const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

export function AdminSettingsClient({
  initialGoogleIntegration,
}: {
  initialGoogleIntegration: GoogleIntegrationStatus;
}) {
  const router = useRouter();
  const [googleIntegration, setGoogleIntegration] = useState(initialGoogleIntegration);
  const [isDisconnectingGoogle, setIsDisconnectingGoogle] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const hasGoogleWorkspaceAccess = [
    GOOGLE_SLIDES_SCOPE,
    GOOGLE_DOCS_SCOPE,
    GOOGLE_SHEETS_SCOPE,
    GOOGLE_DRIVE_FILE_SCOPE,
  ].every((scope) => googleIntegration.scopes.includes(scope));

  async function handleGoogleDisconnect() {
    setIsDisconnectingGoogle(true);
    setNotice(null);

    const response = await fetch("/api/integrations/google/status", {
      method: "DELETE",
    });

    if (!response.ok) {
      setNotice("Google could not be disconnected.");
      setIsDisconnectingGoogle(false);
      return;
    }

    setGoogleIntegration({
      accountEmail: null,
      connected: false,
      connectedAt: null,
      scopes: [],
    });
    setNotice("Google disconnected.");
    setIsDisconnectingGoogle(false);
    router.refresh();
  }

  return (
    <section className="admin-settings-page">
      <article className="content-card settings-card admin-settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Google Integration</h2>
          </div>
        </div>
        <div className="settings-google-copy">
          <p>
            Connect one shared Google account for CyWorld email and Google
            Workspace actions. Agents may send approved email, create new
            Slides, Docs, and Sheets, edit accessible files, and work with
            review comments.
          </p>
          {googleIntegration.connected ? (
            <p>
              Connected as{" "}
              <strong>{googleIntegration.accountEmail ?? "Google account"}</strong>
            </p>
          ) : (
            <p>Not connected yet.</p>
          )}
          {googleIntegration.connected && !hasGoogleWorkspaceAccess ? (
            <p>
              Reconnect Google once to grant Google Slides, Docs, Sheets, and
              drive.file permissions for file creation and review comments.
            </p>
          ) : null}
          {notice ? <p>{notice}</p> : null}
        </div>
        <div className="settings-inline-actions">
          <span />
          {googleIntegration.connected && hasGoogleWorkspaceAccess ? (
            <button
              className="secondary-button"
              disabled={isDisconnectingGoogle}
              onClick={() => {
                void handleGoogleDisconnect();
              }}
              type="button"
            >
              {isDisconnectingGoogle ? "Disconnecting..." : "Disconnect Google"}
            </button>
          ) : googleIntegration.connected ? (
            <button
              className="primary-button"
              onClick={() => {
                window.location.href = "/api/integrations/google/start";
              }}
              type="button"
            >
              Reconnect Google
            </button>
          ) : (
            <button
              className="primary-button"
              onClick={() => {
                window.location.href = "/api/integrations/google/start";
              }}
              type="button"
            >
              Connect Google
            </button>
          )}
        </div>
      </article>
    </section>
  );
}
