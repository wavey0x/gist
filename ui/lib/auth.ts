import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { apiUrl } from "./api-base";

export const SESSION_COOKIE_NAME = "wg_session";

export type SessionIdentity = {
  name: string;
  key: string;
  key_prefix: string;
  scopes: string[];
  can_delete_gists: boolean;
  github_login?: string;
  avatar_url?: string;
};

export type MyGistItem = {
  id: string;
  url: string;
  title: string | null;
  author_name: string;
  revision_number: number;
  updated_at: string;
};

export type MyGistsPayload = {
  gists: MyGistItem[];
};

function sessionCookieHeader(value: string | undefined) {
  return value ? `${SESSION_COOKIE_NAME}=${value}` : null;
}

async function currentSessionCookieHeader() {
  const cookieStore = await cookies();
  return sessionCookieHeader(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

export function requestSessionCookieHeader(request: NextRequest) {
  return sessionCookieHeader(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

function isSessionIdentity(value: unknown): value is SessionIdentity {
  if (!value || typeof value !== "object") {
    return false;
  }
  const identity = value as Partial<SessionIdentity>;
  return (
    typeof identity.name === "string" &&
    typeof identity.key === "string" &&
    typeof identity.key_prefix === "string" &&
    Array.isArray(identity.scopes) &&
    identity.scopes.every((scope) => typeof scope === "string") &&
    typeof identity.can_delete_gists === "boolean" &&
    (identity.github_login === undefined ||
      typeof identity.github_login === "string") &&
    (identity.avatar_url === undefined || typeof identity.avatar_url === "string")
  );
}

function isMyGistItem(value: unknown): value is MyGistItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<MyGistItem>;
  return (
    typeof item.id === "string" &&
    typeof item.url === "string" &&
    (item.title === null || typeof item.title === "string") &&
    typeof item.author_name === "string" &&
    typeof item.revision_number === "number" &&
    Number.isInteger(item.revision_number) &&
    item.revision_number > 0 &&
    typeof item.updated_at === "string"
  );
}

function normalizeMyGistsPayload(payload: unknown): MyGistsPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid gist list payload");
  }
  const body = payload as Partial<MyGistsPayload>;
  if (!Array.isArray(body.gists) || !body.gists.every(isMyGistItem)) {
    throw new Error("Invalid gist list payload");
  }
  return {
    gists: body.gists
  };
}

export async function fetchCurrentSession(): Promise<SessionIdentity | null> {
  const cookieHeader = await currentSessionCookieHeader();
  if (!cookieHeader) {
    return null;
  }

  const response = await fetch(await apiUrl("/api/v1/auth/session"), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader
    }
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load current session: ${response.status}`);
  }

  const payload = await response.json();
  if (!isSessionIdentity(payload)) {
    throw new Error("Invalid session payload");
  }
  return payload;
}

export async function fetchMyGists(): Promise<MyGistsPayload | null> {
  const cookieHeader = await currentSessionCookieHeader();
  if (!cookieHeader) {
    return null;
  }

  const response = await fetch(await apiUrl("/api/v1/me/gists"), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader
    }
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load gist list: ${response.status}`);
  }

  return normalizeMyGistsPayload(await response.json());
}

export function forwardBackendSetCookie(
  frontendResponse: NextResponse,
  backendResponse: Response
) {
  const setCookie = backendResponse.headers.get("set-cookie");
  if (setCookie) {
    frontendResponse.headers.append("Set-Cookie", setCookie);
  }
}

export async function proxyJsonWithSession(
  request: NextRequest,
  path: string
) {
  const cookieHeader = requestSessionCookieHeader(request);
  if (!cookieHeader) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const backendResponse = await fetch(await apiUrl(path), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader
    }
  });
  const hasBody =
    backendResponse.status !== 204 && backendResponse.status !== 304;
  const body = hasBody ? await backendResponse.text() : null;
  const response = new NextResponse(body, {
    status: backendResponse.status,
    headers: {
      "Content-Type":
        backendResponse.headers.get("content-type") ?? "application/json"
    }
  });
  forwardBackendSetCookie(response, backendResponse);
  return response;
}

export async function deleteWithSession(
  request: NextRequest,
  path: string
) {
  const cookieHeader = requestSessionCookieHeader(request);
  if (!cookieHeader) {
    return null;
  }

  return fetch(await apiUrl(path), {
    cache: "no-store",
    method: "DELETE",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader
    }
  });
}

export async function proxyDeleteWithSession(
  request: NextRequest,
  path: string
) {
  const backendResponse = await deleteWithSession(request, path);
  if (!backendResponse) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const hasBody =
    backendResponse.status !== 204 && backendResponse.status !== 304;
  const body = hasBody ? await backendResponse.text() : null;
  const headers = new Headers();
  const contentType = backendResponse.headers.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  const response = new NextResponse(body, {
    status: backendResponse.status,
    headers
  });
  forwardBackendSetCookie(response, backendResponse);
  return response;
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: true
  });
}

export async function logoutAndRedirect(request: NextRequest) {
  const cookieHeader = requestSessionCookieHeader(request);
  const backendResponse = await fetch(await apiUrl("/api/v1/auth/session"), {
    cache: "no-store",
    method: "DELETE",
    headers: cookieHeader
      ? {
          Cookie: cookieHeader
        }
      : undefined
  });
  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303
  });
  forwardBackendSetCookie(response, backendResponse);
  if (!backendResponse.headers.get("set-cookie")) {
    clearSessionCookie(response);
  }
  return response;
}
