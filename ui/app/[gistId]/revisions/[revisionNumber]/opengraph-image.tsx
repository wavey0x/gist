import { notFound } from "next/navigation";
import {
  PublicGistNotFoundError,
  fetchPublicGistPayload
} from "../../../../lib/gists";
import {
  GIST_SOCIAL_IMAGE_ALT,
  GIST_SOCIAL_IMAGE_SIZE,
  renderGistSocialImage
} from "../../../../lib/gist-social-image";
import { getGistShareTitle } from "../../../../lib/gist-title";

export const alt = GIST_SOCIAL_IMAGE_ALT;
export const size = GIST_SOCIAL_IMAGE_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ImageProps = {
  params: Promise<{
    gistId: string;
    revisionNumber: string;
  }>;
};

export default async function OpenGraphImage({ params }: ImageProps) {
  const { gistId, revisionNumber } = await params;

  try {
    const gist = await fetchPublicGistPayload(gistId, revisionNumber);
    return renderGistSocialImage(getGistShareTitle(gist));
  } catch (error) {
    if (error instanceof PublicGistNotFoundError) {
      notFound();
    }
    throw error;
  }
}
