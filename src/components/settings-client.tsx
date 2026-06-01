"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import {
  calendarSharingOptions,
  type CalendarSharingPolicy,
} from "@/lib/agent-behavior";
import {
  getAgentMeta,
  getUserMeta,
  rotateProfileConfig,
  type ProfileConfig,
} from "@/lib/profile";
import { timeZoneOptions } from "@/lib/timezone";

const AVATAR_CROP_SIZE = 160;
const AVATAR_VIEWPORT_SIZE = 248;

type CropModalProps = {
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
  source: string;
};

type CropState = {
  baseScale: number;
  naturalHeight: number;
  naturalWidth: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
};

type SettingsClientProps = {
  agentId: string;
  initialAgentDisplayName: string;
  initialAgentProfile: ProfileConfig;
  initialCalendarSharingPolicy: CalendarSharingPolicy;
  initialGoogleIntegration: GoogleIntegrationStatus;
  initialHeartbeatEnabled: boolean;
  initialIdentityMd: string;
  initialSoulMd: string;
  initialUserDisplayName: string;
  initialUserMd: string;
  initialUserProfile: ProfileConfig;
  initialUserTimezone: string;
  username: string;
};

type GoogleIntegrationStatus = {
  accountEmail: string | null;
  connected: boolean;
  connectedAt: string | null;
  scopes: string[];
};

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="settings-refresh-icon"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 13.75V5.5m0 0L6.75 8.75M10 5.5l3.25 3.25M4.75 14.5v.75a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="settings-refresh-icon"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 4.75h6m-7.25 2.5h8.5l-.6 8.03a1 1 0 0 1-1 .92H7.35a1 1 0 0 1-1-.92l-.6-8.03Zm2 0V5.8a1 1 0 0 1 1-1h2.5a1 1 0 0 1 1 1v1.45m-3 3.25v3.5m3-3.5v3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

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

function clampOffset(offset: number, renderedSize: number) {
  if (renderedSize <= AVATAR_VIEWPORT_SIZE) {
    return (AVATAR_VIEWPORT_SIZE - renderedSize) / 2;
  }

  const min = AVATAR_VIEWPORT_SIZE - renderedSize;
  const max = 0;

  return Math.min(max, Math.max(min, offset));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("File could not be read."));
    };

    reader.onerror = () => {
      reject(new Error("File could not be read."));
    };

    reader.readAsDataURL(file);
  });
}

function buildInitialCropState(image: HTMLImageElement): CropState {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const baseScale = Math.max(
    AVATAR_VIEWPORT_SIZE / naturalWidth,
    AVATAR_VIEWPORT_SIZE / naturalHeight,
  );
  const renderedWidth = naturalWidth * baseScale;
  const renderedHeight = naturalHeight * baseScale;

  return {
    baseScale,
    naturalHeight,
    naturalWidth,
    offsetX: (AVATAR_VIEWPORT_SIZE - renderedWidth) / 2,
    offsetY: (AVATAR_VIEWPORT_SIZE - renderedHeight) / 2,
    zoom: 1,
  };
}

function AvatarCropModal({ onCancel, onConfirm, source }: CropModalProps) {
  const [crop, setCrop] = useState<CropState | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [dragState, setDragState] = useState<{
    originX: number;
    originY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [onCancel]);

  function getRenderedSize(nextCrop: CropState) {
    return {
      height: nextCrop.naturalHeight * nextCrop.baseScale * nextCrop.zoom,
      width: nextCrop.naturalWidth * nextCrop.baseScale * nextCrop.zoom,
    };
  }

  function handleZoomChange(nextZoomValue: number) {
    setCrop((current) => {
      if (!current) {
        return current;
      }

      const previousSize = getRenderedSize(current);
      const centerX = current.offsetX + previousSize.width / 2;
      const centerY = current.offsetY + previousSize.height / 2;
      const nextCrop = {
        ...current,
        zoom: nextZoomValue,
      };
      const nextSize = getRenderedSize(nextCrop);

      return {
        ...nextCrop,
        offsetX: clampOffset(centerX - nextSize.width / 2, nextSize.width),
        offsetY: clampOffset(centerY - nextSize.height / 2, nextSize.height),
      };
    });
  }

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!crop || !dragState) {
      return;
    }

    const size = getRenderedSize(crop);
    const nextOffsetX = clampOffset(
      dragState.startOffsetX + (event.clientX - dragState.originX),
      size.width,
    );
    const nextOffsetY = clampOffset(
      dragState.startOffsetY + (event.clientY - dragState.originY),
      size.height,
    );

    setCrop((current) =>
      current
        ? {
            ...current,
            offsetX: nextOffsetX,
            offsetY: nextOffsetY,
          }
        : current,
    );
  }, [crop, dragState]);

  function stopDragging() {
    setDragState(null);
  }

  useEffect(() => {
    if (!dragState) {
      return;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
    };
  }, [dragState, handlePointerMove]);

  async function handleConfirm() {
    if (!crop || !imageRef.current) {
      return;
    }

    setIsExporting(true);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_CROP_SIZE;
    canvas.height = AVATAR_CROP_SIZE;
    const context = canvas.getContext("2d");

    if (!context) {
      setIsExporting(false);
      return;
    }

    const scale = AVATAR_CROP_SIZE / AVATAR_VIEWPORT_SIZE;
    const renderedWidth = crop.naturalWidth * crop.baseScale * crop.zoom;
    const renderedHeight = crop.naturalHeight * crop.baseScale * crop.zoom;

    context.drawImage(
      imageRef.current,
      crop.offsetX * scale,
      crop.offsetY * scale,
      renderedWidth * scale,
      renderedHeight * scale,
    );

    onConfirm(canvas.toDataURL("image/jpeg", 0.82));
    setIsExporting(false);
  }

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!crop) {
      return;
    }

    event.preventDefault();
    setDragState({
      originX: event.clientX,
      originY: event.clientY,
      startOffsetX: crop.offsetX,
      startOffsetY: crop.offsetY,
    });
  }

  const renderedWidth = crop
    ? crop.naturalWidth * crop.baseScale * crop.zoom
    : 0;
  const renderedHeight = crop
    ? crop.naturalHeight * crop.baseScale * crop.zoom
    : 0;

  return (
    <div
      className="settings-modal-backdrop"
      onClick={() => {
        onCancel();
      }}
      role="presentation"
    >
      <div
        className="content-card settings-modal-card"
        onClick={(event) => {
          event.stopPropagation();
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Crop profile photo"
      >
        <div className="settings-modal-header">
          <div>
            <h3>Crop Profile Photo</h3>
            <p>Drag to reposition and zoom until it sits right in the circle.</p>
          </div>
        </div>

        <div className="settings-crop-shell">
          <div
            className="settings-crop-viewport"
            onPointerDown={handleViewportPointerDown}
            role="presentation"
          >
            <div className="settings-crop-mask" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              className="settings-crop-image"
              onLoad={(event) => {
                imageRef.current = event.currentTarget;
                setCrop(buildInitialCropState(event.currentTarget));
              }}
              draggable={false}
              src={source}
              style={
                crop
                  ? {
                      height: `${renderedHeight}px`,
                      left: `${crop.offsetX}px`,
                      top: `${crop.offsetY}px`,
                      width: `${renderedWidth}px`,
                    }
                  : undefined
              }
            />
          </div>

          <label className="split-label settings-field-span-2">
            Zoom
            <input
              className="settings-range"
              max="3"
              min="1"
              onChange={(event) => {
                handleZoomChange(Number(event.target.value));
              }}
              step="0.01"
              type="range"
              value={crop?.zoom ?? 1}
            />
          </label>
        </div>

        <div className="settings-modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!crop || isExporting}
            onClick={() => {
              void handleConfirm();
            }}
            type="button"
          >
            {isExporting ? "Saving..." : "Use Photo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function extractMarkdownField(source: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(`- \\*\\*${escapedLabel}:\\*\\*\\s*(.+)$`, "m"),
  );
  return match?.[1]?.trim() || null;
}

function replaceMarkdownField(source: string, label: string, value: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalized = value.trim();

  if (
    new RegExp(`- \\*\\*${escapedLabel}:\\*\\*\\s*(.+)$`, "m").test(source)
  ) {
    return source.replace(
      new RegExp(`(- \\*\\*${escapedLabel}:\\*\\*\\s*)(.+)$`, "m"),
      `$1${normalized}`,
    );
  }

  const line = `- **${label}:** ${normalized}`;
  const trimmed = source.trimEnd();

  if (!trimmed) {
    return `${line}\n`;
  }

  const firstBreak = trimmed.indexOf("\n");

  if (firstBreak === -1) {
    return `${trimmed}\n${line}\n`;
  }

  return `${trimmed.slice(0, firstBreak + 1)}${line}\n${trimmed.slice(firstBreak + 1)}\n`;
}

function MarkdownEditor({
  helper,
  label,
  onChange,
  value,
}: {
  helper?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <section className="settings-section-block">
      <div className="settings-section-header">
        <span className="context-label">{label}</span>
        {helper ? <p>{helper}</p> : null}
      </div>
      <textarea
        className="settings-textarea settings-textarea-field settings-markdown-editor"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        spellCheck={false}
        value={value}
      />
    </section>
  );
}

export function SettingsClient({
  agentId,
  initialAgentDisplayName,
  initialAgentProfile,
  initialCalendarSharingPolicy,
  initialGoogleIntegration,
  initialHeartbeatEnabled,
  initialIdentityMd,
  initialSoulMd,
  initialUserDisplayName,
  initialUserMd,
  initialUserProfile,
  initialUserTimezone,
  username,
}: SettingsClientProps) {
  const router = useRouter();
  const userFileInputRef = useRef<HTMLInputElement | null>(null);
  const [userDisplayName, setUserDisplayName] = useState(initialUserDisplayName);
  const [userTimezone, setUserTimezone] = useState(initialUserTimezone);
  const [agentDisplayName, setAgentDisplayName] = useState(initialAgentDisplayName);
  const [userMd, setUserMd] = useState(initialUserMd);
  const [identityMd, setIdentityMd] = useState(initialIdentityMd);
  const [soulMd, setSoulMd] = useState(initialSoulMd);
  const [calendarSharingPolicy, setCalendarSharingPolicy] = useState(
    initialCalendarSharingPolicy,
  );
  const [googleIntegration, setGoogleIntegration] = useState(initialGoogleIntegration);
  const [isDisconnectingGoogle, setIsDisconnectingGoogle] = useState(false);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(initialHeartbeatEnabled);
  const [userProfile, setUserProfile] = useState(initialUserProfile);
  const [agentProfile, setAgentProfile] = useState(initialAgentProfile);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);

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
        agentId,
        agentProfileConfig: agentProfile,
        calendarSharingPolicy,
        heartbeatEnabled,
        identityMd,
        soulMd,
        userDisplayName,
        userMd,
        userProfileConfig: userProfile,
        userTimezone,
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

  async function handleUserPhotoSelection(file: File | null) {
    if (!file) {
      return;
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setNotice("Please upload a JPG or PNG image.");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCropSource(dataUrl);
      setNotice(null);
    } catch {
      setNotice("That image could not be loaded.");
    }
  }

  const hasUserPhoto = Boolean(userProfile.imageDataUrl || userProfile.imageUrl);

  return (
    <section className="settings-page">
      {cropSource ? (
        <AvatarCropModal
          onCancel={() => {
            setCropSource(null);
            if (userFileInputRef.current) {
              userFileInputRef.current.value = "";
            }
          }}
          onConfirm={(dataUrl) => {
            setUserProfile((current) => ({
              ...current,
              imageDataUrl: dataUrl,
              imageUrl: null,
            }));
            setCropSource(null);
            if (userFileInputRef.current) {
              userFileInputRef.current.value = "";
            }
          }}
          source={cropSource}
        />
      ) : null}

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
                  aria-label="Upload profile photo"
                  className="settings-avatar-action settings-avatar-action-left"
                  onClick={() => {
                    userFileInputRef.current?.click();
                  }}
                  type="button"
                >
                  <UploadIcon />
                </button>
                <button
                  aria-label={hasUserPhoto ? "Delete profile photo" : "Refresh user colors"}
                  className="settings-avatar-action"
                  onClick={() => {
                    if (hasUserPhoto) {
                      const shouldDelete = window.confirm(
                        "Delete this profile photo and go back to the silhouette avatar?",
                      );

                      if (!shouldDelete) {
                        return;
                      }

                      setUserProfile((current) => ({
                        ...current,
                        imageDataUrl: null,
                        imageUrl: null,
                      }));
                      return;
                    }

                    setUserProfile((current) =>
                      rotateProfileConfig(current, username, "user"),
                    );
                  }}
                  type="button"
                >
                  {hasUserPhoto ? <TrashIcon /> : <RefreshIcon />}
                </button>
                <input
                  accept="image/jpeg,image/png"
                  className="settings-file-input"
                  onChange={(event) => {
                    const [file] = Array.from(event.target.files ?? []);
                    void handleUserPhotoSelection(file ?? null);
                  }}
                  ref={userFileInputRef}
                  type="file"
                />
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
                    const nextValue = event.target.value;
                    setUserDisplayName(nextValue);
                    setUserMd((current) =>
                      replaceMarkdownField(current, "Name", nextValue || username),
                    );
                  }}
                  type="text"
                  value={userDisplayName}
                />
              </span>
            </label>
            <label className="split-label">
              Timezone
              <span className="settings-select-wrap">
                <select
                  className="settings-select"
                  onChange={(event) => {
                    setUserTimezone(event.target.value);
                  }}
                  value={userTimezone}
                >
                  {timeZoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="settings-select-icon">⌄</span>
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

          <article className="content-card settings-card settings-card-user">
            <div className="settings-card-header">
              <div>
                <h2>Google Integration</h2>
              </div>
            </div>
            <div className="settings-google-copy">
              <p>
                Connect one shared Google account for CyWorld Calendar mirroring
                and shared Gmail sending.
              </p>
              {googleIntegration.connected ? (
                <p>
                  Connected as{" "}
                  <strong>{googleIntegration.accountEmail ?? "Google account"}</strong>
                </p>
              ) : (
                <p>Not connected yet.</p>
              )}
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
            <MarkdownEditor
              helper="This is the user-facing source file for how the agent understands its human owner."
              label="USER.md"
              onChange={(nextValue) => {
                setUserMd(nextValue);
                const nextName = extractMarkdownField(nextValue, "Name");
                if (nextName) {
                  setUserDisplayName(nextName);
                }
              }}
              value={userMd}
            />

            <MarkdownEditor
              helper="This is the agent's identity layer: name, creature, vibe, and related self-description."
              label="IDENTITY.md"
              onChange={(nextValue) => {
                setIdentityMd(nextValue);
                const nextName = extractMarkdownField(nextValue, "Name");
                if (nextName) {
                  setAgentDisplayName(nextName);
                }
              }}
              value={identityMd}
            />

            <MarkdownEditor
              helper="This is the deeper behavioral source file the agent reads when shaping how it works."
              label="SOUL.md"
              onChange={setSoulMd}
              value={soulMd}
            />

            <section className="settings-section-block">
              <div className="settings-section-header">
                <span className="context-label">Proactiveness</span>
                <p>
                  When heartbeat is enabled, this agent wakes up every three
                  hours and checks on its own whether there is anything it
                  needs to do.
                </p>
              </div>
              <div className="settings-toggle-row">
                <button
                  aria-pressed={heartbeatEnabled}
                  className={`settings-toggle ${heartbeatEnabled ? "settings-toggle-on" : ""}`}
                  onClick={() => {
                    setHeartbeatEnabled((current) => !current);
                  }}
                  type="button"
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>
            </section>

            <section className="settings-section-block">
              <div className="settings-section-header">
                <span className="context-label">Calendar Sharing</span>
                <p>
                  Choose when your agent can share your CyWorld Calendar details
                  with other users.
                </p>
              </div>
              <div className="settings-field-span-2 settings-select-control">
                <span className="settings-select-wrap">
                  <select
                    className="settings-select"
                    onChange={(event) => {
                      setCalendarSharingPolicy(
                        event.target.value as CalendarSharingPolicy,
                      );
                    }}
                    value={calendarSharingPolicy}
                  >
                    {calendarSharingOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="settings-select-icon">⌄</span>
                </span>
              </div>
            </section>
          </div>
        </article>
      </div>

      <div className="settings-footer">
        {isSaving ? (
          <p className="helper-text helper-text-status">Saving changes...</p>
        ) : notice ? (
          <p className="helper-text">{notice}</p>
        ) : (
          <span />
        )}
        <button
          aria-busy={isSaving}
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
