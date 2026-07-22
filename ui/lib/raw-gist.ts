import {
  PublicGistNotFoundError,
  fetchPublicGistPayload,
  validateGistFilename
} from "./gists";

function rawHeaders(filename: string, immutable: boolean) {
  return {
    "Cache-Control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-store",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  };
}

export async function rawGistResponse(
  gistId: string,
  revisionNumber?: string,
  filename?: string
) {
  try {
    if (filename !== undefined && !validateGistFilename(filename)) {
      throw new PublicGistNotFoundError();
    }
    const gist = await fetchPublicGistPayload(gistId, revisionNumber);
    const selectedFilename = filename ?? gist.primary_file;
    const file = gist.files[selectedFilename];
    if (!file) {
      throw new PublicGistNotFoundError();
    }
    return new Response(file.content, {
      headers: rawHeaders(selectedFilename, revisionNumber !== undefined)
    });
  } catch (error) {
    if (error instanceof PublicGistNotFoundError) {
      return new Response("Not found\n", {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    throw error;
  }
}
