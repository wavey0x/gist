import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchCurrentSession } from "../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Log in - Wavey Gist"
};

type PageProps = {
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

function errorMessage(error: string | string[] | undefined) {
  const code = Array.isArray(error) ? error[0] : error;
  if (code === "rate_limited") {
    return "Too many attempts. Try again shortly.";
  }
  if (code === "server") {
    return "Login is unavailable right now.";
  }
  if (code) {
    return "Invalid API key.";
  }
  return null;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const session = await fetchCurrentSession();
  if (session) {
    redirect("/list");
  }

  const params = await searchParams;
  const message = errorMessage(params.error);

  return (
    <main className="auth-shell auth-login" aria-label="Wavey Gist login">
      <form className="login-form" action="/api/auth/session" method="post">
        <label className="sr-only" htmlFor="api-key">
          API key
        </label>
        <input
          id="api-key"
          name="api_key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="API key"
          required
        />
        <button type="submit">Log in</button>
      </form>
      {message ? <p className="auth-error">{message}</p> : null}
    </main>
  );
}
