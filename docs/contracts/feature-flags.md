# CLI·Terminal Platform feature flags

정본 이름은 `src-tauri/src/features/platform_flags.rs`다. 모든 flag는 기본 `off`다.

| Flag | 활성화 전 gate |
| --- | --- |
| `operation_runtime_v1` | recovery/exact approval 검증 |
| `local_broker_v1` | peer identity, framing limit, stale discovery 검증 |
| `cli_v1` | protocol/secret snapshot/platform packaging 검증 |
| `skill_manager_v1` | atomic install과 user-modified 보존 검증 |
| `terminal_dock_v1` | CSP, PTY/process-tree/session revocation 검증 |
| `catalog_v2` | canonical Catalog V2 DTO를 CLI/ERD/DDL 소비자에 노출하기 전 engine fixture/fingerprint 검증 |
| `ddl_ir_v1` | engine renderer/fail-closed 검증 |
| `table_changes_v1` | key/concurrency/exact proposal 검증 |
| `erd_v1` | Catalog V2/layout 성능 검증 |
| `jobs_v1` | checkpoint/file capability/bounded memory 검증 |
| `plugins_v1` | signature/capability/isolation 검증 |
| `workspace_resources_v1` | revision/conflict/RBAC 검증 |
| `realtime_collaboration_v1` | short-lived token/reconnect/compaction 검증 |

request field나 Agent/Plugin이 flag를 켤 수 없다. 로컬 저장소는 단일 MVP
기준선만 지원하며 과거 개발 스키마는 자동 변환하지 않고 명시적으로 거부한다.

현재 desktop composition root는 검증을 마친 platform flag를 명시적으로
활성화한다. `plugins_v1`, `workspace_resources_v1`,
`realtime_collaboration_v1`은 계속 비활성 상태다.

SQL 문서 기능은 autosave, crash recovery, optimistic conflict 경로를 검증하고
`src-tauri/src/features/sql_documents/` 수직 슬라이스로 졸업했다. 따라서 항상 켜진
분기였던 이전 rollout flag는 제거했으며 새 adapter가 과거 경로로 되돌아가는
fallback도 제공하지 않는다.

현재 UI와 CLI는 canonical `CatalogSnapshot`과 권한 범위가 고정된
`catalog_cache`만 사용한다. 이 flag는 새 CLI/ERD/DDL consumer를 노출하는 경로를
gate하며 과거 Catalog wire나 cache adapter를 되살리지 않는다.
