import type { NextRequest } from "next/server";
import {
  proxyJsonMutationWithSession,
  proxyJsonWithSession
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyJsonWithSession(
    request,
    "/api/v1/me/notification-settings"
  );
}

export async function PUT(request: NextRequest) {
  return proxyJsonMutationWithSession(
    request,
    "/api/v1/me/notification-settings",
    "PUT"
  );
}
