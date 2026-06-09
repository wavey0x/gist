const LLMS_TXT = `# Wavey Gist

Wavey Gist publishes Markdown gists at https://gist.wavey.info.

## Agent Routes

- GET /: home page; redirects to /list when the visitor has a valid wg_session.
- GET /login: HTML login form for a gist API key.
- POST /api/auth/session: form field api_key; sets wg_session and redirects to /list.
- POST /logout: clears wg_session and redirects to /login.
- GET /list: authenticated HTML list of gists created by the current key.
- GET /list/raw: authenticated plain-text list of those gists.
- GET /api/me/gists: authenticated JSON list of those gists.
- GET /{gist_id}: public rendered gist page.
- GET /{gist_id}/raw: public raw Markdown for the latest revision.
- GET /{gist_id}/revisions/{revision_number}: public rendered revision.
- GET /{gist_id}/revisions/{revision_number}/raw: public raw Markdown for a revision.

## Publishing API

Use https://api.wavey.info with Authorization: Bearer <gist API key>.

- POST /api/v1/gists with JSON {"title": "optional", "markdown": "..."} creates a gist.
- PATCH /api/v1/gists/{gist_id} with JSON {"title": "optional", "markdown": "..."} creates a new revision.
- DELETE /api/v1/gists/{gist_id} deletes a gist.
- Gist keys should have gist:read and gist:write; deleting requires gist:delete.

## Agent Guidance

- Prefer /raw for Markdown and /list/raw or /api/me/gists for listing.
- Public gist viewing does not require auth.
- Listing and logout require the wg_session cookie from login.
`;

export const dynamic = "force-static";

export function GET() {
  return new Response(LLMS_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
