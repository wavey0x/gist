import { rawGistResponse } from "../../../lib/raw-gist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawRouteProps = {
  params: Promise<{
    gistId: string;
  }>;
};

export async function GET(_request: Request, { params }: RawRouteProps) {
  const { gistId } = await params;
  return rawGistResponse(gistId);
}
