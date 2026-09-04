# Local disk-backed SQL result contract

This contract owns desktop SQL result rows after a read is accepted. It does
not change the CLI, dashboard, table pagination, or public ACP wire.

## Ownership and authority

- Rust is the only writer of result pages and manifests.
- A result is bound to one immutable operation, workspace, account scope,
  connection, connection revision, main WebView label, and 256-bit random
  capability. Only the capability hash is written to the manifest.
- Every completed-page read re-pins the connection and rejects a workspace,
  account, access, or connection-revision change. The result cannot become an
  execution or credential authority.
- Result rows never enter `app.db`, workspace sync, audit/history payloads,
  traces, crash reports, or the final operation receipt. A Services snapshot
  stores only the opaque local handle and display metadata.

## Producer and disk bounds

- The database producer emits at most 256 rows and 512 KiB of encoded JSON per
  page.
- Pull/ACK permits exactly one in-flight page. Rust serializes, writes, and
  hashes that page before the small ready notification is sent; it retains no
  prior decoded page.
- Page files are created atomically inside
  `data_dir/dopedb/query-results-v1/<operation>.partial`. A manifest is written
  only when its contiguous pages sum to the backend receipt row count. The
  directory is then atomically renamed to the immutable operation ID.
- Cancel, timeout, receiver drop, receipt mismatch, or writer failure removes
  the partial directory and never publishes it as a completed result.

## Renderer bound and random access

- The renderer stores only `{ operationId, capability, pageRows, rowCount,
  complete }` in React and Services state.
- A process-wide LRU keeps page payloads for at most four visible/recent results
  and six pages per result. With a 512 KiB wire cap this is at most 12 MiB of
  encoded cached page input. Completed-result prefetch is capped at six page
  promises per requested range, while the live producer keeps exactly one page
  in flight. Parsed JavaScript objects therefore remain bounded by fixed page
  counts rather than total result rows (their exact expansion is WebView-engine
  dependent).
- The virtual grid requests only pages intersecting the viewport and overscan.
  Page reads validate sequence, checksum, operation, column order, row width,
  and the current authority before populating the cache.
- Client-side text filtering and whole-result clipboard copy are limited to a
  fully cached result of at most six pages (1,536 rows). Larger condition changes
  are a SQL/Agent re-query; selected grid cells remain copyable.

## Table pagination boundary

- Table data keeps its separate bounded page contract. The generated query
  requests at most the visible 100 rows plus one look-ahead row, and the normal
  safety row/byte caps still apply.
- A table page uses the same capability-bound pull/ACK and cancellation guard,
  but Rust retains the one in-flight page in memory instead of creating a
  partial directory, page file, checksum, manifest, or completed result handle.
- The page is removed immediately after ACK. Operation receipt and local
  history finalization continue on the owned cleanup runtime after the bounded
  page receipt is returned, so those secondary writes do not delay the first
  grid commit.
- SQL console and Services streams remain durable and continue to use the disk
  contract above; table pages cannot be reopened or exported as result handles.

## Export

- Completed CSV and JSON exports use a native save dialog; the destination path
  never crosses the renderer boundary.
- Rust reads one verified page at a time into a buffered writer, emits row-count
  progress, and honors an exact export cancellation capability.
- Output is written to a create-new sibling partial file, flushed and synced,
  and atomically replaces the user-approved destination only after the exported
  row count matches the immutable manifest. Cancellation and failure remove the
  partial file.

## Retention

- Incomplete directories older than 24 hours are swept. Completed results are
  capped at 40 and seven days; an expired Services entry remains display-only
  and reports that its result page is unavailable.
- Services persists only current disk handles. Pre-MVP in-memory stream snapshots
  are unsupported and are not decoded into the WebView.
