import { ControlButton } from "../../app/components/Controls";
import { AnalysisArticleDocument } from "../../app/analyses/[slug]/PublicAnalysisArticle";
import { bytes, dateTime, StatusPill } from "./presentation";
import type { AnalysisManagementController } from "./useAnalysisManagement";

export function AnalysisManagementView({
  controller,
}: {
  controller: AnalysisManagementController;
}) {
  const {
    text,
    articles,
    selectedId,
    setSelectedId,
    detail,
    loading,
    detailLoading,
    error,
    detailError,
    selected,
    load,
  } = controller;

  return (
    <div className="tw:min-w-0">
      <div className="tw:flex tw:min-h-12 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-border tw:px-5">
        <h2 className="tw:m-0 tw:text-sm tw:font-semibold tw:text-foreground">{text.library}</h2>
        <ControlButton onClick={() => void load()} disabled={loading}>{text.refresh}</ControlButton>
      </div>

      {error ? (
        <p className="tw:m-5 tw:rounded-surface tw:border tw:border-danger/25 tw:bg-danger/5 tw:px-4 tw:py-3 tw:text-xs tw:text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="tw:grid tw:min-h-[560px] tw:grid-cols-[minmax(220px,0.32fr)_minmax(0,1fr)] tw:max-[760px]:grid-cols-1">
          <aside className="tw:min-w-0 tw:border-r tw:border-border tw:bg-surface-inset/45 tw:max-[760px]:max-h-64 tw:max-[760px]:overflow-auto tw:max-[760px]:border-r-0 tw:max-[760px]:border-b">
            {loading ? <p className="tw:m-0 tw:px-5 tw:py-8 tw:text-xs tw:text-muted-foreground">{text.loading}</p> : null}
            {!loading && articles.length === 0 ? <p className="tw:m-0 tw:px-5 tw:py-8 tw:text-xs tw:leading-body tw:text-muted-foreground">{text.empty}</p> : null}
            <ol className="tw:m-0 tw:list-none tw:p-0">
              {articles.map((article) => (
                <li className="tw:border-b tw:border-border" key={article.id}>
                  <button
                    className="tw:grid tw:w-full tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-3 tw:border-0 tw:bg-transparent tw:px-5 tw:py-4 tw:text-left tw:hover:bg-surface-raised tw:data-[active=true]:bg-selection"
                    data-active={article.id === selectedId}
                    onClick={() => setSelectedId(article.id)}
                    type="button"
                  >
                    <span className="tw:min-w-0">
                      <strong className="tw:block tw:truncate tw:text-xs tw:font-medium tw:text-foreground">{article.definition.title}</strong>
                      <small className="tw:mt-1 tw:block tw:truncate tw:font-mono tw:text-2xs tw:text-muted-foreground">
                        r{article.revision} · {article.connections[0]?.alias ?? "DB"} · {text.manual}
                      </small>
                    </span>
                    <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">r{article.revision}</span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          <section className="tw:min-w-0 tw:p-6 tw:max-[560px]:p-4" aria-live="polite">
            {!selected ? <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{text.select}</p> : (
              <div className="tw:grid tw:gap-7">
                <header className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-3 tw:border-b tw:border-border tw:pb-5">
                  <span className="tw:min-w-0">
                    <h3 className="tw:m-0 tw:text-xl tw:font-medium tw:tracking-tight tw:text-foreground">{selected.definition.title}</h3>
                    <small className="tw:mt-2 tw:block tw:font-mono tw:text-2xs tw:text-muted-foreground">{text.openDesktop}</small>
                  </span>
                </header>

                <AnalysisArticleDocument
                  article={{
                    version: 2,
                    title: selected.definition.title,
                    html: selected.definition.html,
                    publishedAt: selected.updatedAt,
                    searchIndexable: false,
                  }}
                  eyebrow={text.articleHtml}
                  resultLabel={text.savedDocument}
                />

                <section className="tw:min-w-0 tw:overflow-hidden tw:rounded-surface tw:border tw:border-border">
                  <h4 className="tw:m-0 tw:border-b tw:border-border tw:px-4 tw:py-3 tw:text-xs tw:font-medium">{text.savedQuery}</h4>
                  <pre className="tw:m-0 tw:max-h-80 tw:overflow-auto tw:bg-surface-inset tw:p-4 tw:font-mono tw:text-2xs tw:leading-body tw:text-foreground"><code>{selected.definition.query.sql}</code></pre>
                </section>

                {detailError ? <p className="tw:m-0 tw:text-xs tw:text-danger" role="alert">{detailError}</p> : null}
                {detailLoading ? <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">{text.loading}</p> : null}

                <div className="tw:grid tw:grid-cols-2 tw:gap-5 tw:max-[880px]:grid-cols-1">
                  <section className="tw:min-w-0 tw:rounded-surface tw:border tw:border-border">
                    <h4 className="tw:m-0 tw:border-b tw:border-border tw:px-4 tw:py-3 tw:text-xs tw:font-medium">{text.latestRuns}</h4>
                    {detail.runs.length === 0 ? <p className="tw:m-0 tw:px-4 tw:py-5 tw:text-xs tw:text-muted-foreground">{text.noRuns}</p> : (
                      <ol className="tw:m-0 tw:list-none tw:p-0">
                        {detail.runs.slice(0, 8).map((run) => (
                          <li className="tw:grid tw:grid-cols-[auto_minmax(0,1fr)] tw:items-start tw:gap-3 tw:border-b tw:border-border tw:px-4 tw:py-3 tw:last:border-b-0" key={run.id}>
                            <StatusPill value={run.state} />
                            <span className="tw:min-w-0 tw:text-2xs tw:text-muted-foreground">
                              <strong className="tw:block tw:truncate tw:font-medium tw:text-foreground">r{run.articleRevision} · {run.rowCount} rows · {bytes(run.byteCount)}</strong>
                              <time>{dateTime(run.finishedAt ?? run.createdAt, text.never)}</time>
                              {run.errorKind ? <small className="tw:mt-1 tw:block tw:truncate tw:text-danger">{run.errorKind}: {run.errorMessage}</small> : null}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>

                  <section className="tw:min-w-0 tw:rounded-surface tw:border tw:border-border">
                    <h4 className="tw:m-0 tw:border-b tw:border-border tw:px-4 tw:py-3 tw:text-xs tw:font-medium">{text.publications}</h4>
                    {detail.publications.length === 0 ? <p className="tw:m-0 tw:px-4 tw:py-5 tw:text-xs tw:text-muted-foreground">{text.noPublications}</p> : (
                      <ol className="tw:m-0 tw:list-none tw:p-0">
                        {detail.publications.map((publication) => (
                          <li className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:border-b tw:border-border tw:px-4 tw:py-3 tw:last:border-b-0" key={publication.id}>
                            <span className="tw:min-w-0">
                              <strong className="tw:block tw:truncate tw:text-xs tw:font-medium">{publication.title}</strong>
                              <small className="tw:font-mono tw:text-2xs tw:text-muted-foreground">v{publication.version} · {publication.visibility} · {dateTime(publication.publishedAt, text.never)}</small>
                            </span>
                            {publication.revokedAt ? <StatusPill value="revoked" label={text.revoked} /> : (
                              <a className="tw:text-xs tw:font-medium tw:text-primary tw:hover:underline" href={`/analyses/${encodeURIComponent(publication.slug)}`} target="_blank" rel="noreferrer">{text.openPublication}</a>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </div>
              </div>
            )}
          </section>
      </div>
    </div>
  );
}
