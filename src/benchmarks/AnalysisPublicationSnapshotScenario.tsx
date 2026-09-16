// Packaged-QA scenario rendering one fixed published article, then asserting the
// publication contract in the real runtime: sanitized static HTML only, with no
// control that could re-run or expose the saved query.
import { useEffect, useState } from "react";

const publishedHtml = [
  "<p>A fixed HTML document for packaged-runtime QA.</p>",
  "<table><thead><tr><th>Segment</th><th>Revenue</th></tr></thead>",
  "<tbody><tr><td>Enterprise</td><td>248000</td></tr></tbody></table>",
].join("");

export function AnalysisPublicationSnapshotScenario() {
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const snapshot = document.querySelector<HTMLElement>("[data-analysis-publication-snapshot]");
      const hasInteractiveControl = Boolean(snapshot?.querySelector(
        "input, select, textarea, button, script, iframe, form",
      ));
      const text = snapshot?.textContent ?? "";
      const title = document.querySelector("h1")?.textContent ?? "";
      setVerified(Boolean(snapshot)
        && !hasInteractiveControl
        && title.includes("Revenue by segment")
        && ["Enterprise", "248000"].every((value) => text.includes(value)));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <main className="tw:flex tw:h-screen tw:min-h-0 tw:w-screen tw:min-w-0 tw:flex-col tw:overflow-hidden tw:bg-background tw:text-foreground">
      <header className="tw:flex tw:min-h-control-lg tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-border-subtle tw:bg-card tw:px-4 tw:py-2">
        <span className="tw:text-sm tw:font-semibold">Packaged QA · published HTML</span>
        <span
          className="tw:text-xs tw:font-medium tw:text-muted-foreground"
          data-publication-snapshot-qa={verified ? "verified" : "checking"}
          role="status"
        >
          {verified ? "Verified: static HTML, no query controls" : "Checking publication contract…"}
        </span>
      </header>
      <div className="scrollbar-sleek tw:min-h-0 tw:flex-1 tw:overflow-auto tw:p-5">
        <article className="tw:mx-auto tw:grid tw:w-full tw:max-w-[900px] tw:gap-6">
          <h1 className="tw:m-0 tw:font-serif tw:text-[36px] tw:leading-tight tw:font-medium">Revenue by segment</h1>
          <div
            className="tw:grid tw:gap-4 tw:text-sm tw:leading-body"
            data-analysis-publication-snapshot
            dangerouslySetInnerHTML={{ __html: publishedHtml }}
          />
        </article>
      </div>
    </main>
  );
}
