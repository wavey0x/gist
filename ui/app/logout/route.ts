import { NextResponse, type NextRequest } from "next/server";
import { logoutAndRedirect } from "../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return logoutAndRedirect(request);
}

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
