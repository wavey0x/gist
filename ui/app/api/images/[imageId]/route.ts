import { NextResponse } from "next/server";
import { apiUrl } from "../../../../lib/api-base";

const IMAGE_ID_RE = /^img_[A-Za-z0-9_-]{16,64}$/;

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ imageId: string }>;
};

async function proxyImage(request: Request, { params }: RouteProps) {
  const { imageId } = await params;
  if (!IMAGE_ID_RE.test(imageId)) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 }
    );
  }

  const requestHeaders = new Headers({ Accept: "image/*" });
  for (const name of ["if-none-match", "if-modified-since", "range"]) {
    const value = request.headers.get(name);
    if (value) {
      requestHeaders.set(name, value);
    }
  }
  const backendResponse = await fetch(
    await apiUrl(`/api/v1/images/${imageId}`),
    {
      cache: "no-store",
      headers: requestHeaders,
      method: request.method
    }
  );
  const headers = new Headers();
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
      headers.set(name, value);
    }
  }
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new NextResponse(
    request.method === "HEAD" ? null : backendResponse.body,
    { status: backendResponse.status, headers }
  );
}

export async function GET(request: Request, route: RouteProps) {
  return proxyImage(request, route);
}

export async function HEAD(request: Request, route: RouteProps) {
  return proxyImage(request, route);
}
