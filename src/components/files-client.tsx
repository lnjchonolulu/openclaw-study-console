"use client";

import { useMemo, useRef, useState } from "react";
import type { WorkspaceFolderView } from "@/lib/files";

function formatTimestamp(isoString: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function formatFileSize(sizeBytes: number | null) {
  if (!sizeBytes) {
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

export function FilesClient({ initialView }: { initialView: WorkspaceFolderView }) {
  const [view, setView] = useState(initialView);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
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

    if (!response.ok) {
      setNotice("Workspace could not be loaded.");
      return;
    }

    const payload = (await response.json()) as WorkspaceFolderView;
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

  async function handleCreateFolder() {
    const trimmedName = newFolderName.trim();

    if (!trimmedName) {
      setNotice("Folder name is required.");
      return;
    }

    setNotice(null);

    const response = await fetch("/api/files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "folder",
        name: trimmedName,
        parentId: view.currentFolder.id,
      }),
    });

    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setNotice(payload.error ?? "Folder could not be created.");
      return;
    }

    setIsCreatingFolder(false);
    setNewFolderName("");
    await refreshFolder(view.currentFolder.id);
  }

  return (
    <section className="chat-page files-page">
      <div
        className={`chat-panel files-panel${isDragging ? " files-panel-dragging" : ""}`}
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
          void uploadFiles(droppedFiles);
        }}
      >
        <div className="files-toolbar">
          <div className="files-breadcrumbs">
            {view.breadcrumbs.map((crumb, index) => (
              <button
                className={`files-crumb${index === view.breadcrumbs.length - 1 ? " files-crumb-active" : ""}`}
                key={crumb.id ?? "root"}
                onClick={() => {
                  void refreshFolder(crumb.id);
                }}
                type="button"
              >
                {crumb.label}
              </button>
            ))}
          </div>
          <div className="files-toolbar-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setIsCreatingFolder((current) => !current);
                setNotice(null);
              }}
              type="button"
            >
              New Folder
            </button>
            <button
              className="primary-button"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              type="button"
            >
              Upload
            </button>
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
          </div>
        </div>

        {isCreatingFolder ? (
          <div className="files-create-row">
            <span className="settings-input-wrap">
              <input
                autoFocus
                className="settings-input"
                onChange={(event) => {
                  setNewFolderName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateFolder();
                  }
                }}
                placeholder="Folder name"
                type="text"
                value={newFolderName}
              />
            </span>
            <button
              className="primary-button"
              onClick={() => {
                void handleCreateFolder();
              }}
              type="button"
            >
              Create
            </button>
          </div>
        ) : null}

        {notice ? <p className="helper-text">{notice}</p> : null}

        <div className="files-drop-hint">
          <strong>Shared workspace</strong>
          <span>Drag files anywhere in this panel to upload into the current folder.</span>
          {isUploading ? <span>Uploading...</span> : null}
        </div>

        <div className="files-desktop">
          {folderEntries.length > 0 ? (
            <section className="files-section">
              <div className="files-section-label">Folders</div>
              <div className="files-grid-desktop">
                {folderEntries.map((entry) => (
                  <button
                    className="files-item"
                    key={entry.id}
                    onDoubleClick={() => {
                      void refreshFolder(entry.id);
                    }}
                    onClick={() => {
                      setNotice("Double-click a folder to open it.");
                    }}
                    type="button"
                  >
                    <FolderIcon />
                    <div className="files-item-copy">
                      <strong>{entry.filename}</strong>
                      <span>Updated {formatTimestamp(entry.updatedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {fileEntries.length > 0 ? (
            <section className="files-section">
              <div className="files-section-label">Files</div>
              <div className="files-grid-desktop">
                {fileEntries.map((entry) => (
                  <a
                    className="files-item"
                    href={`/api/files/${encodeURIComponent(entry.id)}`}
                    key={entry.id}
                  >
                    <FileIcon />
                    <div className="files-item-copy">
                      <strong>{entry.filename}</strong>
                      <span>
                        {formatFileSize(entry.sizeBytes)} · {formatTimestamp(entry.updatedAt)}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {!folderEntries.length && !fileEntries.length ? (
            <div className="files-empty-state">
              <strong>This folder is empty.</strong>
              <span>Create a folder or drop files here to get started.</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
