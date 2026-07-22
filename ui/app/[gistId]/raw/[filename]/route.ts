import { rawGistResponse } from "../../../../lib/raw-gist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawFileRouteProps = {
  params: Promise<{ gistId: string; filename: string }>;
};

export async function GET(_request: Request, { params }: RawFileRouteProps) {
  const { gistId, filename } = await params;
  return rawGistResponse(gistId, undefined, filename);
}
