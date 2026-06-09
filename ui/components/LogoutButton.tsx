"use client";

import { useRef, useState } from "react";
import { ConfirmModal } from "./ConfirmModal";

export function LogoutButton() {
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [open, setOpen] = useState(false);

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
        onCancel={() => setOpen(false)}
        onConfirm={submitLogout}
      >
        <p>End this session?</p>
      </ConfirmModal>
    </>
  );
}
