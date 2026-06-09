import { headers } from "next/headers";

export async function resolveApiBaseUrl() {
  const configuredBaseUrl =
    process.env.GIST_API_BASE_URL ?? process.env.WAVEY_API_BASE_URL;

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("host")?.toLowerCase();

  if (host === "gist.wavey.info") {
    return "https://api.wavey.info";
  }

  return "http://localhost:3001";
}

export async function apiUrl(path: string) {
  const baseUrl = await resolveApiBaseUrl();
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}
