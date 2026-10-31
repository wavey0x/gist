import type { NextRequest } from "next/server";
import {
  proxyJsonMutationWithSession,
  proxyJsonWithSession
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const response = await proxyJsonWithSession(request, "/api/v1/me/listen-queue");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function PUT(request: NextRequest) {
  const response = await proxyJsonMutationWithSession(
    request,
    "/api/v1/me/listen-queue",
    "PUT"
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
