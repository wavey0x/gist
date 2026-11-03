// Shaped like the home page (tabs, then a list) so the content lands where
// the placeholder was instead of jumping from article lines to rows.
const ROW_WIDTHS = ["72%", "48%", "64%", "56%", "80%", "44%"];

export default function Loading() {
  return (
    <main className="home-shell home-shell-authenticated" aria-busy="true" aria-label="Loading">
      <div className="home-skeleton" aria-hidden="true">
        <div className="home-skeleton-tabs">
          <span className="loading-line" style={{ width: 72 }} />
          <span className="loading-line" style={{ width: 112 }} />
        </div>
        {ROW_WIDTHS.map((width, index) => (
          <div className="home-skeleton-row" key={index}>
            <span className="loading-line" style={{ width }} />
            <span className="loading-line" style={{ width: 44 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
