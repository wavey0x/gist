import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AlertSettings } from "../../components/AlertSettings";
import { ApiKeyCopyButton } from "../../components/ApiKeyCopyButton";
import { LocalTimestamp } from "../../components/LocalTimestamp";
import { LogoutButton } from "../../components/LogoutButton";
import { OfflineLibrarySettings } from "../../components/OfflineLibrarySettings";
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
    <main className="auth-shell settings-shell" aria-label="Settings">
      <Link className="settings-back" href="/">
        <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.8} />
        Home
      </Link>
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
            <ApiKeyCopyButton />
          </div>
        </div>
      </header>

      <section className="account-sections" aria-label="Settings">
        <details className="account-section">
          <summary className="account-section-summary">Offline and alerts</summary>
          <div className="account-section-body">
            <OfflineLibrarySettings />
            <AlertSettings initialSettings={notificationSettings} />
          </div>
        </details>

        <details className="account-section">
          <summary className="account-section-summary">Stats</summary>
          <div className="account-section-body">
            <dl className="account-stats">
              <div className="account-stat">
                <dt>Gists</dt>
                <dd>{payload.stats.gist_count}</dd>
              </div>
              <div className="account-stat">
                <dt>Revisions</dt>
                <dd>{payload.stats.revision_count}</dd>
              </div>
              <div className="account-stat">
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
          </div>
        </details>

        <details className="account-section">
          <summary className="account-section-summary">Export</summary>
          <div className="account-section-body account-export">
            {payload.stats.gist_count > 0 ? (
              <>
                <p>Markdown files with a JSON manifest.</p>
                <a
                  className="account-export-button"
                  href="/api/me/gists/export"
                  download
                >
                  Download ZIP
                </a>
              </>
            ) : (
              <p>No gists to export.</p>
            )}
          </div>
        </details>
      </section>
    </main>
  );
}
