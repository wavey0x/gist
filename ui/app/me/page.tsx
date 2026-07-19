import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertSettings } from "../../components/AlertSettings";
import { ApiKeyCopyButton } from "../../components/ApiKeyCopyButton";
import { OwnedGistList } from "../../components/GistHistory";
import { LogoutButton } from "../../components/LogoutButton";
import {
  fetchCurrentSession,
  fetchMyGists,
  fetchNotificationSettings
} from "../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Settings - Wavey Gist"
};

export default async function MePage() {
  const session = await fetchCurrentSession();
  if (!session) {
    redirect("/login");
  }
  const [payload, notificationSettings] = await Promise.all([
    fetchMyGists(),
    fetchNotificationSettings()
  ]);
  if (!payload || !notificationSettings) {
    redirect("/login");
  }

  return (
    <main className="auth-shell settings-shell" aria-label="Account settings">
      <header className="settings-page-header">
        <div className="account-profile">
          <div className="account-identity">
            {session.avatar_url ? (
              <img
                className="account-avatar"
                src={session.avatar_url}
                alt=""
                width={28}
                height={28}
              />
            ) : null}
            <span className="account-name">{session.name}</span>
          </div>
          <div className="account-actions">
            <LogoutButton />
            <span className="account-action-separator" aria-hidden="true">
              |
            </span>
            <ApiKeyCopyButton apiKey={session.key} />
          </div>
        </div>
      </header>

      <section
        className="settings-panel"
        aria-labelledby="alert-settings-title"
      >
        <AlertSettings initialSettings={notificationSettings} />
      </section>

      <section
        className="owned-gists-section"
        aria-labelledby="owned-gists-title"
      >
        <div className="owned-gists-heading">
          <h2 id="owned-gists-title">My gists</h2>
          <p>Gists published by this account.</p>
        </div>
        <OwnedGistList myGists={payload.gists} />
      </section>
    </main>
  );
}
