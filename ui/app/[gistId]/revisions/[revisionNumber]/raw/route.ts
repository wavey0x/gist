import { rawGistResponse } from "../../../../../lib/raw-gist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawRevisionRouteProps = {
  params: Promise<{
    gistId: string;
    revisionNumber: string;
  }>;
};

export async function GET(
  _request: Request,
  { params }: RawRevisionRouteProps
) {
  const { gistId, revisionNumber } = await params;
  return rawGistResponse(gistId, revisionNumber);
}
