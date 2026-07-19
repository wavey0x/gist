import type { NextRequest } from "next/server";
import { proxyDownloadWithSession } from "../../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyDownloadWithSession(request, "/api/v1/me/gists/export");
}
