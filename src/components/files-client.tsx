"use client";

import { useMemo, useRef, useState } from "react";
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

function FileIcon() {
  return (
    <svg aria-hidden="true" className="files-item-icon" fill="none" viewBox="0 0 24 24">
      <path
        d="M7.25 4.75h6l3.5 3.5v10a2 2 0 0 1-2 2h-7.5a2 2 0 0 1-2-2v-11.5a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M13.25 4.75v3.5h3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
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
  direction,
  onClick,
}: {
  direction: "down" | "up";
  onClick: () => void;
}) {
  return (
    <button className="files-access-arrow" onClick={onClick} type="button">
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
  onMove,
  participant,
  direction,
}: {
  direction: "down" | "up";
  onMove: () => void;
  participant: TeamParticipant;
}) {
  return (
    <div className="context-item">
      <span className="context-item-identity">
        <ProfileAvatar avatar={participant.avatar} className="context-avatar" />
        <span className="context-item-copy">
          <span className="context-item-title">{participant.name}</span>
          <span className="context-item-meta">{participant.meta}</span>
        </span>
      </span>
      <ArrowButton direction={direction} onClick={onMove} />
    </div>
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
  initialName: string;
  initialSelectedKeys: string[];
  onCancel: () => void;
  onSubmit: (payload: { name: string; participantKeys: string[] }) => void;
  showParticipants: boolean;
  title: string;
};

function FolderModal({
  allParticipants,
  initialName,
  initialSelectedKeys,
  onCancel,
  onSubmit,
  showParticipants,
  title,
}: FolderModalProps) {
  const [name, setName] = useState(initialName);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initialSelectedKeys);

  const selectedParticipants = allParticipants.filter((participant) =>
    selectedKeys.includes(`${participant.kind}:${participant.id}`),
  );
  const unselectedParticipants = allParticipants.filter(
    (participant) => !selectedKeys.includes(`${participant.kind}:${participant.id}`),
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
          <>
            <div className="team-modal-section">
              <div className="files-access-header">
                <span className="context-label">Participants with access</span>
                <button
                  className="secondary-button files-select-all"
                  onClick={() => {
                    setSelectedKeys(
                      allParticipants.map(
                        (participant) => `${participant.kind}:${participant.id}`,
                      ),
                    );
                  }}
                  type="button"
                >
                  Select all
                </button>
              </div>
              <div className="context-list team-invite-list">
                {selectedParticipants.map((participant) => (
                  <AccessParticipantRow
                    direction="down"
                    key={`${participant.kind}:${participant.id}`}
                    onMove={() => {
                      setSelectedKeys((current) =>
                        current.filter(
                          (key) => key !== `${participant.kind}:${participant.id}`,
                        ),
                      );
                    }}
                    participant={participant}
                  />
                ))}
              </div>
            </div>

            <div className="team-modal-section">
              <span className="context-label">Add participants</span>
              <div className="context-list team-invite-list">
                {unselectedParticipants.map((participant) => (
                  <AccessParticipantRow
                    direction="up"
                    key={`${participant.kind}:${participant.id}`}
                    onMove={() => {
                      setSelectedKeys((current) => [
                        ...current,
                        `${participant.kind}:${participant.id}`,
                      ]);
                    }}
                    participant={participant}
                  />
                ))}
              </div>
            </div>
          </>
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
  const [activeAccessEntryId, setActiveAccessEntryId] = useState<string | null>(null);
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
  }

  async function uploadFiles(files: File[]) {
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

    const response = await fetch("/api/files", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json()) as { error?: string };

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

  const activeAccessEntry = folderEntries.find(
    (entry) => entry.id === activeAccessEntryId,
  );
  const accessLists = activeAccessEntry
    ? partitionParticipants(view.participants, activeAccessEntry.accessParticipants)
    : null;

  return (
    <section className="chat-page files-page">
      {modalState ? (
        <FolderModal
          allParticipants={view.participants}
          initialName={modalState.entry?.filename ?? ""}
          initialSelectedKeys={
            modalState.kind === "create"
              ? view.participants.map(
                  (participant) => `${participant.kind}:${participant.id}`,
                )
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
          title={modalState.kind === "create" ? "Create Folder" : "Rename Folder"}
        />
      ) : null}

      <div
        className={`chat-panel files-panel${isDragging ? " files-panel-dragging" : ""}`}
        onClick={() => {
          setContextMenu(null);
          setActiveAccessEntryId(null);
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
            setIsDragging(false);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const droppedFiles = Array.from(event.dataTransfer.files);

          if (droppedFiles.length > 0) {
            void uploadFiles(droppedFiles);
            return;
          }

          const draggedEntryId = event.dataTransfer.getData("application/x-openclaw-folder");

          if (draggedEntryId) {
            void moveEntry(draggedEntryId, view.currentFolder.id);
          }
        }}
      >
        <div className="files-toolbar">
          <div className="files-breadcrumbs" role="navigation" aria-label="Current directory">
            {view.breadcrumbs.map((crumb, index) => (
              <button
                className={`files-crumb${index === view.breadcrumbs.length - 1 ? " files-crumb-active" : ""}`}
                key={crumb.id ?? "root"}
                onClick={() => {
                  if (!crumb.isLocked) {
                    void refreshFolder(crumb.id);
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedEntryId = event.dataTransfer.getData("application/x-openclaw-folder");

                  if (draggedEntryId) {
                    void moveEntry(draggedEntryId, crumb.id);
                  }
                }}
                type="button"
              >
                {index === 0 ? "/home" : crumb.label}
              </button>
            ))}
          </div>
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
            <div className="files-grid-desktop">
              {folderEntries.map((entry) => (
                <button
                  className={`files-item${entry.isLocked ? " files-item-locked" : ""}`}
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
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/x-openclaw-folder", entry.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const draggedEntryId = event.dataTransfer.getData("application/x-openclaw-folder");

                    if (draggedEntryId && draggedEntryId !== entry.id && entry.canAccess) {
                      void moveEntry(draggedEntryId, entry.id);
                    }
                  }}
                  type="button"
                >
                  {view.currentFolder.id ? (
                    <div className="files-item-access-wrap">
                      {!entry.canAccess ? <LockIcon /> : null}
                      {entry.filename !== "Personals" ? (
                        <button
                          className="team-members-button files-access-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveAccessEntryId((current) =>
                              current === entry.id ? null : entry.id,
                            );
                            setContextMenu(null);
                          }}
                          type="button"
                        >
                          <TeamMembersIcon />
                          <span>{entry.accessCount}</span>
                        </button>
                      ) : null}
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
                  {activeAccessEntryId === entry.id && accessLists ? (
                    <div
                      className="team-members-popover files-access-popover"
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                    >
                      <span className="context-label">Participants with access</span>
                      <div className="context-list">
                        {accessLists.selectedParticipants.map((participant) => (
                          <AccessParticipantRow
                            direction="down"
                            key={`${participant.kind}:${participant.id}`}
                            onMove={() => {
                              if (!activeAccessEntry?.isSystemManaged) {
                                void updateEntryAccess(
                                  entry,
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
                      {!entry.isSystemManaged && entry.canAccess ? (
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
                                  void updateEntryAccess(entry, [
                                    ...entry.accessParticipants.map(
                                      (selectedParticipant) =>
                                        `${selectedParticipant.kind}:${selectedParticipant.id}`,
                                    ),
                                    `${participant.kind}:${participant.id}`,
                                  ]);
                                }}
                                participant={participant}
                              />
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              ))}

              {fileEntries.map((entry) => (
                <a
                  className="files-item"
                  href={`/api/files/${encodeURIComponent(entry.id)}`}
                  key={entry.id}
                >
                  <div className="files-item-head">
                    <FileIcon />
                    <strong>{entry.filename}</strong>
                  </div>
                  <EntryMeta
                    createdAt={entry.createdAt}
                    createdByName={entry.createdByName}
                    updatedAt={entry.updatedAt}
                    updatedByName={entry.updatedByName}
                  />
                </a>
              ))}
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
                  Rename Folder
                </button>
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
              </>
            )}
          </div>
        ) : null}

        {isUploading ? <div className="files-upload-indicator">Uploading...</div> : null}
      </div>
    </section>
  );
}
