"use client";

import { useState } from "react";

type MessageAttachment = {
  filename: string;
  id: string;
  kind: "image";
  mimeType: string;
  size: number;
  url: string;
};

function attachmentUrl(url: string) {
  if (url.startsWith("/uploads/chat/")) {
    return url.replace("/uploads/chat/", "/api/chat-attachments/");
  }

  return url;
}

export function MessageAttachments({
  attachments,
}: {
  attachments: MessageAttachment[];
}) {
  const [selectedAttachment, setSelectedAttachment] =
    useState<MessageAttachment | null>(null);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div className="message-attachments">
        {attachments.map((attachment) => (
          <button
            className="message-attachment"
            key={attachment.id}
            onClick={() => setSelectedAttachment(attachment)}
            type="button"
          >
            <img alt={attachment.filename} src={attachmentUrl(attachment.url)} />
          </button>
        ))}
      </div>

      {selectedAttachment ? (
        <div
          aria-label="Image preview"
          className="image-preview-backdrop"
          onClick={() => setSelectedAttachment(null)}
          role="dialog"
        >
          <div
            className="image-preview-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="image-preview-header">
              <div className="image-preview-title">
                {selectedAttachment.filename}
              </div>
              <button
                aria-label="Close image preview"
                className="image-preview-close"
                onClick={() => setSelectedAttachment(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="image-preview-body">
              <img
                alt={selectedAttachment.filename}
                src={attachmentUrl(selectedAttachment.url)}
              />
            </div>
            <div className="image-preview-actions">
              <a
                className="image-preview-download"
                download={selectedAttachment.filename}
                href={`${attachmentUrl(selectedAttachment.url)}?download=1`}
              >
                Download
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
