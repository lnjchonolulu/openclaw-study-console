"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type GoogleIntegrationStatus = {
  accountEmail: string | null;
  connected: boolean;
  connectedAt: string | null;
  scopes: string[];
};

export function AdminSettingsClient({
  initialGoogleIntegration,
}: {
  initialGoogleIntegration: GoogleIntegrationStatus;
}) {
  const router = useRouter();
  const [googleIntegration, setGoogleIntegration] = useState(initialGoogleIntegration);
  const [isDisconnectingGoogle, setIsDisconnectingGoogle] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
            Connect one shared Google account for CyWorld email sending. Agents
            may send email through this shared account when the CyWorld email tool
            is used.
          </p>
          {googleIntegration.connected ? (
            <p>
              Connected as{" "}
              <strong>{googleIntegration.accountEmail ?? "Google account"}</strong>
            </p>
          ) : (
            <p>Not connected yet.</p>
          )}
          {notice ? <p>{notice}</p> : null}
        </div>
        <div className="settings-inline-actions">
          <span />
          {googleIntegration.connected ? (
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
