import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { apiUrl } from "./api-base";

export const SESSION_COOKIE_NAME = "wg_session";

export type SessionIdentity = {
  name: string;
  key: string;
  key_prefix: string;
  github_login?: string;
  avatar_url?: string;
};

export type MyGistItem = {
  id: string;
  url: string;
  title: string | null;
  display_title: string;
  author_name: string;
  author_avatar_url?: string;
  revision_number: number;
  updated_at: string;
};

export type MyGistsPayload = {
  gists: MyGistItem[];
};

export type NotificationSettings = {
  available: boolean;
  application_server_key?: string;
  new_gist: boolean;
  edited_gist: boolean;
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
    typeof item.display_title === "string" &&
    typeof item.author_name === "string" &&
    (item.author_avatar_url === undefined ||
      typeof item.author_avatar_url === "string") &&
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

function normalizeNotificationSettings(
  payload: unknown
): NotificationSettings {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid notification settings payload");
  }
  const settings = payload as Partial<NotificationSettings>;
  if (
    typeof settings.available !== "boolean" ||
    typeof settings.new_gist !== "boolean" ||
    typeof settings.edited_gist !== "boolean" ||
    (settings.application_server_key !== undefined &&
      typeof settings.application_server_key !== "string") ||
    (settings.available && !settings.application_server_key)
  ) {
    throw new Error("Invalid notification settings payload");
  }
  return {
    available: settings.available,
    ...(settings.application_server_key
      ? { application_server_key: settings.application_server_key }
      : {}),
    new_gist: settings.new_gist,
    edited_gist: settings.edited_gist
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

  if (response.status === 401) {
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

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to load gist list: ${response.status}`);
  }

  return normalizeMyGistsPayload(await response.json());
}

export async function fetchNotificationSettings(): Promise<NotificationSettings | null> {
  const cookieHeader = await currentSessionCookieHeader();
  if (!cookieHeader) {
    return null;
  }

  const response = await fetch(
    await apiUrl("/api/v1/me/notification-settings"),
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Cookie: cookieHeader
      }
    }
  );

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to load notification settings: ${response.status}`
    );
  }
  return normalizeNotificationSettings(await response.json());
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
  const hasBody = backendResponse.status !== 204;
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

  const hasBody = backendResponse.status !== 204;
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

function isSameOriginJsonMutation(request: NextRequest) {
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type") ?? "";
  const host = request.headers.get("host");
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  let originMatches = false;
  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      const requestProtocol =
        forwardedProtocol ?? request.nextUrl.protocol.replace(/:$/, "");
      originMatches =
        parsedOrigin.host === host &&
        parsedOrigin.protocol === `${requestProtocol}:`;
    } catch {
      originMatches = false;
    }
  }
  return (
    originMatches &&
    contentType.toLowerCase().startsWith("application/json")
  );
}

export async function proxyJsonMutationWithSession(
  request: NextRequest,
  path: string,
  method: "PUT" | "DELETE"
) {
  if (!isSameOriginJsonMutation(request)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Forbidden" } },
      { status: 403 }
    );
  }
  const cookieHeader = requestSessionCookieHeader(request);
  if (!cookieHeader) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const backendResponse = await fetch(await apiUrl(path), {
    cache: "no-store",
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader
    },
    body: await request.text()
  });
  const hasBody = backendResponse.status !== 204;
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
