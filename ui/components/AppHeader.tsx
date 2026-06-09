import Link from "next/link";
import { fetchCurrentSession } from "../lib/auth";

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
      <div className="app-header-inner">
        <Link className="app-brand" href="/" aria-label="waveygist home">
          <span className="brand-mark-strong">wavey</span>
          <span className="brand-mark-light">gist</span>
        </Link>
        <nav className="app-nav" aria-label="Site">
          {session ? (
            <>
              <Link className="app-identity app-identity-link" href="/me">
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
              <form className="app-logout-form" action="/logout" method="post">
                <button className="app-link app-link-button" type="submit">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <Link className="app-link" href="/login">
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
