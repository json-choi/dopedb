# Legacy removal gate

Every feature migration is one complete vertical slice. A slice is not complete when
the new code merely exists; it is complete only after the old runtime path is gone.

## Required order

1. Capture current behavior with tests.
2. Define typed identities, commands, results, and ports.
3. Implement the use case and concrete adapters.
4. Move every transport and UI caller.
5. Delete the old service, fallback, re-export, rollout flag, tests, and dependency.
6. Search for the old paths and symbols and require zero matches.
7. Run architecture, frontend, Rust, site, cloud, and cross-platform CI checks.

Temporary coexistence is allowed only in the uncommitted working tree while callers are
being moved. An issue-linked `main` commit must contain one production path.

## Pre-MVP persistence policy

Pre-MVP database layouts, cached payloads, and private wire shapes are unsupported.
Removing a superseded feature also removes its migration, decoder, archive table,
fallback, fixture, and compatibility test. Desktop opens only the current local schema;
Workspace Cloud is provisioned from one current baseline. An older development database
must be reset instead of being upgraded inside the product.

Current public protocol versions and security capability negotiation are not migration
fallbacks. They remain only while they are part of the documented current contract.

## Current MVP baseline

- Desktop opens one current local schema and does not upgrade pre-MVP databases.
- Workspace Cloud and each D1 service start from one current baseline migration.
- Private persisted payloads accept only their current shape; old aliases and decoders
  are not retained.
- Provider import always creates a new managed connection. It cannot convert an
  existing member-local connection in place or preserve that connection's identity.
- Retired MCP cleanup, chat archives, Analysis automation/results, and their storage
  are absent rather than hidden behind flags.
