"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import type { WorkspaceEntry, WorkspaceFolderView } from "@/lib/files";
import type { TeamParticipant } from "@/lib/team";

function formatTimestamp(isoString: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" className="files-item-icon" fill="none" viewBox="0 0 24 24">
      <path
        d="M3.75 7.5h6l1.8 2.25h8.7v6.75a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V7.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M3.75 9.75h16.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function formatSize(sizeBytes: number | null) {
  if (!sizeBytes || sizeBytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function getExtensionLabel(filename: string) {
  const parts = filename.split(".");
  if (parts.length < 2) {
    return "FILE";
  }

  const ext = parts.at(-1)?.trim().toUpperCase() ?? "FILE";
  return ext.slice(0, 6);
}

function TeamMembersIcon() {
  return (
    <svg
      aria-hidden="true"
      className="team-members-icon"
      fill="none"
      viewBox="0 0 20 20"
    >
      <path
        d="M7.75 9.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M13.75 9a2.25 2.25 0 1 0 0-4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M3.75 16v-.6c0-2.12 1.8-3.9 4-3.9s4 1.78 4 3.9v.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M13.25 11.75c1.76.2 3 1.49 3 3.4V16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" className="files-lock-icon" fill="none" viewBox="0 0 20 20">
      <path
        d="M6.5 8V6.6a3.5 3.5 0 1 1 7 0V8m-8 0h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ArrowButton({
  disabled = false,
  direction,
  onClick,
}: {
  disabled?: boolean;
  direction: "down" | "up";
  onClick: () => void;
}) {
  return (
    <button className="files-access-arrow" disabled={disabled} onClick={onClick} type="button">
      <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
        <path
          d={
            direction === "down"
              ? "M4.25 5.5 8 9.25l3.75-3.75"
              : "M4.25 10.5 8 6.75l3.75 3.75"
          }
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
    </button>
  );
}

function AccessParticipantRow({
  canMove = true,
  onMove,
  participant,
  direction,
}: {
  canMove?: boolean;
  direction: "down" | "up";
  onMove: () => void;
  participant: TeamParticipant;
}) {
  return (
    <div className="context-item files-access-row">
      <span className="context-item-identity">
        <ProfileAvatar avatar={participant.avatar} className="context-avatar" />
        <span className="context-item-copy">
          <span className="context-item-title">{participant.name}</span>
          <span className="context-item-meta">{participant.meta}</span>
        </span>
      </span>
      {canMove ? <ArrowButton direction={direction} onClick={onMove} /> : null}
    </div>
  );
}

function ParticipantCheckboxRow({
  checked,
  disabled = false,
  onToggle,
  participant,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  participant: TeamParticipant;
}) {
  return (
    <label
      className={`team-invite-card${checked ? " team-invite-card-selected" : ""}${disabled ? " team-invite-card-disabled" : ""}`}
    >
      <input
        checked={checked}
        disabled={disabled}
        onChange={() => {
          onToggle();
        }}
        type="checkbox"
      />
      <span className="team-invite-check">{checked ? "✓" : ""}</span>
      <ProfileAvatar avatar={participant.avatar} className="context-avatar" />
      <span className="team-invite-copy">
        <span>{participant.name}</span>
        <span>{participant.meta}</span>
      </span>
    </label>
  );
}

function EntryMeta({
  createdByName,
  createdAt,
  updatedByName,
  updatedAt,
}: {
  createdByName: string;
  createdAt: string;
  updatedByName: string;
  updatedAt: string;
}) {
  return (
    <div className="files-item-meta">
      <span>
        Created: {createdByName}, {formatTimestamp(createdAt)}
      </span>
      <span>
        Updated: {updatedByName}, {formatTimestamp(updatedAt)}
      </span>
    </div>
  );
}

type FolderModalProps = {
  allParticipants: TeamParticipant[];
  currentUserKey: string;
  initialName: string;
  initialSelectedKeys: string[];
  onCancel: () => void;
  onSubmit: (payload: { name: string; participantKeys: string[] }) => void;
  showParticipants: boolean;
  title: string;
};

type InfoModalProps = {
  entry: WorkspaceEntry;
  onClose: () => void;
};

function FolderModal({
  allParticipants,
  currentUserKey,
  initialName,
  initialSelectedKeys,
  onCancel,
  onSubmit,
  showParticipants,
  title,
}: FolderModalProps) {
  const [name, setName] = useState(initialName);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    Array.from(new Set([currentUserKey, ...initialSelectedKeys])),
  );

  return (
    <div className="team-modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="content-card team-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="team-modal-header">
          <h2>{title}</h2>
        </div>

        <div className="team-modal-section">
          <label className="split-label">
            Folder Name
            <span className="team-modal-input-wrap">
              <input
                className="team-modal-input settings-input"
                onChange={(event) => {
                  setName(event.target.value);
                }}
                placeholder="Folder name"
                type="text"
                value={name}
              />
            </span>
          </label>
        </div>

        {showParticipants ? (
          <div className="team-modal-section">
            <div className="files-access-header">
              <span className="context-label">Participants</span>
              <button
                className="secondary-button files-select-all"
                onClick={() => {
                  setSelectedKeys([
                    currentUserKey,
                    ...allParticipants
                      .map((participant) => `${participant.kind}:${participant.id}`)
                      .filter((key) => key !== currentUserKey),
                  ]);
                }}
                type="button"
              >
                Select all
              </button>
            </div>
            <div className="context-list team-invite-list">
              {allParticipants.map((participant) => {
                const key = `${participant.kind}:${participant.id}`;
                const checked = selectedKeys.includes(key);
                const isCurrentUser = key === currentUserKey;

                return (
                  <ParticipantCheckboxRow
                    checked={checked}
                    disabled={isCurrentUser}
                    key={key}
                    onToggle={() => {
                      setSelectedKeys((current) => {
                        if (isCurrentUser) {
                          return current;
                        }

                        return current.includes(key)
                          ? current.filter((value) => value !== key)
                          : [...current, key];
                      });
                    }}
                    participant={participant}
                  />
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="team-modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => {
              onSubmit({ name, participantKeys: selectedKeys });
            }}
            type="button"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoModal({ entry, onClose }: InfoModalProps) {
  return (
    <div className="team-modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="File information"
        aria-modal="true"
        className="content-card team-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
        role="dialog"
      >
        <div className="team-modal-header">
          <h2>File Information</h2>
        </div>
        <div className="team-modal-section files-info-grid">
          <div className="files-info-row">
            <span className="context-label">Name</span>
            <strong>{entry.filename}</strong>
          </div>
          <div className="files-info-row">
            <span className="context-label">Type</span>
            <strong>{getExtensionLabel(entry.filename)}</strong>
          </div>
          <div className="files-info-row">
            <span className="context-label">Size</span>
            <strong>{formatSize(entry.sizeBytes)}</strong>
          </div>
          <div className="files-info-row">
            <span className="context-label">Uploaded</span>
            <strong>
              {entry.createdByName}, {formatTimestamp(entry.createdAt)}
            </strong>
          </div>
        </div>
        <div className="team-modal-actions">
          <button className="primary-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

type ContextMenuState =
  | { kind: "background"; x: number; y: number }
  | { entry: WorkspaceEntry; kind: "entry"; x: number; y: number };

function partitionParticipants(
  allParticipants: TeamParticipant[],
  selected: TeamParticipant[],
) {
  const selectedKeys = new Set(
    selected.map((participant) => `${participant.kind}:${participant.id}`),
  );

  return {
    selectedParticipants: selected,
    unselectedParticipants: allParticipants.filter(
      (participant) => !selectedKeys.has(`${participant.kind}:${participant.id}`),
    ),
  };
}

export function FilesClient({ initialView }: { initialView: WorkspaceFolderView }) {
  const [view, setView] = useState(initialView);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isCurrentFolderAccessOpen, setIsCurrentFolderAccessOpen] = useState(false);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [dropBreadcrumbId, setDropBreadcrumbId] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [infoEntry, setInfoEntry] = useState<WorkspaceEntry | null>(null);
  const [modalState, setModalState] = useState<{
    entry?: WorkspaceEntry;
    kind: "create" | "rename";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const folderEntries = useMemo(
    () => view.entries.filter((entry) => entry.isFolder),
    [view.entries],
  );
  const fileEntries = useMemo(
    () => view.entries.filter((entry) => !entry.isFolder),
    [view.entries],
  );

  async function refreshFolder(parentId: string | null) {
    const query = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
    const response = await fetch(`/api/files${query}`);
    const payload = (await response.json()) as WorkspaceFolderView & { error?: string };

    if (!response.ok) {
      setNotice(payload.error ?? "Workspace could not be loaded.");
      return;
    }

    setView(payload);
    setDropBreadcrumbId(null);
    setDropFolderId(null);
  }

  async function uploadFiles(files: File[], replaceExisting = false) {
    if (!files.length) {
      return;
    }

    setIsUploading(true);
    setNotice(null);

    const formData = new FormData();

    files.forEach((file) => {
      formData.append("files", file);
    });

    if (view.currentFolder.id) {
      formData.append("parentId", view.currentFolder.id);
    }

    if (replaceExisting) {
      formData.append("replaceExisting", "true");
    }

    const response = await fetch("/api/files", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json()) as {
      conflicts?: Array<{ existingId: string; filename: string }>;
      error?: string;
    };

    if (response.status === 409 && payload.conflicts?.length) {
      setIsUploading(false);
      const conflictNames = payload.conflicts.map((conflict) => conflict.filename).join(", ");
      const shouldReplace = window.confirm(
        `A file with the same name already exists: ${conflictNames}\n\nReplace the existing file? Choose Cancel to keep the current file and upload again with a different name.`,
      );

      if (shouldReplace) {
        await uploadFiles(files, true);
      }

      return;
    }

    if (!response.ok) {
      setNotice(payload.error ?? "Upload failed.");
      setIsUploading(false);
      return;
    }

    await refreshFolder(view.currentFolder.id);
    setIsUploading(false);
  }

  async function saveFolderModal(payload: {
    name: string;
    participantKeys: string[];
  }) {
    if (!modalState) {
      return;
    }

    setNotice(null);

    if (modalState.kind === "create") {
      const response = await fetch("/api/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: payload.name,
          parentId: view.currentFolder.id,
          participantKeys: payload.participantKeys,
          type: "folder",
        }),
      });

      const responsePayload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setNotice(responsePayload.error ?? "Folder could not be created.");
        return;
      }

      setModalState(null);
      await refreshFolder(view.currentFolder.id);
      return;
    }

    const entry = modalState.entry;

    if (!entry) {
      return;
    }

    const response = await fetch(`/api/files/${encodeURIComponent(entry.id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "rename",
        name: payload.name,
      }),
    });
    const responsePayload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setNotice(responsePayload.error ?? "Folder could not be renamed.");
      return;
    }

    setModalState(null);
    await refreshFolder(view.currentFolder.id);
  }

  async function updateEntryAccess(entry: WorkspaceEntry, participantKeys: string[]) {
    const response = await fetch(`/api/files/${encodeURIComponent(entry.id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "access",
        participantKeys,
      }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setNotice(payload.error ?? "Access could not be updated.");
      return;
    }

    setIsCurrentFolderAccessOpen(true);
    await refreshFolder(view.currentFolder.id);
  }

  async function moveEntry(entryId: string, parentId: string | null) {
    const response = await fetch(`/api/files/${encodeURIComponent(entryId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "move",
        parentId,
      }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setNotice(payload.error ?? "Folder could not be moved.");
      return;
    }

    await refreshFolder(view.currentFolder.id);
  }

  async function deleteFolder(entry: WorkspaceEntry) {
    const shouldDelete = window.confirm(
      `Delete "${entry.filename}"? This will remove the folder and everything inside it.`,
    );

    if (!shouldDelete) {
      return;
    }

    const response = await fetch(`/api/files/${encodeURIComponent(entry.id)}`, {
      method: "DELETE",
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setNotice(payload.error ?? "Folder could not be deleted.");
      return;
    }

    await refreshFolder(view.currentFolder.id);
  }

  const accessLists = partitionParticipants(
    view.participants,
    view.currentFolder.accessParticipants,
  );

  function setFolderDragPreview(event: DragEvent<HTMLElement>, label: string) {
    const preview = document.createElement("div");
    preview.className = "files-drag-preview";
    preview.textContent = label;
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 28, 20);
    window.requestAnimationFrame(() => {
      preview.remove();
    });
  }

  function getDraggedEntryId(event: DragEvent<HTMLElement>) {
    return (
      event.dataTransfer.getData("application/x-openclaw-folder") ||
      event.dataTransfer.getData("application/x-openclaw-entry") ||
      event.dataTransfer.getData("text/plain") ||
      draggingEntryId
    );
  }

  function resetDragState() {
    setIsDragging(false);
    setDropFolderId(null);
    setDropBreadcrumbId(null);
    setDraggingEntryId(null);
  }

  return (
    <section className="chat-page files-page">
      {modalState ? (
        <FolderModal
          allParticipants={view.participants}
          currentUserKey={view.currentUserKey}
          initialName={modalState.entry?.filename ?? ""}
          initialSelectedKeys={
            modalState.kind === "create"
              ? [view.currentUserKey]
              : (modalState.entry?.accessParticipants ?? []).map(
                  (participant) => `${participant.kind}:${participant.id}`,
                )
          }
          onCancel={() => {
            setModalState(null);
          }}
          onSubmit={(payload) => {
            void saveFolderModal(payload);
          }}
          showParticipants={modalState.kind === "create"}
          title={
            modalState.kind === "create"
              ? "Create Folder"
              : modalState.entry?.isFolder
                ? "Rename Folder"
                : "Rename File"
          }
        />
      ) : null}
      {infoEntry ? (
        <InfoModal
          entry={infoEntry}
          onClose={() => {
            setInfoEntry(null);
          }}
        />
      ) : null}

      <div
        className={`chat-panel files-panel${isDragging ? " files-panel-dragging" : ""}`}
        onClick={() => {
          setContextMenu(null);
          setIsCurrentFolderAccessOpen(false);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({
            kind: "background",
            x: event.clientX,
            y: event.clientY,
          });
          setNotice(null);
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) {
            resetDragState();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const destinationFolderId = view.currentFolder.id;
          resetDragState();
          const droppedFiles = Array.from(event.dataTransfer.files);

          if (droppedFiles.length > 0) {
            void uploadFiles(droppedFiles);
            return;
          }

          const draggedEntryId = getDraggedEntryId(event);

          if (draggedEntryId) {
            void moveEntry(draggedEntryId, destinationFolderId);
          }
        }}
      >
        <div className="files-toolbar">
          <div className="files-breadcrumbs" role="navigation" aria-label="Current directory">
            {view.breadcrumbs.map((crumb, index) => (
              <button
                className={`files-crumb${index === view.breadcrumbs.length - 1 ? " files-crumb-active" : ""}${dropBreadcrumbId === (crumb.id ?? "root") ? " files-crumb-drop-target" : ""}`}
                key={crumb.id ?? "root"}
                onClick={() => {
                  if (!crumb.isLocked) {
                    void refreshFolder(crumb.id);
                  }
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (dropBreadcrumbId === (crumb.id ?? "root")) {
                    setDropBreadcrumbId(null);
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropBreadcrumbId(crumb.id ?? "root");
                  setDropFolderId(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const crumbId = crumb.id;
                  resetDragState();
                  const draggedEntryId = getDraggedEntryId(event);

                  if (draggedEntryId) {
                    void moveEntry(draggedEntryId, crumbId);
                  }
                }}
                type="button"
              >
                {index === 0 ? "/home" : crumb.label}
              </button>
            ))}
          </div>
          {view.currentFolder.id ? (
            <div className="files-toolbar-actions">
              <button
                className="team-members-button files-access-button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsCurrentFolderAccessOpen((current) => !current);
                  setContextMenu(null);
                }}
                type="button"
              >
                <TeamMembersIcon />
                <span>{view.currentFolder.accessParticipants.length}</span>
              </button>
              {isCurrentFolderAccessOpen ? (
                <div
                  className="team-members-popover files-access-popover files-access-popover-toolbar"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <span className="context-label">Participants with access</span>
                  <div className="context-list">
                    {accessLists.selectedParticipants.map((participant) => (
                      <AccessParticipantRow
                        canMove={!view.currentFolder.isSystemManaged}
                        direction="down"
                        key={`${participant.kind}:${participant.id}`}
                        onMove={() => {
                          if (!view.currentFolder.isSystemManaged && view.currentFolder.id) {
                            void updateEntryAccess(
                              {
                                accessCount: view.currentFolder.accessParticipants.length,
                                accessParticipants: view.currentFolder.accessParticipants,
                                canAccess: view.currentFolder.canAccess,
                                createdAt: "",
                                createdByName: "",
                                filename: view.currentFolder.label,
                                id: view.currentFolder.id,
                                isFolder: true,
                                isLocked: view.currentFolder.isLocked,
                                isSystemManaged: view.currentFolder.isSystemManaged,
                                mimeType: null,
                                sizeBytes: null,
                                updatedAt: "",
                                updatedByName: "",
                              },
                              accessLists.selectedParticipants
                                .filter(
                                  (selectedParticipant) =>
                                    !(
                                      selectedParticipant.kind === participant.kind &&
                                      selectedParticipant.id === participant.id
                                    ),
                                )
                                .map(
                                  (selectedParticipant) =>
                                    `${selectedParticipant.kind}:${selectedParticipant.id}`,
                                ),
                            );
                          }
                        }}
                        participant={participant}
                      />
                    ))}
                  </div>
                  {!view.currentFolder.isSystemManaged ? (
                    <>
                      <span className="context-label files-access-secondary-label">
                        Add participants
                      </span>
                      <div className="context-list">
                        {accessLists.unselectedParticipants.map((participant) => (
                          <AccessParticipantRow
                            direction="up"
                            key={`${participant.kind}:${participant.id}`}
                            onMove={() => {
                              if (view.currentFolder.id) {
                                void updateEntryAccess(
                                  {
                                    accessCount: view.currentFolder.accessParticipants.length,
                                    accessParticipants: view.currentFolder.accessParticipants,
                                    canAccess: view.currentFolder.canAccess,
                                    createdAt: "",
                                    createdByName: "",
                                    filename: view.currentFolder.label,
                                    id: view.currentFolder.id,
                                    isFolder: true,
                                    isLocked: view.currentFolder.isLocked,
                                    isSystemManaged: view.currentFolder.isSystemManaged,
                                    mimeType: null,
                                    sizeBytes: null,
                                    updatedAt: "",
                                    updatedByName: "",
                                  },
                                  [
                                    ...view.currentFolder.accessParticipants.map(
                                      (selectedParticipant) =>
                                        `${selectedParticipant.kind}:${selectedParticipant.id}`,
                                    ),
                                    `${participant.kind}:${participant.id}`,
                                  ],
                                );
                              }
                            }}
                            participant={participant}
                          />
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <input
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            void uploadFiles(files);
            event.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />

        {notice ? <p className="helper-text">{notice}</p> : null}

        <div className="files-desktop">
          {folderEntries.length > 0 || fileEntries.length > 0 ? (
            <div className="files-sections">
              {folderEntries.length > 0 ? (
                <div className="files-grid-desktop">
                  {folderEntries.map((entry) => (
                    <button
                      className={`files-item${entry.isLocked ? " files-item-locked" : ""}${dropFolderId === entry.id ? " files-item-drop-target" : ""}${draggingEntryId === entry.id ? " files-item-drag-source" : ""}`}
                      draggable={!entry.isSystemManaged && entry.canAccess}
                      key={entry.id}
                      onClick={() => {
                        if (entry.canAccess) {
                          void refreshFolder(entry.id);
                        } else {
                          setNotice("You do not have access to this folder.");
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setContextMenu({
                          entry,
                          kind: "entry",
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      onDragOver={(event) => {
                        if (!entry.canAccess) {
                          return;
                        }

                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropFolderId(entry.id);
                        setDropBreadcrumbId(null);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        if (dropFolderId === entry.id) {
                          setDropFolderId(null);
                        }
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-openclaw-folder", entry.id);
                        event.dataTransfer.setData("application/x-openclaw-entry", entry.id);
                        event.dataTransfer.setData("text/plain", entry.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingEntryId(entry.id);
                        setFolderDragPreview(event, entry.filename);
                      }}
                      onDragEnd={() => {
                        resetDragState();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const draggedEntryId = getDraggedEntryId(event);

                        if (draggedEntryId && draggedEntryId !== entry.id && entry.canAccess) {
                          resetDragState();
                          void moveEntry(draggedEntryId, entry.id);
                        }
                      }}
                      type="button"
                    >
                      {!entry.canAccess ? (
                        <div className="files-item-status">
                          <LockIcon />
                        </div>
                      ) : null}
                      <div className="files-item-head">
                        <FolderIcon />
                        <strong>{entry.filename}</strong>
                      </div>
                      <EntryMeta
                        createdAt={entry.createdAt}
                        createdByName={entry.createdByName}
                        updatedAt={entry.updatedAt}
                        updatedByName={entry.updatedByName}
                      />
                    </button>
                  ))}
                </div>
              ) : null}

              {fileEntries.length > 0 ? (
                <div className="files-grid-desktop files-grid-desktop-files">
                  {fileEntries.map((entry) => (
                    <button
                      className={`files-item files-item-file${draggingEntryId === entry.id ? " files-item-drag-source" : ""}`}
                      key={entry.id}
                      onClick={() => {
                        window.location.assign(`/api/files/${encodeURIComponent(entry.id)}`);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setContextMenu({
                          entry,
                          kind: "entry",
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-openclaw-entry", entry.id);
                        event.dataTransfer.setData("text/plain", entry.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingEntryId(entry.id);
                        setFolderDragPreview(event, entry.filename);
                      }}
                      onDragEnd={() => {
                        resetDragState();
                      }}
                      type="button"
                    >
                      <div className="files-file-badge">.{getExtensionLabel(entry.filename)}</div>
                      <div className="files-file-copy">
                        <strong>{entry.filename}</strong>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="files-empty-state">
              <strong>This folder is empty.</strong>
              <span>Create a folder or drop files here to get started.</span>
            </div>
          )}
        </div>

        {contextMenu ? (
          <div
            className="files-context-menu"
            onClick={(event) => {
              event.stopPropagation();
            }}
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            {contextMenu.kind === "background" ? (
              <>
                <button
                  className="files-context-item"
                  onClick={() => {
                    setModalState({ kind: "create" });
                    setContextMenu(null);
                  }}
                  type="button"
                >
                  New Folder
                </button>
                <button
                  className="files-context-item"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setContextMenu(null);
                  }}
                  type="button"
                >
                  Upload File
                </button>
              </>
            ) : (
              <>
                <button
                  className="files-context-item"
                  disabled={contextMenu.entry.isSystemManaged}
                  onClick={() => {
                    setModalState({
                      entry: contextMenu.entry,
                      kind: "rename",
                    });
                    setContextMenu(null);
                  }}
                  type="button"
                >
                  {contextMenu.entry.isFolder ? "Rename Folder" : "Rename File"}
                </button>
                {contextMenu.entry.isFolder ? (
                  <button
                    className="files-context-item"
                    disabled={contextMenu.entry.isSystemManaged}
                    onClick={() => {
                      void deleteFolder(contextMenu.entry);
                      setContextMenu(null);
                    }}
                    type="button"
                  >
                    Delete Folder
                  </button>
                ) : (
                  <button
                    className="files-context-item"
                    onClick={() => {
                      setInfoEntry(contextMenu.entry);
                      setContextMenu(null);
                    }}
                    type="button"
                  >
                    Information
                  </button>
                )}
              </>
            )}
          </div>
        ) : null}

        {isUploading ? <div className="files-upload-indicator">Uploading...</div> : null}
      </div>
    </section>
  );
}
