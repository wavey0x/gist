import {
  PublicGistNotFoundError,
  fetchPublicGistPayload
} from "./gists";

const RAW_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8"
};

export async function rawGistResponse(
  gistId: string,
  revisionNumber?: string
) {
  try {
    const gist = await fetchPublicGistPayload(gistId, revisionNumber);
    return new Response(gist.markdown, {
      headers: RAW_HEADERS
    });
  } catch (error) {
    if (error instanceof PublicGistNotFoundError) {
      return new Response("Not found\n", {
        status: 404,
        headers: RAW_HEADERS
      });
    }
    throw error;
  }
}
