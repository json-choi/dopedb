# DopeDB measurement boundary

Status: canonical, effective 2026-10-19.

DopeDB is open source. The Desktop app and the hosted workspace collect no
product or usage analytics: no behavioral events, funnels, session recording,
consent prompt, installation identifier, or vendor autocapture. This is decision
PD-48 in [`PRODUCT_UI_SCOPE.md`](PRODUCT_UI_SCOPE.md). Do not reintroduce a
Desktop or workspace event pipeline without changing that decision first.

Two measurement paths remain. Do not join them by copying identifiers between them.

| System | Purpose | Boundary |
| --- | --- | --- |
| Cloudflare Analytics Engine on `dopedb.dev` | Count public website page views, downloads, and workspace CTA clicks | Closed page/language and CTA enums only; no visitor, Desktop, account, URL, referrer, device, or location identifier |
| Sentry Desktop diagnostics | Investigate sanitized production renderer failures and allowlisted Agent-plugin failures | Error diagnostics only; no product funnel events, replay, tracing, logs, breadcrumbs, default PII, request, user, free-form message, or customer payload |

## Website metrics

Website metrics use the `dopedb_site` Analytics Engine dataset. The same-origin
`/api/site-events` route bounds each request to 1 KiB and an edge-IP request budget;
the IP is not written into the dataset. Browser Do Not Track and Global Privacy
Control disable collection. Dataset points expire after three months under the
[Analytics Engine retention limit](https://developers.cloudflare.com/analytics/analytics-engine/limits/).
These are sampled aggregate event counts, not unique visitors or cross-session
funnels. A download click must not carry a visitor identifier into an installer.
Production operations are documented in [Cloudflare operations](CLOUDFLARE_OPERATIONS.md).

The closed event contract lives in `site/lib/analytics.ts` and is asserted by
`workspace-cloud/lib/site-analytics.harness.ts`. Adding a page, language, or CTA
value means extending that closed enum and its harness case, never accepting a
free-form property.

## Error diagnostics

Sentry diagnostics are implemented in `src/features/monitoring/` and run only in
production builds. They are not used for funnel measurement, and the privacy
policy at `site/app/privacy/page.tsx` must describe them as the only Desktop
telemetry.
