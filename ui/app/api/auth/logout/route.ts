import type { NextRequest } from "next/server";
import { logoutAndRedirect } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return logoutAndRedirect(request);
}
