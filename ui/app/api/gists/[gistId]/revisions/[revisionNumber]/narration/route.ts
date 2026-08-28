import { NextResponse, type NextRequest } from "next/server";
import {
  proxyJsonMutationWithSession,
  proxyJsonWithSession
} from "../../../../../../../lib/auth";
import {
  validateGistId,
  validateRevisionNumber
} from "../../../../../../../lib/gists";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    gistId: string;
    revisionNumber: string;
  }>;
};

function narrationPath(gistId: string, revisionNumber: string) {
  if (!validateGistId(gistId) || !validateRevisionNumber(revisionNumber)) {
    return null;
  }
  return `/api/v1/gists/${gistId}/revisions/${revisionNumber}/narration`;
}

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { gistId, revisionNumber } = await params;
  const path = narrationPath(gistId, revisionNumber);
  if (!path) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 }
    );
  }
  const response = await proxyJsonWithSession(request, path);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const { gistId, revisionNumber } = await params;
  const path = narrationPath(gistId, revisionNumber);
  if (!path) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 }
    );
  }
  const response = await proxyJsonMutationWithSession(request, path, "POST");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
