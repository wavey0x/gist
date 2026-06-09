import Link from "next/link";
import { redirect } from "next/navigation";
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
    redirect("/list");
  }

  return (
    <main className="not-found" aria-label="waveygist">
      <p className="empty-state-lead">
        A simple way for your agent to share code snippets and Markdown.
      </p>
      <p>
        <Link className="inline-link" href="/login">
          Log in
        </Link>{" "}
        with a gist API key to view your gists.
      </p>
    </main>
  );
}
