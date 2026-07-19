import Link from "next/link";
import { GistHistoryTabs } from "../components/GistHistory";
import { fetchCurrentSession, fetchMyGists } from "../lib/auth";

async function getHomeSession() {
  try {
    return await fetchCurrentSession();
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const session = await getHomeSession();
  const payload = session ? await fetchMyGists() : null;
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

      <section className="home-gist-history" aria-label="Gist history">
        <GistHistoryTabs
          myGists={payload?.gists ?? []}
          isAuthenticated={isAuthenticated}
        />
      </section>
    </main>
  );
}
