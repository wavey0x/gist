"use client";

import { useRef, useState } from "react";
import { clearOfflineAccountData } from "../lib/offline-library";
import { ConfirmModal } from "./ConfirmModal";

export function LogoutButton() {
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const cleanupCompleteRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function submitLogout() {
    confirmedRef.current = true;
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form
        ref={formRef}
        className="account-logout-form"
        action="/logout"
        method="post"
        onSubmit={(event) => {
          if (!confirmedRef.current) {
            event.preventDefault();
            setOpen(true);
          } else if (!cleanupCompleteRef.current) {
            event.preventDefault();
            setSubmitting(true);
            void clearOfflineAccountData()
              .catch(() => undefined)
              .finally(() => {
                cleanupCompleteRef.current = true;
                formRef.current?.requestSubmit();
              });
          }
        }}
      >
        <button className="account-logout-button" type="submit">
          Log out
        </button>
      </form>
      <ConfirmModal
        open={open}
        title="Log out?"
        confirmLabel="Log out"
        confirming={submitting}
        confirmingLabel="Logging out…"
        onCancel={() => {
          if (!submitting) {
            setOpen(false);
          }
        }}
        onConfirm={submitLogout}
      >
        <p>End this session?</p>
      </ConfirmModal>
    </>
  );
}
