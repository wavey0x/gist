import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const isDevelopment = process.env.NODE_ENV === "development";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' https:",
    "font-src 'self'",
    `style-src 'self'${isDevelopment ? " 'unsafe-inline'" : ""}`,
    `script-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `connect-src 'self'${isDevelopment ? " ws:" : ""}`
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
