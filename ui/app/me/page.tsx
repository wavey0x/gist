import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApiKeyCopyButton } from "../../components/ApiKeyCopyButton";
import { DeleteGistButton } from "../../components/DeleteGistButton";
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
        <div className="account-profile">
          <div className="account-identity">
            {session.avatar_url ? (
              <img
                className="account-avatar"
                src={session.avatar_url}
                alt=""
                width={24}
                height={24}
              />
            ) : null}
            <span className="account-name">{session.name}</span>
          </div>
          <div className="account-actions">
            <form className="account-logout-form" action="/logout" method="post">
              <button className="account-logout-button" type="submit">
                Log out
              </button>
            </form>
            <span className="account-action-separator" aria-hidden="true">
              |
            </span>
            <ApiKeyCopyButton apiKey={session.key} />
          </div>
        </div>
      </section>

      {payload.gists.length > 0 ? (
        <ul className="gist-list">
          {payload.gists.map((gist) => {
            const gistTitle = gist.title ?? gist.id;
            return (
              <li className="gist-list-item" key={gist.id}>
                <div className="gist-list-row">
                  <a className="gist-list-link" href={gist.url}>
                    <span className="gist-list-title">{gistTitle}</span>
                    <span className="gist-list-meta">
                      {gist.author_name} - revision {gist.revision_number} -{" "}
                      <time dateTime={gist.updated_at}>
                        {formatUpdatedAt(gist.updated_at)}
                      </time>
                    </span>
                  </a>
                  {session.can_delete_gists ? (
                    <form
                      className="gist-delete-form"
                      action={`/api/me/gists/${encodeURIComponent(gist.id)}/delete`}
                      method="post"
                    >
                      <DeleteGistButton gistTitle={gistTitle} />
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty-list">No gists yet.</p>
      )}
    </main>
  );
}
