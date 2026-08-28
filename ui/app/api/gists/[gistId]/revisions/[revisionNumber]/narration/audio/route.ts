import { NextResponse, type NextRequest } from "next/server";
import { apiUrl } from "../../../../../../../../lib/api-base";
import {
  forwardBackendSetCookie,
  requestSessionCookieHeader
} from "../../../../../../../../lib/auth";
import {
  validateGistId,
  validateRevisionNumber
} from "../../../../../../../../lib/gists";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    gistId: string;
    revisionNumber: string;
  }>;
};

async function proxyAudio(request: NextRequest, { params }: RouteProps) {
  const { gistId, revisionNumber } = await params;
  if (!validateGistId(gistId) || !validateRevisionNumber(revisionNumber)) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 }
    );
  }
  const cookieHeader = requestSessionCookieHeader(request);
  if (!cookieHeader) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const requestHeaders = new Headers({
    Accept: "audio/mpeg",
    Cookie: cookieHeader
  });
  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) {
      requestHeaders.set(name, value);
    }
  }
  const path =
    `/api/v1/gists/${gistId}/revisions/${revisionNumber}` +
    "/narration/audio";
  const backendResponse = await fetch(await apiUrl(path), {
    cache: "no-store",
    headers: requestHeaders,
    method: request.method
  });

  const responseHeaders = new Headers();
  for (const name of [
    "accept-ranges",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified"
  ]) {
    const value = backendResponse.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }
  responseHeaders.set("Cache-Control", "private, no-store");
  const response = new NextResponse(
    request.method === "HEAD" ? null : backendResponse.body,
    {
      headers: responseHeaders,
      status: backendResponse.status
    }
  );
  forwardBackendSetCookie(response, backendResponse);
  return response;
}

export async function GET(request: NextRequest, route: RouteProps) {
  return proxyAudio(request, route);
}

export async function HEAD(request: NextRequest, route: RouteProps) {
  return proxyAudio(request, route);
}
