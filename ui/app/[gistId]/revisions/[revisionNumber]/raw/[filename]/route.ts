import { rawGistResponse } from "../../../../../../lib/raw-gist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawRevisionFileRouteProps = {
  params: Promise<{
    gistId: string;
    revisionNumber: string;
    filename: string;
  }>;
};

export async function GET(
  _request: Request,
  { params }: RawRevisionFileRouteProps
) {
  const { gistId, revisionNumber, filename } = await params;
  return rawGistResponse(gistId, revisionNumber, filename);
}
