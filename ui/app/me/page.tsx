import type { Metadata } from "next";
import { AlertSettings } from "../../components/AlertSettings";
import { ApiKeyCopyButton } from "../../components/ApiKeyCopyButton";
import { LogoutButton } from "../../components/LogoutButton";
import { MeGistTabs } from "../../components/MeGistTabs";
import {
  fetchCurrentSession,
  fetchMyGists,
  fetchNotificationSettings
} from "../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Your gists - Wavey Gist"
};

export default async function MePage() {
  const session = await fetchCurrentSession();
  const [payload, notificationSettings] = session
    ? await Promise.all([fetchMyGists(), fetchNotificationSettings()])
    : [null, null];
  const activeSession = payload && notificationSettings ? session : null;

  return (
    <main className="auth-shell" aria-label="Your gists">
      {activeSession ? (
        <section className="account-panel" aria-label="Account">
          <div className="account-profile">
            <div className="account-identity">
              {activeSession.avatar_url ? (
                <img
                  className="account-avatar"
                  src={activeSession.avatar_url}
                  alt=""
                  width={24}
                  height={24}
                />
              ) : null}
              <span className="account-name">{activeSession.name}</span>
            </div>
            <div className="account-actions">
              <LogoutButton />
              <span className="account-action-separator" aria-hidden="true">
                |
              </span>
              <ApiKeyCopyButton apiKey={activeSession.key} />
            </div>
          </div>
        </section>
      ) : null}

      {activeSession && notificationSettings ? (
        <AlertSettings initialSettings={notificationSettings} />
      ) : null}

      <MeGistTabs
        myGists={payload?.gists ?? []}
        isAuthenticated={Boolean(activeSession)}
      />
    </main>
  );
}
