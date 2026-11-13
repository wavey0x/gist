import { SavedGistPreview } from "../../components/SavedGistPreview";
import { getSiteChromeConfig } from "../../lib/site-config";

export default function Loading() {
  return <SavedGistPreview chrome={getSiteChromeConfig()} />;
}
