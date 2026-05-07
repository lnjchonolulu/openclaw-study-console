"use client";

import { useMemo, useRef, useState } from "react";
import type { WorkspaceFolderView } from "@/lib/files";

function formatTimestamp(isoString: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
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
        onClick={() => {
          setContextMenu(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({
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
          void uploadFiles(droppedFiles);
        }}
      >
        <div className="files-toolbar">
          <div className="files-breadcrumbs" role="navigation" aria-label="Current directory">
            {view.breadcrumbs.map((crumb, index) => (
              <button
                className={`files-crumb${index === view.breadcrumbs.length - 1 ? " files-crumb-active" : ""}`}
                key={crumb.id ?? "root"}
                onClick={() => {
                  void refreshFolder(crumb.id);
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

        <div className="files-desktop">
          {folderEntries.length > 0 || fileEntries.length > 0 ? (
            <div className="files-grid-desktop">
              {folderEntries.map((entry) => (
                <button
                  className="files-item"
                  key={entry.id}
                  onClick={() => {
                    void refreshFolder(entry.id);
                  }}
                  type="button"
                >
                  <FolderIcon />
                  <div className="files-item-copy">
                    <strong>{entry.filename}</strong>
                    <span>
                      Created: {entry.createdByName}, {formatTimestamp(entry.createdAt)}
                    </span>
                    <span>
                      Updated: {entry.updatedByName}, {formatTimestamp(entry.updatedAt)}
                    </span>
                  </div>
                </button>
              ))}
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
                      Created: {entry.createdByName}, {formatTimestamp(entry.createdAt)}
                    </span>
                    <span>
                      Updated: {entry.updatedByName}, {formatTimestamp(entry.updatedAt)}
                    </span>
                    <span>
                      {formatFileSize(entry.sizeBytes)} {entry.mimeType ? `· ${entry.mimeType}` : ""}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          ) : null}

          {!folderEntries.length && !fileEntries.length ? (
            <div className="files-empty-state">
              <strong>This folder is empty.</strong>
              <span>Create a folder or drop files here to get started.</span>
            </div>
          ) : null}
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
            <button
              className="files-context-item"
              onClick={() => {
                setIsCreatingFolder(true);
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
          </div>
        ) : null}

        {isUploading ? <div className="files-upload-indicator">Uploading...</div> : null}
      </div>
    </section>
  );
}
