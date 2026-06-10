import Link from "next/link";
import { redirect } from "next/navigation";
import { MeGistTabs } from "../components/MeGistTabs";
import { fetchCurrentSession } from "../lib/auth";

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
  if (session) {
    redirect("/me");
  }

  return (
    <main className="home-shell" aria-label="waveygist">
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

      <section className="home-gist-history" aria-label="Gist history">
        <MeGistTabs
          myGists={[]}
          isAuthenticated={false}
        />
      </section>
    </main>
  );
}
