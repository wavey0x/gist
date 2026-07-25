import type { NextRequest } from "next/server";
import {
  fetchMyGists,
  MyGistsRequestError,
  type MyGistsOptions,
  type MyGistSort
} from "../../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function formatGistList(
  payload: NonNullable<Awaited<ReturnType<typeof fetchMyGists>>>
) {
  const lines = ["# Your Wavey Gists", ""];
  if (payload.query) {
    lines.push(`query: ${cleanLine(payload.query)}`);
  }
  lines.push(`results: ${payload.pagination.total}`);
  lines.push(`offset: ${payload.pagination.offset}`);
  lines.push(
    `next_offset: ${payload.pagination.next_offset ?? "none"}`,
    ""
  );

  if (payload.gists.length === 0) {
    lines.push(payload.query ? "No matching gists." : "No gists.");
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

function invalidRequest() {
  return new Response("Invalid query\n", {
    status: 400,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

function listOptions(request: NextRequest): MyGistsOptions | null {
  const parameters = request.nextUrl.searchParams;
  const allowed = new Set(["q", "limit", "offset", "sort"]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key) || parameters.getAll(key).length > 1) {
      return null;
    }
  }

  const options: MyGistsOptions = {};
  const query = parameters.get("q");
  if (query !== null) {
    options.query = query;
  }
  for (const [field, minimum, maximum] of [
    ["limit", 1, 100],
    ["offset", 0, Number.MAX_SAFE_INTEGER]
  ] as const) {
    const raw = parameters.get(field);
    if (raw === null) {
      continue;
    }
    if (!/^[0-9]+$/.test(raw)) {
      return null;
    }
    const parsed = Number(raw);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < minimum ||
      parsed > maximum
    ) {
      return null;
    }
    options[field] = parsed;
  }
  const sort = parameters.get("sort");
  if (sort !== null) {
    if (!["relevance", "updated", "created"].includes(sort)) {
      return null;
    }
    options.sort = sort as MyGistSort;
  }
  return options;
}

export async function GET(request: NextRequest) {
  const options = listOptions(request);
  if (!options) {
    return invalidRequest();
  }

  let payload;
  try {
    payload = await fetchMyGists(options);
  } catch (error) {
    if (error instanceof MyGistsRequestError && error.status === 400) {
      return invalidRequest();
    }
    throw error;
  }
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
