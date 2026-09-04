# Neon management authentication decision

Decision date: 2026-08-05

## Decision

DopeDB does not present Neon Management API access as OAuth or as a Desktop
one-click credential. Neon management is available only as a workspace-managed
integration in the hosted control plane. An administrator supplies a Neon API
key there, preferably a project-scoped organization key, and the service encrypts
that integration credential. The Desktop has no Neon API-key form, never reads
the key, and never calls the Neon Management API. Shared connection records,
discovery receipts, browser responses, audit events, and Desktop target authority
never contain it.

New encrypted Neon credential envelopes use this explicit contract:

```text
kind = apiKey
schemaVersion = 2
apiKey = secret
projectId = optional project selector
organizationId = optional organization selector
```

The server accepts only this current envelope. Unversioned and earlier encrypted
payloads are unsupported in the pre-MVP service. An OAuth credential kind must not
be added until Neon supplies DopeDB with a production third-party client contract.

## Official evidence

- The [Neon API authentication reference](https://api-docs.neon.tech/reference/authentication)
  defines Bearer API keys for the public Management API and documents personal,
  organization, and project-scoped organization keys.
- The current [Neon OpenAPI specification](https://neon.com/api_spec/release/v2.json)
  describes `BearerAuth` as an API key. It publishes no OAuth authorization-code
  security scheme or self-service client-registration endpoint.
- `GET /auth` is the documented
  [request-authentication details endpoint](https://api-docs.neon.tech/reference/getauthdetails).
  It returns `account_id` and an `auth_method` that distinguishes user API keys,
  organization API keys, OAuth sessions, and Neon-owned sessions.
- Neon documents OAuth for its hosted
  [MCP server](https://neon.com/docs/ai/neon-mcp-server). That authorization is
  owned by Neon's MCP product and is not a documented credential-broker contract
  for a third-party shared database service.

The absence of a public client-registration contract is an inference from the
published API and documentation, not a claim that Neon has no private partner
program. Revisit this decision only when Neon provides all of the following:

- production client registration and redirect URI ownership;
- authorization, token, and revocation endpoints;
- PKCE requirements;
- minimum read scopes for project, branch, database, endpoint, role, and
  connection URI discovery;
- access/refresh TTL and rotation behavior;
- project and organization consent semantics.

## Runtime verification

The hosted control plane verifies both the `/auth` principal and the complete,
bounded project set. Their fingerprints form the durable external account
identity. Discovery and new lease issuance repeat that comparison, so a key
replacement or project-scope drift fails closed and asks the administrator to
reconnect in the web console. Desktop receives only the redacted resource
selector and the resulting short-lived database lease.

Personal keys without an organization selector are recorded as broad scope.
The UI must warn about that scope and continue to recommend a project-scoped
organization key; it must not label the fallback as one-click.

Project and branch discovery follows Neon cursors until exhaustion, within the
shared 200-resource and 16-page safety bounds. The database endpoint is currently
unpaginated; the collector accepts and follows a future cursor response while
avoiding undocumented query parameters on the first request. Any repeated,
invalid, or over-limit cursor fails closed instead of silently truncating.

The final database selection is pinned by Neon database ID, with its current
name retained only as display/connection metadata. A protected branch is always
production; a default or otherwise unclassified branch requires an Admin/Owner
classification. No final discovery leaf can be imported directly. It must pass
the sealed Neon bootstrap plan, explicit PUBLIC/production approvals, independent
ACL validation, and separate read/write credential smoke tests before a short-lived
import receipt is issued. The read role must reject writes; the write role must allow
only DML and reject DDL and role management. The connection still starts read-only,
and only a later administrator policy plus member RBAC can request the verified write
capability.
