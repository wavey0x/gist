export function resolveApiBaseUrl() {
  return process.env.GIST_API_BASE_URL ?? "http://localhost:3001";
}

export async function apiUrl(path: string) {
  const baseUrl = await resolveApiBaseUrl();
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}
