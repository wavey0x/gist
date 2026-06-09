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
  return !origin || origin === new URL(request.url).origin;
}

function redirectToMe(request: NextRequest, code?: string) {
  const url = new URL("/me", request.url);
  if (code) {
    url.searchParams.set("delete_status", code);
  }
  return NextResponse.redirect(url, { status: 303 });
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
  if (backendResponse.status === 204) {
    response = redirectToMe(request);
  } else if (backendResponse.status === 401) {
    response = NextResponse.redirect(new URL("/login", request.url), {
      status: 303
    });
  } else if (backendResponse.status === 403) {
    response = redirectToMe(request, "forbidden");
  } else if (backendResponse.status === 404) {
    response = redirectToMe(request, "not_found");
  } else if (backendResponse.status === 429) {
    response = redirectToMe(request, "rate_limited");
  } else {
    response = redirectToMe(request, "server");
  }

  forwardBackendSetCookie(response, backendResponse);
  return response;
}
