"use client";

import type { ReactNode } from "react";
import { useEffect, useId } from "react";
import { X } from "lucide-react";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirming?: boolean;
  confirmingLabel?: string;
  confirmTone?: "default" | "danger";
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  confirming = false,
  confirmingLabel,
  confirmTone = "default",
  error,
  onCancel,
  onConfirm
}: ConfirmModalProps) {
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !confirming) {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirming, onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="confirm-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !confirming) {
          onCancel();
        }
      }}
    >
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="confirm-modal-header">
          <h2 className="confirm-modal-title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="icon-button confirm-modal-close"
            aria-label="Close"
            onClick={onCancel}
            disabled={confirming}
          >
            <X aria-hidden="true" size={15} strokeWidth={2} />
          </button>
        </div>

        <div className="confirm-modal-body" id={bodyId}>
          {children}
        </div>

        {error ? (
          <p className="confirm-modal-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-button"
            onClick={onCancel}
            disabled={confirming}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-modal-button ${
              confirmTone === "danger" ? "confirm-modal-confirm-danger" : ""
            }`}
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming && confirmingLabel ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
