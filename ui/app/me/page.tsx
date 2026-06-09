import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApiKeyDisclosure } from "../../components/ApiKeyDisclosure";
import { fetchCurrentSession, fetchMyGists } from "../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Your gists - Wavey Gist"
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export default async function MePage() {
  const session = await fetchCurrentSession();
  if (!session) {
    redirect("/login");
  }

  const payload = await fetchMyGists();
  if (!payload) {
    redirect("/login");
  }

  return (
    <main className="auth-shell" aria-label="Your gists">
      <section className="account-panel" aria-label="Account">
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
        <ApiKeyDisclosure
          apiKey={session.key}
          keyPrefix={session.key_prefix}
        />
      </section>

      {payload.gists.length > 0 ? (
        <ul className="gist-list">
          {payload.gists.map((gist) => (
            <li className="gist-list-item" key={gist.id}>
              <a className="gist-list-link" href={gist.url}>
                <span className="gist-list-title">{gist.title ?? gist.id}</span>
                <span className="gist-list-meta">
                  {gist.author_name} - revision {gist.revision_number} -{" "}
                  <time dateTime={gist.updated_at}>
                    {formatUpdatedAt(gist.updated_at)}
                  </time>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-list">No gists yet.</p>
      )}
    </main>
  );
}
