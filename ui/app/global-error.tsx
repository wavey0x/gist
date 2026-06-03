"use client";

export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <main className="error-state" aria-label="Server error">
          <h1>This page could not load</h1>
          <p>A server error occurred.</p>
        </main>
      </body>
    </html>
  );
}
