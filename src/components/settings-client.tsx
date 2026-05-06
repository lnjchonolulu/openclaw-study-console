"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import {
  getAgentMeta,
  getUserMeta,
  rotateProfileConfig,
  type ProfileConfig,
} from "@/lib/profile";

export function SettingsClient({
  initialAgentDisplayName,
  initialAgentProfile,
  initialPersonaSummary,
  initialUserDisplayName,
  initialUserProfile,
  username,
}: {
  initialAgentDisplayName: string;
  initialAgentProfile: ProfileConfig;
  initialPersonaSummary: string;
  initialUserDisplayName: string;
  initialUserProfile: ProfileConfig;
  username: string;
}) {
  const router = useRouter();
  const [userDisplayName, setUserDisplayName] = useState(initialUserDisplayName);
  const [agentDisplayName, setAgentDisplayName] = useState(initialAgentDisplayName);
  const [personaSummary, setPersonaSummary] = useState(initialPersonaSummary);
  const [userProfile, setUserProfile] = useState(initialUserProfile);
  const [agentProfile, setAgentProfile] = useState(initialAgentProfile);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setNotice(null);

    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentDisplayName,
        agentProfileConfig: agentProfile,
        personaSummary,
        userDisplayName,
        userProfileConfig: userProfile,
      }),
    });

    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setNotice(payload.error ?? "Settings could not be saved.");
      setIsSaving(false);
      return;
    }

    setNotice("Saved.");
    setIsSaving(false);
    router.refresh();
  }

  return (
    <section className="settings-page">
      <div className="settings-grid">
        <article className="content-card settings-card settings-card-user">
          <div className="settings-card-header">
            <div>
              <span className="context-label">You</span>
              <h2>Profile</h2>
            </div>
          </div>
          <div className="settings-avatar-row">
            <ProfileAvatar
              avatar={{ kind: "user", config: userProfile }}
              className="settings-avatar-preview"
            />
            <div className="settings-avatar-copy">
              <strong>{userDisplayName || username}</strong>
              <span>{getUserMeta(username)}</span>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setUserProfile((current) => rotateProfileConfig(current, username, "user"));
              }}
              type="button"
            >
              Refresh Colors
            </button>
          </div>
          <label className="split-label">
            Nickname
            <span className="team-modal-input-wrap">
              <input
                className="team-modal-input"
                onChange={(event) => {
                  setUserDisplayName(event.target.value);
                }}
                value={userDisplayName}
                type="text"
              />
            </span>
          </label>
        </article>

        <article className="content-card settings-card settings-card-agent">
          <div className="settings-card-header">
            <div>
              <span className="context-label">Agent</span>
              <h2>Identity</h2>
            </div>
          </div>
          <div className="settings-avatar-row">
            <ProfileAvatar
              avatar={{ kind: "agent", config: agentProfile }}
              className="settings-avatar-preview"
            />
            <div className="settings-avatar-copy">
              <strong>{agentDisplayName || `${username}'s agent`}</strong>
              <span>{getAgentMeta(username)}</span>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setAgentProfile((current) =>
                  rotateProfileConfig(current, `${username}-agent`, "agent"),
                );
              }}
              type="button"
            >
              Refresh Colors
            </button>
          </div>
          <label className="split-label">
            Nickname
            <span className="team-modal-input-wrap">
              <input
                className="team-modal-input"
                onChange={(event) => {
                  setAgentDisplayName(event.target.value);
                }}
                value={agentDisplayName}
                type="text"
              />
            </span>
          </label>
          <label className="split-label">
            Persona Summary
            <textarea
              className="settings-textarea"
              onChange={(event) => {
                setPersonaSummary(event.target.value);
              }}
              value={personaSummary}
            />
          </label>
        </article>
      </div>
      <div className="settings-footer">
        {notice ? <p className="helper-text">{notice}</p> : <span />}
        <button
          className="primary-button"
          disabled={isSaving}
          onClick={() => {
            void handleSave();
          }}
          type="button"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </section>
  );
}
