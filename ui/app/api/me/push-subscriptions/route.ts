import type { NextRequest } from "next/server";
import { proxyJsonMutationWithSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  return proxyJsonMutationWithSession(
    request,
    "/api/v1/me/push-subscriptions",
    "PUT"
  );
}

export async function DELETE(request: NextRequest) {
  return proxyJsonMutationWithSession(
    request,
    "/api/v1/me/push-subscriptions",
    "DELETE"
  );
}
