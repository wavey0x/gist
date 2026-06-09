import type { NextRequest } from "next/server";
import { proxyDeleteWithSession } from "../../../../../lib/auth";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    gistId: string;
  }>;
};

export async function DELETE(request: NextRequest, { params }: RouteProps) {
  const { gistId } = await params;
  return proxyDeleteWithSession(
    request,
    `/api/v1/me/gists/${encodeURIComponent(gistId)}`
  );
}
