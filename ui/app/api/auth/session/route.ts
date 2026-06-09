import { NextResponse, type NextRequest } from "next/server";
import { apiUrl } from "../../../../lib/api-base";
import {
  forwardBackendSetCookie,
  proxyJsonWithSession
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

async function apiKeyFromRequest(request: NextRequest) {
  try {
    const formData = await request.formData();
    const apiKey = formData.get("api_key");
    return typeof apiKey === "string" && apiKey ? apiKey : null;
  } catch {
    return null;
  }
}

function loginRedirect(request: NextRequest, error?: string) {
  const url = new URL("/login", request.url);
  if (error) {
    url.searchParams.set("error", error);
  }
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  const apiKey = await apiKeyFromRequest(request);
  if (!apiKey) {
    return loginRedirect(request, "invalid");
  }

  const backendResponse = await fetch(await apiUrl("/api/v1/auth/session"), {
    cache: "no-store",
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ api_key: apiKey })
  });

  if (backendResponse.ok) {
    const response = NextResponse.redirect(new URL("/list", request.url), {
      status: 303
    });
    forwardBackendSetCookie(response, backendResponse);
    return response;
  }

  if (backendResponse.status === 401 || backendResponse.status === 403) {
    return loginRedirect(request, "invalid");
  }
  if (backendResponse.status === 429) {
    return loginRedirect(request, "rate_limited");
  }
  return loginRedirect(request, "server");
}

export async function GET(request: NextRequest) {
  return proxyJsonWithSession(request, "/api/v1/auth/session");
}
