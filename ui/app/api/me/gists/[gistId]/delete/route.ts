import { NextResponse, type NextRequest } from "next/server";
import {
  deleteWithSession,
  forwardBackendSetCookie
} from "../../../../../../lib/auth";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{
    gistId: string;
  }>;
};

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  if (origin === "null") {
    const fetchSite = request.headers.get("sec-fetch-site");
    return fetchSite === "same-origin" || fetchSite === "same-site";
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const candidateHosts = new Set<string>();
  candidateHosts.add(request.nextUrl.host);
  candidateHosts.add(new URL(request.url).host);

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    candidateHosts.add(forwardedHost.split(",")[0].trim());
  }

  const host = request.headers.get("host");
  if (host) {
    candidateHosts.add(host);
  }

  return candidateHosts.has(originHost);
}

function redirectToMe(request: NextRequest) {
  return NextResponse.redirect(new URL("/me", request.url), { status: 303 });
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Forbidden" } },
      { status: 403 }
    );
  }

  const { gistId } = await params;
  const backendResponse = await deleteWithSession(
    request,
    `/api/v1/me/gists/${encodeURIComponent(gistId)}`
  );
  if (!backendResponse) {
    return NextResponse.redirect(new URL("/login", request.url), {
      status: 303
    });
  }

  let response: NextResponse;
  if (backendResponse.status === 401) {
    response = NextResponse.redirect(new URL("/login", request.url), {
      status: 303
    });
  } else {
    response = redirectToMe(request);
  }

  forwardBackendSetCookie(response, backendResponse);
  return response;
}
