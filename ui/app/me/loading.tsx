export default function Loading() {
  return (
    <main className="page-shell" aria-busy="true" aria-label="Loading">
      <div className="loading-skeleton" aria-hidden="true">
        <span className="loading-line loading-line-title" />
        <span className="loading-line" />
        <span className="loading-line" />
        <span className="loading-line loading-line-short" />
      </div>
    </main>
  );
}
