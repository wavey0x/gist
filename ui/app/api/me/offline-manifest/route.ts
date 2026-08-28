import type { NextRequest } from "next/server";
import { proxyJsonWithSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const response = await proxyJsonWithSession(
    request,
    "/api/v1/me/offline-manifest"
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
