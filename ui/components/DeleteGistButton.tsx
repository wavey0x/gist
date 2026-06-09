"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmModal } from "./ConfirmModal";

type DeleteGistButtonProps = {
  gistId: string;
  gistTitle: string;
};

export function DeleteGistButton({ gistId, gistTitle }: DeleteGistButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeModal() {
    if (!deleting) {
      setOpen(false);
    }
  }

  async function deleteGist() {
    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/me/gists/${encodeURIComponent(gistId)}`, {
        method: "DELETE"
      });

      if (response.status === 204) {
        setOpen(false);
        router.refresh();
        return;
      }

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (response.status === 403) {
        setError("This API key cannot delete gists.");
      } else if (response.status === 404) {
        setError("This gist could not be deleted.");
        router.refresh();
      } else {
        setError("Delete is unavailable right now.");
      }
    } catch {
      setError("Delete is unavailable right now.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="icon-button gist-delete-button"
        aria-label={`Delete ${gistTitle}`}
        title="Delete"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" size={16} strokeWidth={1.9} />
      </button>
      <ConfirmModal
        open={open}
        title="Delete gist?"
        confirmLabel="Delete"
        confirmingLabel="Deleting..."
        confirming={deleting}
        confirmTone="danger"
        error={error}
        onCancel={closeModal}
        onConfirm={deleteGist}
      >
        <p>Delete &quot;{gistTitle}&quot;?</p>
      </ConfirmModal>
    </>
  );
}
