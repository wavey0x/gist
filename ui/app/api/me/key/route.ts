import { NextResponse } from "next/server";
import { fetchCurrentSession } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await fetchCurrentSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  return NextResponse.json(
    { key: session.key },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
