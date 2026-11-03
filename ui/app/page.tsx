import { cookies } from "next/headers";
import Link from "next/link";
import { Library } from "../components/Library";
import { UpNext } from "../components/UpNext";
import { fetchCurrentSession, fetchMyGists } from "../lib/auth";
import { TIME_ZONE_COOKIE, validTimeZone } from "../lib/date-groups";

async function getHomeSession() {
  try {
    return await fetchCurrentSession();
  } catch {
    return null;
  }
}

function readCookie(store: Awaited<ReturnType<typeof cookies>>, name: string) {
  const value = store.get(name)?.value;
  try {
    return value ? decodeURIComponent(value) : null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  // Both requests only need the session cookie, so run them together.
  const [session, myGists] = await Promise.all([
    getHomeSession(),
    fetchMyGists().catch(() => null)
  ]);
  const payload = session ? myGists : null;
  const timeZone = validTimeZone(readCookie(await cookies(), TIME_ZONE_COOKIE)) ?? "UTC";
  const isAuthenticated = Boolean(session && payload);

  return (
    <main
      className={`home-shell${isAuthenticated ? " home-shell-authenticated" : ""}`}
      aria-label="Gists"
    >
      {!isAuthenticated ? (
        <section className="home-intro" aria-label="waveygist intro">
          <p className="empty-state-lead">
            A simple way for your agent to share code snippets and Markdown.
          </p>
          <p>
            <Link className="inline-link" href="/login">
              Log in
            </Link>{" "}
            with a gist API key to view your gists.
          </p>
        </section>
      ) : null}

      {isAuthenticated ? <UpNext /> : null}

      <Library
        initialMyGists={payload}
        isAuthenticated={isAuthenticated}
        userName={session?.name ?? null}
        timeZone={timeZone}
        serverNow={Date.now()}
      />
    </main>
  );
}
