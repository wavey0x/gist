import type { NextRequest } from "next/server";
import { proxyJsonWithSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const queryString = request.nextUrl.searchParams.toString();
  return proxyJsonWithSession(
    request,
    `/api/v1/me/gists${queryString ? `?${queryString}` : ""}`
  );
}
