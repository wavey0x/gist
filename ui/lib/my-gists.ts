export type MyGistItem = {
  id: string;
  url: string;
  title: string | null;
  display_title: string;
  author_name: string;
  author_avatar_url?: string;
  revision_number: number;
  file_count: number;
  created_at: string;
  updated_at: string;
};

export type MyGistSort = "relevance" | "updated" | "created";

export type MyGistsPayload = {
  query: string | null;
  gists: MyGistItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    next_offset: number | null;
  };
  stats: {
    gist_count: number;
    revision_count: number;
    last_updated_at: string | null;
  };
};

function isMyGistItem(value: unknown): value is MyGistItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<MyGistItem>;
  return (
    typeof item.id === "string" &&
    typeof item.url === "string" &&
    (item.title === null || typeof item.title === "string") &&
    typeof item.display_title === "string" &&
    typeof item.author_name === "string" &&
    (item.author_avatar_url === undefined ||
      typeof item.author_avatar_url === "string") &&
    typeof item.revision_number === "number" &&
    Number.isInteger(item.revision_number) &&
    item.revision_number > 0 &&
    typeof item.file_count === "number" &&
    Number.isInteger(item.file_count) &&
    item.file_count > 0 &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string"
  );
}

export function normalizeMyGistsPayload(payload: unknown): MyGistsPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid gist list payload");
  }
  const body = payload as Partial<MyGistsPayload>;
  const pagination = body.pagination;
  const stats = body.stats;
  if (
    !(body.query === null || typeof body.query === "string") ||
    !Array.isArray(body.gists) ||
    !body.gists.every(isMyGistItem) ||
    !pagination ||
    typeof pagination !== "object" ||
    typeof pagination.limit !== "number" ||
    !Number.isInteger(pagination.limit) ||
    pagination.limit < 1 ||
    pagination.limit > 100 ||
    typeof pagination.offset !== "number" ||
    !Number.isInteger(pagination.offset) ||
    pagination.offset < 0 ||
    typeof pagination.total !== "number" ||
    !Number.isInteger(pagination.total) ||
    pagination.total < 0 ||
    (pagination.next_offset !== null &&
      (typeof pagination.next_offset !== "number" ||
        !Number.isInteger(pagination.next_offset) ||
        pagination.next_offset <= pagination.offset)) ||
    body.gists.length > pagination.limit ||
    !stats ||
    typeof stats !== "object" ||
    typeof stats.gist_count !== "number" ||
    !Number.isInteger(stats.gist_count) ||
    stats.gist_count < 0 ||
    typeof stats.revision_count !== "number" ||
    !Number.isInteger(stats.revision_count) ||
    stats.revision_count < 0 ||
    (stats.last_updated_at !== null &&
      typeof stats.last_updated_at !== "string")
  ) {
    throw new Error("Invalid gist list payload");
  }
  return {
    query: body.query,
    gists: body.gists,
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      total: pagination.total,
      next_offset: pagination.next_offset
    },
    stats: {
      gist_count: stats.gist_count,
      revision_count: stats.revision_count,
      last_updated_at: stats.last_updated_at
    }
  };
}
