import { LLMS_TXT } from "./llms.txt";

export const dynamic = "force-static";

export function GET() {
  return new Response(LLMS_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
