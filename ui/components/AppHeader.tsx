import Link from "next/link";
import { fetchCurrentSession } from "../lib/auth";
import { StandaloneAppControls } from "./StandaloneAppControls";
import { ConnectivityIndicator } from "./ConnectivityIndicator";
import { OfflineIdentityRecorder } from "./OfflineIdentityRecorder";
import { ThemeToggle } from "./ThemeToggle";
import { StandaloneBackButton } from "./StandaloneBackButton";

async function getHeaderSession() {
  try {
    return await fetchCurrentSession();
  } catch {
    return null;
  }
}

export async function AppHeader() {
  const session = await getHeaderSession();

  return (
    <header className="app-header">
      <OfflineIdentityRecorder
        identity={
          session
            ? {
                name: session.name,
                avatarUrl: session.avatar_url ?? null,
                canGenerateAudio: session.can_generate_audio
              }
            : null
        }
      />
      <div className="app-header-inner">
        <div className="app-brand-group">
          <StandaloneBackButton />
          <Link className="app-brand" href="/" aria-label="waveygist home">
            <span className="brand-mark-strong">wavey</span>
            <span className="brand-mark-light">gist</span>
          </Link>
        </div>
        <nav className="app-nav" aria-label="Site">
          <ConnectivityIndicator />
          {session ? (
            <Link
              className="app-identity app-identity-link"
              href="/me"
              aria-label={`${session.name} settings`}
            >
              {session.avatar_url ? (
                <img
                  className="app-avatar"
                  src={session.avatar_url}
                  alt=""
                  width={20}
                  height={20}
                />
              ) : null}
              <span className="app-name">{session.name}</span>
            </Link>
          ) : (
            <Link className="app-link" href="/login">
              Log in
            </Link>
          )}
          <ThemeToggle />
          <StandaloneAppControls />
        </nav>
      </div>
    </header>
  );
}
