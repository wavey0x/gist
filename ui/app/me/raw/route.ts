import { fetchMyGists } from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function formatGistList(payload: NonNullable<Awaited<ReturnType<typeof fetchMyGists>>>) {
  const lines = ["# Your Wavey Gists", ""];

  if (payload.gists.length === 0) {
    lines.push("No gists.");
    return `${lines.join("\n")}\n`;
  }

  for (const gist of payload.gists) {
    const title = cleanLine(gist.display_title);
    lines.push(`- ${title}`);
    lines.push(`  id: ${gist.id}`);
    lines.push(`  url: ${gist.url}`);
    lines.push(`  raw_url: ${gist.url}/raw`);
    lines.push(`  revision: ${gist.revision_number}`);
    lines.push(`  updated_at: ${gist.updated_at}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function GET() {
  const payload = await fetchMyGists();
  if (!payload) {
    return new Response("Unauthorized\n", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }

  return new Response(formatGistList(payload), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
