import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { AlertSettings } from "../../components/AlertSettings";
import { ApiKeyCopyButton } from "../../components/ApiKeyCopyButton";
import { LocalTimestamp } from "../../components/LocalTimestamp";
import { LogoutButton } from "../../components/LogoutButton";
import { OfflineLibrarySettings } from "../../components/OfflineLibrarySettings";
import { SettingsRefresh } from "../../components/SettingsRefresh";
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
    <main className="auth-shell settings-shell" aria-labelledby="settings-title">
      <SettingsRefresh />
      <h1 className="settings-title" id="settings-title">
        Settings
      </h1>

      <section className="settings-card" aria-label="Account">
        <div className="settings-row">
          {session.avatar_url ? (
            <img
              className="account-avatar"
              src={session.avatar_url}
              alt=""
              width={32}
              height={32}
            />
          ) : null}
          <div className="settings-row-text">
            <span className="account-name">{session.name}</span>
          </div>
          <LogoutButton />
        </div>
        <ApiKeyCopyButton />
      </section>

      <OfflineLibrarySettings />
      <AlertSettings initialSettings={notificationSettings} />

      <section className="settings-group" aria-labelledby="settings-gists-title">
        <h2 className="settings-group-label" id="settings-gists-title">
          Your gists
        </h2>
        <div className="settings-card">
          <dl className="settings-stats">
            <div className="settings-stat">
              <dt>Gists</dt>
              <dd>{payload.stats.gist_count.toLocaleString("en-US")}</dd>
            </div>
            <div className="settings-stat">
              <dt>Revisions</dt>
              <dd>{payload.stats.revision_count.toLocaleString("en-US")}</dd>
            </div>
            <div className="settings-stat">
              <dt>Last update</dt>
              <dd>
                {payload.stats.last_updated_at ? (
                  <LocalTimestamp
                    value={payload.stats.last_updated_at}
                    variant="compact"
                  />
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Export</span>
              <span className="settings-row-note">
                {payload.stats.gist_count > 0
                  ? "A ZIP of Markdown files with a JSON manifest."
                  : "No gists to export."}
              </span>
            </div>
            {payload.stats.gist_count > 0 ? (
              <a
                className="settings-button"
                href="/api/me/gists/export"
                download
              >
                <Download aria-hidden="true" size={15} strokeWidth={1.8} />
                Download
              </a>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
