import { NextResponse } from "next/server";
import { apiUrl } from "../../../../../../../lib/api-base";
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

export async function GET(_request: Request, { params }: RouteProps) {
  const { gistId, revisionNumber } = await params;
  if (!validateGistId(gistId) || !validateRevisionNumber(revisionNumber)) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 }
    );
  }

  const backendResponse = await fetch(
    await apiUrl(
      `/api/v1/gists/${gistId}/revisions/${revisionNumber}/render`
    ),
    {
      cache: "no-store",
      headers: { Accept: "application/json" }
    }
  );
  return new NextResponse(await backendResponse.text(), {
    status: backendResponse.status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type":
        backendResponse.headers.get("content-type") ?? "application/json"
    }
  });
}
