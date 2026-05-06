"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  autonomyOptions,
  challengeOptions,
  commitmentOptions,
  contextOptions,
  formalityOptions,
  levelOptions,
  normalizeAgentBehaviorConfig,
  ownerContextOptions,
  representOptions,
  toneOptions,
  type AgentBehaviorConfig,
  warmthOptions,
  workStyleOptions,
} from "@/lib/agent-behavior";
import { ProfileAvatar } from "@/components/profile-avatar";
import {
  getAgentMeta,
  getUserMeta,
  rotateProfileConfig,
  type ProfileConfig,
} from "@/lib/profile";

function RefreshIcon() {
  return (
    <svg
      aria-hidden="true"
      className="settings-refresh-icon"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M15.75 6.75V3.5m0 0H12.5m3.25 0-2.1 2.1a6 6 0 1 0 1.27 6.58"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function SelectField<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  value: T;
}) {
  return (
    <label className="split-label settings-select-field">
      {label}
      <span className="settings-select-wrap">
        <select
          className="settings-select"
          onChange={(event) => {
            onChange(event.target.value as T);
          }}
          value={value}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          className="settings-select-icon"
          fill="none"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M5.5 7.75 10 12.25l4.5-4.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      </span>
    </label>
  );
}

function SettingsSection({
  children,
  eyebrow,
  helper,
}: {
  children: ReactNode;
  eyebrow?: string;
  helper?: string;
}) {
  return (
    <section className="settings-section-block">
      <div className="settings-section-header">
        {eyebrow ? <span className="context-label">{eyebrow}</span> : null}
        {helper ? <p>{helper}</p> : null}
      </div>
      <div className="settings-fields-grid">{children}</div>
    </section>
  );
}

export function SettingsClient({
  initialAgentDisplayName,
  initialAgentProfile,
  initialBehaviorConfig,
  initialPersonaSummary,
  initialUserDisplayName,
  initialUserProfile,
  username,
}: {
  initialAgentDisplayName: string;
  initialAgentProfile: ProfileConfig;
  initialBehaviorConfig: AgentBehaviorConfig;
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
  const [behaviorConfig, setBehaviorConfig] = useState(
    normalizeAgentBehaviorConfig(initialBehaviorConfig),
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  function patchResponseStyle<K extends keyof AgentBehaviorConfig["responseStyle"]>(
    key: K,
    value: AgentBehaviorConfig["responseStyle"][K],
  ) {
    setBehaviorConfig((current) => ({
      ...current,
      responseStyle: {
        ...current.responseStyle,
        [key]: value,
      },
    }));
  }

  function patchDirectLine<K extends keyof AgentBehaviorConfig["directLine"]>(
    key: K,
    value: AgentBehaviorConfig["directLine"][K],
  ) {
    setBehaviorConfig((current) => ({
      ...current,
      directLine: {
        ...current.directLine,
        [key]: value,
      },
    }));
  }

  function patchSharedSpaces<K extends keyof AgentBehaviorConfig["sharedSpaces"]>(
    key: K,
    value: AgentBehaviorConfig["sharedSpaces"][K],
  ) {
    setBehaviorConfig((current) => ({
      ...current,
      sharedSpaces: {
        ...current.sharedSpaces,
        [key]: value,
      },
    }));
  }

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
        behaviorConfig,
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

  async function handlePasswordUpdate() {
    setIsUpdatingPassword(true);
    setPasswordNotice(null);

    const response = await fetch("/api/settings/password", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirmPassword,
        currentPassword,
        nextPassword,
      }),
    });

    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setPasswordNotice(payload.error ?? "Password could not be updated.");
      setIsUpdatingPassword(false);
      return;
    }

    setCurrentPassword("");
    setNextPassword("");
    setConfirmPassword("");
    setPasswordNotice("Password updated.");
    setIsUpdatingPassword(false);
  }

  return (
    <section className="settings-page">
      <div className="settings-grid">
        <div className="settings-user-column">
          <article className="content-card settings-card settings-card-user settings-card-profile">
            <div className="settings-card-header">
              <div>
                <h2>User Profile</h2>
              </div>
            </div>
            <div className="settings-avatar-row">
              <div className="settings-avatar-stack">
                <ProfileAvatar
                  avatar={{ kind: "user", config: userProfile }}
                  className="settings-avatar-preview"
                />
                <button
                  aria-label="Refresh user colors"
                  className="settings-avatar-action"
                  onClick={() => {
                    setUserProfile((current) => rotateProfileConfig(current, username, "user"));
                  }}
                  type="button"
                >
                  <RefreshIcon />
                </button>
              </div>
              <div className="settings-avatar-copy">
                <strong>{userDisplayName || username}</strong>
                <span>{getUserMeta(username)}</span>
              </div>
            </div>
            <label className="split-label">
              Nickname
              <span className="settings-input-wrap">
                <input
                  className="settings-input"
                  onChange={(event) => {
                    setUserDisplayName(event.target.value);
                  }}
                  value={userDisplayName}
                  type="text"
                />
              </span>
            </label>
          </article>

          <article className="content-card settings-card settings-card-user">
            <div className="settings-card-header">
              <div>
                <h2>Account</h2>
              </div>
            </div>
            <div className="settings-fields-grid settings-fields-grid-single">
              <label className="split-label settings-field-span-2">
                Current Password
                <span className="settings-input-wrap">
                  <input
                    className="settings-input"
                    onChange={(event) => {
                      setCurrentPassword(event.target.value);
                    }}
                    type="password"
                    value={currentPassword}
                  />
                </span>
              </label>
              <label className="split-label settings-field-span-2">
                New Password
                <span className="settings-input-wrap">
                  <input
                    className="settings-input"
                    onChange={(event) => {
                      setNextPassword(event.target.value);
                    }}
                    type="password"
                    value={nextPassword}
                  />
                </span>
              </label>
              <label className="split-label settings-field-span-2">
                Confirm New Password
                <span className="settings-input-wrap">
                  <input
                    className="settings-input"
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                    }}
                    type="password"
                    value={confirmPassword}
                  />
                </span>
              </label>
            </div>
            <div className="settings-inline-actions">
              {passwordNotice ? <p className="helper-text">{passwordNotice}</p> : <span />}
              <button
                className="secondary-button"
                disabled={isUpdatingPassword}
                onClick={() => {
                  void handlePasswordUpdate();
                }}
                type="button"
              >
                {isUpdatingPassword ? "Updating..." : "Change Password"}
              </button>
            </div>
          </article>
        </div>

        <article className="content-card settings-card settings-card-agent">
          <div className="settings-agent-top">
            <div className="settings-card-header">
              <div>
                <h2>Agent Training</h2>
              </div>
            </div>
            <div className="settings-avatar-row">
              <div className="settings-avatar-stack">
                <ProfileAvatar
                  avatar={{ kind: "agent", config: agentProfile }}
                  className="settings-avatar-preview"
                />
                <button
                  aria-label="Refresh agent colors"
                  className="settings-avatar-action"
                  onClick={() => {
                    setAgentProfile((current) =>
                      rotateProfileConfig(current, `${username}-agent`, "agent"),
                    );
                  }}
                  type="button"
                >
                  <RefreshIcon />
                </button>
              </div>
              <div className="settings-avatar-copy">
                <strong>{agentDisplayName || `${username}'s agent`}</strong>
                <span>{getAgentMeta(username)}</span>
              </div>
            </div>
          </div>

          <div className="settings-agent-scroll">
            <SettingsSection
              eyebrow="Core Identity"
              helper="This is the stable identity layer: how the agent presents itself before channel-specific rules kick in."
            >
              <label className="split-label settings-field-span-2">
                Nickname
                <span className="settings-input-wrap">
                  <input
                    className="settings-input"
                    onChange={(event) => {
                      setAgentDisplayName(event.target.value);
                    }}
                    value={agentDisplayName}
                    type="text"
                  />
                </span>
              </label>
              <label className="split-label settings-field-span-2">
                Persona Summary
                <textarea
                  className="settings-textarea settings-textarea-compact settings-textarea-field"
                  onChange={(event) => {
                    setPersonaSummary(event.target.value);
                  }}
                  placeholder="A short baseline description of the agent's personality and role."
                  value={personaSummary}
                />
              </label>
            </SettingsSection>

            <SettingsSection
              eyebrow="Work Mode"
              helper="These settings shape the default response style across all conversations."
            >
              <SelectField
                label="Tone"
                onChange={(value) => {
                  patchResponseStyle("tone", value);
                }}
                options={toneOptions}
                value={behaviorConfig.responseStyle.tone}
              />
              <SelectField
                label="Initiative"
                onChange={(value) => {
                  patchResponseStyle("initiative", value);
                }}
                options={levelOptions}
                value={behaviorConfig.responseStyle.initiative}
              />
              <SelectField
                label="Explanation Depth"
                onChange={(value) => {
                  patchResponseStyle("explanationDepth", value);
                }}
                options={levelOptions}
                value={behaviorConfig.responseStyle.explanationDepth}
              />
              <SelectField
                label="Work Style"
                onChange={(value) => {
                  patchResponseStyle("workStyle", value);
                }}
                options={workStyleOptions}
                value={behaviorConfig.responseStyle.workStyle}
              />
              <SelectField
                label="Caution Level"
                onChange={(value) => {
                  patchResponseStyle("cautionLevel", value);
                }}
                options={levelOptions}
                value={behaviorConfig.responseStyle.cautionLevel}
              />
            </SettingsSection>

            <SettingsSection
              eyebrow="Personality : When it Talks to You"
              helper="Use this for one-to-one conversations with the owner of the agent."
            >
              <SelectField
                label="Warmth"
                onChange={(value) => {
                  patchDirectLine("warmth", value);
                }}
                options={warmthOptions}
                value={behaviorConfig.directLine.warmth}
              />
              <SelectField
                label="Challenge Level"
                onChange={(value) => {
                  patchDirectLine("challengeLevel", value);
                }}
                options={challengeOptions}
                value={behaviorConfig.directLine.challengeLevel}
              />
              <SelectField
                label="Context Assumption"
                onChange={(value) => {
                  patchDirectLine("contextAssumption", value);
                }}
                options={contextOptions}
                value={behaviorConfig.directLine.contextAssumption}
              />
              <SelectField
                label="Autonomy"
                onChange={(value) => {
                  patchDirectLine("autonomy", value);
                }}
                options={autonomyOptions}
                value={behaviorConfig.directLine.autonomy}
              />
              <label className="split-label settings-field-span-2">
                Extra Instructions
                <textarea
                  className="settings-textarea settings-textarea-compact settings-textarea-field"
                  onChange={(event) => {
                    patchDirectLine("extraInstructions", event.target.value);
                  }}
                  placeholder="Anything special about how this agent should talk with you."
                  value={behaviorConfig.directLine.extraInstructions}
                />
              </label>
            </SettingsSection>

            <SettingsSection
              eyebrow="Personality : When It Talks Elsewhere"
              helper="Use this for team channels, public collaboration, and conversations with people other than the owner."
            >
              <SelectField
                label="Formality"
                onChange={(value) => {
                  patchSharedSpaces("formality", value);
                }}
                options={formalityOptions}
                value={behaviorConfig.sharedSpaces.formality}
              />
              <SelectField
                label="Represent You"
                onChange={(value) => {
                  patchSharedSpaces("representOwner", value);
                }}
                options={representOptions}
                value={behaviorConfig.sharedSpaces.representOwner}
              />
              <SelectField
                label="Reveal Your Context"
                onChange={(value) => {
                  patchSharedSpaces("revealOwnerContext", value);
                }}
                options={ownerContextOptions}
                value={behaviorConfig.sharedSpaces.revealOwnerContext}
              />
              <SelectField
                label="Assertiveness"
                onChange={(value) => {
                  patchSharedSpaces("assertiveness", value);
                }}
                options={levelOptions}
                value={behaviorConfig.sharedSpaces.assertiveness}
              />
              <SelectField
                label="Make Commitments"
                onChange={(value) => {
                  patchSharedSpaces("commitmentPolicy", value);
                }}
                options={commitmentOptions}
                value={behaviorConfig.sharedSpaces.commitmentPolicy}
              />
              <label className="split-label settings-field-span-2">
                Extra Instructions
                <textarea
                  className="settings-textarea settings-textarea-compact settings-textarea-field"
                  onChange={(event) => {
                    patchSharedSpaces("extraInstructions", event.target.value);
                  }}
                  placeholder="Anything special about how this agent should behave around other people."
                  value={behaviorConfig.sharedSpaces.extraInstructions}
                />
              </label>
            </SettingsSection>
          </div>
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
