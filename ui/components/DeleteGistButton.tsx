"use client";

import { Trash2 } from "lucide-react";

type DeleteGistButtonProps = {
  gistTitle: string;
};

export function DeleteGistButton({ gistTitle }: DeleteGistButtonProps) {
  return (
    <button
      type="submit"
      className="icon-button gist-delete-button"
      aria-label={`Delete ${gistTitle}`}
      title="Delete"
      onClick={(event) => {
        if (!window.confirm(`Delete "${gistTitle}"?`)) {
          event.preventDefault();
        }
      }}
    >
      <Trash2 aria-hidden="true" size={16} strokeWidth={1.9} />
    </button>
  );
}
