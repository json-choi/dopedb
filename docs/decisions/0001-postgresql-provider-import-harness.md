# 결정 근거 0001: PostgreSQL provider-import harness 존치·이식·폐기

- 상태: **소유자 결정 대기.** 이 문서는 근거만 제공하고 결정하지 않는다.
- 관련 이슈: #216 (후속 CI 연결은 #199, 예산 정책은 #198)
- 작성일: 2026-09-17
- 측정 환경: 격리 PostgreSQL 15.15 (Homebrew, 임시 클러스터, `127.0.0.1:55480`,
  unix socket 비활성), Node 24, vitest 4.1.11, 브랜치 `work/wnghdcjfe/decision-reports`
- 작업 경계: 이 조사에서 suite, migration, fixture, credential rotation 코드,
  provider dependency를 **삭제하지 않았다.** 상한을 올리지 않았고 checker discovery
  패턴을 바꾸지 않았다. 실제 고객 DB, 운영 DB, 기존 사용자·role·ACL은 건드리지
  않았다. 모든 PostgreSQL 조사는 이번 실행에서 새로 만든 임시 클러스터에서만 했다.

본문의 모든 수치는 `[측정]`(실행한 명령의 실제 출력)과 `[추정]`(파일 구조에서
읽어낸 추론)으로 구분한다. 이슈 본문의 과거 수치는 현재 사실로 재사용하지 않았다.

---

## 1. 제어 평면이 지금 무엇을 쓰는가 (read-only 확인)

| 확인 대상 | 결과 | 근거 |
| --- | --- | --- |
| Workspace Worker 바인딩 | D1 `WORKSPACE_DB` 하나, `migrations_dir: d1-migrations`. PostgreSQL 바인딩 없음 | `workspace-cloud/wrangler.jsonc` [측정] |
| 환경 분기 | Wrangler 환경(`env.*`) 정의 없음. 운영 도메인 `app.dopedb.dev` 단일 경로 | `workspace-cloud/wrangler.jsonc` [측정] |
| 운영 migration 진입점 | `scripts/migrate-production.sh` → `scripts/migrate-d1.mjs`. `DATABASE_URL` 또는 `DATABASE_URL_UNPOOLED`가 설정돼 있으면 `exit 1` | [측정] |
| 배포 스크립트 | env 파일에 `DATABASE_URL`/`DATABASE_URL_UNPOOLED`가 있으면 거부 | `scripts/deploy-workspace-cloudflare.mjs:20,81` [측정] |
| 환경 변수 계약 | `.env.example` 첫 줄이 "Workspace metadata uses the WORKSPACE_DB D1 binding". PostgreSQL URL 항목 없음 | [측정] |
| 운영 문서 | "It must contain only names from `.env.example` … and **omit PostgreSQL connection URLs**" | `docs/CLOUDFLARE_OPERATIONS.md:67` [측정] |
| 애플리케이션 DB 진입점 | `lib/db.ts`는 `d1Db`/`queryD1` 위의 얇은 Proxy | [측정] |
| 루트 migration 명령 | `pnpm workspace:migrate` → `scripts/migrate-workspace-service.sh` → `migrate-d1.mjs` | [측정] |
| PostgreSQL migration 러너 | `workspace-cloud/scripts/migrate.mjs`는 package script·import·테스트 어디에서도 참조되지 않는 고아 | `grep` [측정], `workspace-cloud/scripts/AGENTS.md`도 동일 기술 |
| PostgreSQL drizzle 설정 | `drizzle.config.ts`를 참조하는 script/워크플로 0건. `db:generate`/`db:check`는 `drizzle.d1.config.ts`를 가리킨다 | [측정] |
| 죽은 환경 변수 접근자 | `lib/env.ts:144`의 `databaseUrl: () => required("DATABASE_URL")`는 **호출자가 0개** | [측정] |
| migration 이력 | `d1-migrations/`는 `91627d67`(2026-09-09, "D1 이전과 권한 보호를 반영하고 0.4.25로 갱신한다")에서 처음 등장. 이후 `drizzle/*.sql`의 SQL 내용 변경 없음 | `git log` [측정] |

**읽어낸 사실:** 체크인된 설정·배포 스크립트·운영 문서·migration 진입점 어디에도
PostgreSQL 제어 평면을 쓰는 환경이 없다. 배포 경로는 D1 하나뿐이고, PostgreSQL
쪽 도구는 이미 호출자가 끊겨 있다.

**확인하지 못한 것:** 저장소 밖의 실제 운영 콘솔 상태(예: 아직 살아 있는 Neon
프로젝트나 과거 제어 평면 인스턴스의 존재 여부)는 이 조사 범위가 아니다. 폐기를
택한다면 **소유자가 이 한 가지를 직접 확인해야 한다.**

### 1.1 고객 Neon provider adapter와 과거 제어 평면 자산의 구분 (이번에 직접 확인)

이슈 본문은 이 구분을 "파일명과 import 지점에서 온 추론"이라고 유보했다. 이번에
세 파일을 열어 확인했다. [측정]

- `@neondatabase/serverless`는 **`dependencies`** 이며 `lib/providers/neon-api.ts`,
  `neon-bootstrap.ts`, `neon-managed-access.ts` 세 파일이 import 한다.
- 세 파일 모두 `neon(connectionUri)` / `neon(url.toString())` 형태로 **고객의 Neon
  프로젝트**에 접속한다. 모듈 주석이 각각 "Neon control-plane adapter. The encrypted
  API key discovers one project hierarchy and obtains an owner session only long
  enough to create or revoke a constrained role.", "Read-only Neon policy inspection
  and approval-gated, idempotent hardening.", "Neon managed-access adapter: database
  boundary verification and short-lived roles."라고 명시한다. 여기서 말하는
  "control plane"은 **Neon 공급자의 제어 평면**이지 DopeDB 자신의 저장소가 아니다.
- 따라서 이 dependency는 이 결정의 어느 선택지에서도 제거 대상이 **아니다.**

반면 **devDependency** `postgres@3.4.9`는 legacy harness fixture와 고아
`scripts/migrate.mjs`만 쓴다. [측정]

---

## 2. 분리(split)가 양방향임을 실증

### 2.1 식별자 소유권

harness가 참조하는 `workspace_control.*` 식별자는 **38개**이고, 그중 **37개**는
오늘 `d1-migrations/*.sql`이 `CREATE TABLE` 하는 테이블이다. PostgreSQL 전용으로
남은 것은 **`purge_due_workspace` 함수 하나**뿐이며, 이는 fixture의 준비 확인
probe(`to_regprocedure(...)`)만 쓴다. [측정: 15개 harness 소스에서 식별자 추출 후
`d1-migrations/*.sql`의 `CREATE TABLE` 목록과 대조. D1 테이블 총 57개]

### 2.2 쓰기와 단언이 서로 다른 저장소를 본다

격리 클러스터에서 그룹 04 직후 양쪽 저장소를 동시에 세어본 결과다. [측정]

```
SPLIT after 04 :: D1 knowledge_project=0 knowledge_project_environment=0 member=0
               || PostgreSQL knowledge_project=0 knowledge_project_environment=0 member=3
```

fixture가 심은 신원(`member` 3행)은 PostgreSQL에만 있다. 애플리케이션
(`lib/knowledge/personal-scope.ts` → `atomicD1`)은 D1의 `member`를 찾지 못해
scope guard가 걸리고 projection 자체를 거부한다. 그래서 D1 쪽도 0이다. 즉 "쓰기가
D1로 새어나간다"가 아니라 **"전제가 D1에 없어서 쓰기 자체가 일어나지 않는다"**가
지금의 실제 모습이다.

### 2.3 중심 mock이 맞지 않는 클라이언트를 먹인다

그룹 13의 실패가 가장 직접적이다. [측정]

```
Failed query: select max("workspace_data_key"."version") from "workspace_data_key"
  where "workspace_data_key"."organization_id" = $1
CAUSE: relation "workspace_data_key" does not exist
  @ Module.ensureActiveWorkspaceDataKey (lib/workspace-data-key.ts:129)
```

`lib/workspace-data-key.ts`는 fixture가 `vi.doMock("../db", () => ({ db, neonSql }))`로
바꿔치기한 **PostgreSQL 클라이언트**를 통해, `lib/d1/schema`의 **SQLite 테이블
객체로 만든 스키마 무자격 쿼리**를 던진다. PostgreSQL에서 그 테이블은
`workspace_control.workspace_data_key`이므로 없는 관계가 된다. fixture의 중심 mock은
이제 고쳐야 할 대상이지 유지할 수 있는 상태가 아니다.

---

## 3. 14개 시나리오 그룹 표 (실제 실행 결과 포함)

루트 `it()` 하나가 14개 그룹을 순차로 연결하므로 vitest는 "1 test"로 보고한다.
그룹별 결과를 얻기 위해 **저장소를 수정하지 않고** scratchpad에만 존재하는 probe로
같은 순서를 재현하되 실패에서 멈추지 않게 했다. 아래 "실행 결과"는 매 실행마다
새로 만든 빈 격리 DB(migration 적용 직후)에서 측정한 값이다. [측정]

> `BLOCKED`는 "실행하지 못했다"는 뜻이다. 앞선 그룹이 반환해야 할 값
> (`provider`, `analysis`)이 없어서 호출 자체가 불가능한 경우로, **재현된 실패와
> 구분해야 한다.**

| # | 그룹 | 보호 불변식 | 현재 호출 경로 | 실제 실행 결과 [측정] | D1·기타 대응 assertion | 누락 |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | `runProviderImportSupportAssertions` | 크기 제한 JSON 본문 수용·초과·무효 바이트 거부, `private, no-store` 스트리밍 응답, provider/GCP 실패 로그의 secret redaction, KMS core | `lib/http`, `lib/workspace-server-log`, `lib/workspace-kms-core` (DB 무관) | **PASS** | `workspace-server-log`는 `d1-permission-scenarios`·`d1-storage`가 import | `boundedJsonBody`/`privateJsonStream` 단언은 **이 그룹에만** 존재. `workspace-kms-core`를 직접 import 하는 다른 harness 없음 |
| 02 | `runCredentialKeyRotationScenarios` | `drizzle/provider-credential-key-rotation.ts`: 무손실 credential key 재암호화, 3개 provider 테이블 lock, 진행 중 operation·활성 setup session 존재 시 거부, snapshot hash 일치 요구, 전 행 round-trip 검증, 구 runtime 차단 CHECK | PostgreSQL 전용 모듈 (`postgres.Sql` 타입) | **PASS** | **없음.** 이 모듈을 import 하는 파일은 이 시나리오 하나뿐 | 전부. 단 §4.2 참조 |
| 03 | `seedProviderImportPostgresHarness` | fixture 준비(신원·조직·세션 seed), 준비 확인 probe | PostgreSQL 직접 | **PASS** | 해당 없음 (fixture) | 해당 없음 |
| 04 | `runPersonalKnowledgeScenarios` | 개인 Knowledge scope의 workspace/member 권한 고정과 project·environment projection | `lib/knowledge/personal-scope` (D1 `atomicD1`) | **FAIL (재현됨)** `Personal Knowledge scope projection was incomplete` @ `personal-scope.ts:131` | `lib/d1-storage.harness.ts`가 `./knowledge/personal-scope`를 직접 import | 없음 |
| 05 | `runSourceRevisionScenarios` | GitHub source revision 기록: 정확히 한 번, 동일 delivery 재전송 무시, 후퇴 커밋 `advanced=false` | `lib/knowledge/source-revisions` (D1) | **FAIL (재현됨)** `expected [] to deeply equal [{ eventId, sourceId, advanced: true }]` @ `source-revision-scenarios.ts:61` | `lib/d1-storage.harness.ts`가 `./knowledge/source-revisions`를 직접 import | 없음 |
| 06 | `runAuthorityProviderScenarios` | provider import 영수증의 정확히 한 번·정확한 재생, 권한 세션 헤더, runner route, connection grant route | `lib/provider-import-store` 외 (D1) | **FAIL (재현됨)** `expected null to match object` @ `authority-provider-scenarios.ts:103` | `d1-workspace-scenarios.harness.ts`가 `importProviderReceipt`를 직접 import. `workspace_connection_grant`도 같은 파일에서 다룸 | `authoritativeSession*` 헤더 경로를 다루는 harness 없음 |
| 07 | `runAnalysisLifecycleScenarios` | Analysis Article 생성·개정·실행·runner 배정 수명주기 | `workspace-analysis-{article-store,articles,run-store,runner-store,runs,runner-capability}` (D1) | **BLOCKED** (06의 `provider` 필요) | `d1-analysis-scenarios` + `d1-analysis-run-scenarios` + `d1-runner-scenarios`가 같은 모듈군을 검증 | 없음 |
| 08 | `runArticleSharingScenarios` | Article 공유 초대 수락·저장, lease route, connection route, workspace 권한 | `features/articleSharing/{acceptance,store}`, lease/connection route, `lib/workspace-permissions` | **BLOCKED** (06/07 필요) | lease는 `d1-managed-lease-scenarios`와 `control-plane-contracts`가 부분 대응 | **`features/articleSharing/*`를 실행하는 다른 harness/test 없음** |
| 09 | `runAnalysisMemberRemovalScenarios` | 멤버 제거 시 Analysis runner 권한 회수 | `lib/workspace-analysis-runner-capability` (D1) | **BLOCKED** (06/07 필요) | `d1-runner-scenarios.harness.ts`가 멤버 제거 경로를 다룸 | 없음 |
| 10 | `runSyncScenarios` | Desktop↔Cloud sync head/event의 순서와 정확한 재생 | sync 저장 경로 (D1) | **BLOCKED** (06의 `provider` 필요) | `d1-route-scenarios`가 `sync/route`를, `d1-storage`가 `workspace_sync_head.last_sequence`를, `control-plane-contracts`가 strict sync golden 디코딩을 검증 | 그룹 10 고유 조합(provider 영수증 이후의 sync 전개)은 재현 안 됨 |
| 11 | `runProviderOperationScenarios` | provider operation plan/실행 claim/조정/bootstrap, Neon branch switch, import projection, versioning | 다수 (D1) | **BLOCKED** (06의 `provider` 필요) | `d1-operation-scenarios` + `d1-switch-scenarios` + `d1-integration-scenarios` + `d1-versioning-scenarios` | 없음 |
| 12 | `runConnectionVersioningScenarios` | 연결 개정·정본 hash·mutation gate, 감사 이벤트 1건, resource version 2건 | `lib/workspace-versioning{,-store}` (D1) | **FAIL (재현됨)** `expected null to match object` @ `connection-versioning-scenarios.ts:42` (`commitConnectionMutation`이 D1을 읽어 `null`) | `d1-versioning-scenarios.harness.ts` | 없음 |
| 13 | `runWorkspaceLifecycleScenarios` | workspace DEK 버전·회전, 백업, 수명주기/보존 | `workspace-data-key{,-rotation}`, `workspace-backup`, `workspace-lifecycle` (D1) | **FAIL (재현됨)** `relation "workspace_data_key" does not exist` @ `workspace-data-key.ts:129` | `d1-backup-scenarios` + `d1-lifecycle-scenarios` | 없음 |
| 14 | `assertProviderSecretIsNotDurable` | provider secret이 `workspace_connection`·`workspace_provider_import_request`·`workspace_audit_event`·`workspace_resource_version`에 durable하게 남지 않음 | PostgreSQL 직접 스캔 | **PASS — 단, 공허함(vacuous)** | `control-plane-contracts.harness.ts:444`가 **요청 본문** 수준의 `not.toContain("secret-id-1234")`를 검증 | **durable row 스캔 단언은 어디에도 없다** |

### 3.1 그룹 14의 PASS를 성공으로 읽으면 안 되는 이유

`assertProviderSecretIsNotDurable`은 PostgreSQL의 네 테이블을 `to_jsonb(...)::text
LIKE '%<secret>%'`로 스캔해 "누출 없음"을 단언한다. 그런데 그 테이블에 행을 만드는
그룹 06이 실패하고, 애플리케이션은 애초에 그 행을 D1에 쓴다. 그래서 이 단언은
**"누출 없음"과 "데이터 없음"을 구분하지 못한다.** 현재의 PASS는 false-green이며,
이 그룹을 "아직 통과하니 가치가 있다"는 근거로 쓰면 안 된다.

같은 이유로 그룹 01의 PASS는 DB와 무관해서 진짜 통과이고, 그룹 02·03의 PASS는
PostgreSQL 안에서 닫혀 있어서 진짜 통과다. **PASS 4건을 한 덩어리로 다루면 안 된다.**

### 3.2 실행 순서에 따른 주의

probe는 한 번의 실행에서 순차로 진행하므로 앞 그룹이 남긴 상태가 뒤 그룹에
영향을 줄 수 있다. 실제로 이미 한 번 harness를 돌린 DB에서 다시 돌리면 그룹 02가
`Credential key does not match envelope`로 실패한다(키가 이미 회전된 상태). 위 표는
**매번 새로 만든 빈 DB**에서 얻은 값이다. [측정]

---

## 4. 선택지를 그룹별로 나눈 결과

전체 이식 또는 전체 폐기 두 가지가 아니다. 증거는 세 갈래로 나뉜다.

### 4.1 (a) 선별 이식 대상 — 고유한 안전·권한·원자성·복구 검증

| 그룹 | 왜 고유한가 | 이식 시 필요한 형태 |
| --- | --- | --- |
| 01 | `boundedJsonBody`(크기 초과 `too_large`, 무효 UTF-8 `invalid`)와 `privateJsonStream`(`private, no-store`, 대용량/`NaN`/`undefined` 직렬화 동일성), provider·GCP 실패 로그 redaction을 검사하는 곳이 여기뿐이다. **DB와 무관하므로 이식 비용이 사실상 0이다** | 기존 `control-plane-contracts.harness.ts`의 case로 흡수. 새 파일·새 예산 필요 없음 |
| 08 | `features/articleSharing/{acceptance,store}`를 실행하는 자동 검증이 이것뿐이다. Article 공유 초대 수락은 접근 권한이 사람을 넘어가는 지점이라 §2 제품 축상 안전 불변식에 해당한다 | D1 기반 `d1-analysis-scenarios` 계열에 초대 수락·거부·만료 assertion으로 추가 |
| 14 | secret durable 비지속성의 **행 수준** 스캔. 요청 수준 단언(`control-plane-contracts:444`)은 저장 여부를 보지 않는다 | D1 테이블을 같은 방식으로 스캔하는 assertion으로 재작성. 지금처럼 빈 테이블에서 통과하지 않도록 **먼저 secret이 실제로 저장 경로를 통과했음을 확인한 뒤** 스캔해야 한다 |
| 06 (일부) | `authoritativeSession`/`authoritativeSessionHeaders` 경로를 다루는 harness가 없다 | `d1-workspace-scenarios`의 import 영수증 검증에 권한 세션 헤더 케이스 추가 |

### 4.2 (b) 아직 쓰이는 존치 대상 PostgreSQL 계약

| 자산 | 상태 | 판단 |
| --- | --- | --- |
| `drizzle/provider-credential-key-rotation.ts` (160줄) + 그룹 02 | **격리 DB에서 지금도 통과한다** [측정]. 운영자 전용 도구이며 HTTP route가 없고 D1 Worker가 import 하지 않는다 | 이 도구가 보호하는 것은 **PostgreSQL 제어 평면의 credential 봉투 재암호화**다. §1에 따르면 그런 제어 평면을 쓰는 배포가 체크인된 설정에는 없다. **운영 콘솔 실체 확인이 이 자산의 존치 여부를 결정한다.** 확인 전에는 삭제하지 않는다 |
| `drizzle/0000_mvp_baseline.sql`, `0001_article_sharing.sql` (1,678줄) | 어느 script도 참조하지 않지만 migration 이력 자체다 | 이력 보존이 목적이면 코드가 아니라 기록으로 남길 수 있다. 다만 harness fixture가 이 두 파일로 스키마를 만든다 |
| `drizzle/postgres-schema/` (20 파일, 2,905줄) + `schema.postgres.ts` | `drizzle.config.ts`와 harness fixture만 참조 | `drizzle.config.ts`를 참조하는 script가 0건이므로 migration tooling 쪽은 이미 고아 [측정] |

### 4.3 (c) 증거상 폐기 후보

| 자산 | 폐기 근거 [측정] | 대체 검증 | 운영/복구 경로 영향 |
| --- | --- | --- | --- |
| 그룹 04·05·07·09·10·11·12·13 | 같은 애플리케이션 모듈을 D1 harness가 이미 실행한다(표의 "대응 assertion" 열). PostgreSQL 쪽에서는 **전부 실패하거나 도달 불가**라 회귀 방지망으로 동작하지 않는다 | `d1-storage.harness.ts`(→ 9개 helper), `control-plane-contracts.harness.ts`. 이 13개 case는 CI에서 실제로 실행·통과한다 [측정, [0002](0002-harness-test-budget-policy.md) §2] | 없음. 운영 migration은 `migrate-d1.mjs`뿐이고 `scripts/test-provider-import-d1.sh`가 필수 CI에서 그 진입점을 검증한다 |
| `workspace-cloud/scripts/migrate.mjs` (114줄) | package script·import·테스트 참조 0건 | 없음(대체 필요 없음) | 운영 migration 경로가 아니다. `migrate-production.sh`는 PostgreSQL URL이 있으면 거부한다 |
| `lib/env.ts:144` `databaseUrl` | 호출자 0건 | 없음 | 없음 |
| fixture mock의 `neonSql` export | 애플리케이션 어디에도 `neonSql` 식별자가 없다 | 없음 | 없음 |

**폐기 후보에도 조건이 붙는다.** 위 표의 첫 행을 폐기하려면 §4.1의 (a) 4건을
먼저 D1 쪽으로 옮겨야 한다. 그러지 않으면 `features/articleSharing`, `lib/http`
경계, secret durable 스캔, 권한 세션 헤더의 자동 검증이 **순수 손실**로 사라진다.

---

## 5. 이식 비용 재산정 (이슈 본문 수치를 쓰지 않고 다시 측정)

| 구성요소 | 이번 측정값 | 비고 |
| --- | --- | --- |
| 타입 캐스트 총계 | **183** | `::uuid` 104, `::int` 40, `::jsonb` 20, `::text` 9, `::timestamptz` 6, `::regclass` 4 |
| `now()` | **34** | |
| `interval` | **18** | |
| jsonb 연산자·함수 | **14** | `->>` 10, `to_jsonb` 4 |
| `sql.begin` 콜백 트랜잭션 | **12** | |
| `RETURNING` | **4** | |
| `FILTER (WHERE ...)` | **2** | |
| advisory lock | **1** | |
| 태그드 SQL 리터럴(`` sql` ``) | **50** | 이슈 본문의 "112 tagged SQL literal"과 세는 단위가 다르다. 이 값은 `` sql` `` 호출 지점 수다 |

**캐스트 제거가 검증 완전성을 유지한다고 가정하지 않는다.** SQLite는 동적 타입이라
`::int`/`::uuid`/`::timestamptz`가 사라지면 "정수였다", "UUID였다", "타임스탬프였다"를
단언하던 지점이 타입 없는 비교로 바뀐다. 특히 `count(*)::int`는 값 비교로
대체되지만, `${connectionId}::uuid`처럼 **입력 형식을 강제하던 캐스트**는 대응물이
없다. `sql.begin` 12개는 D1에 콜백 트랜잭션이 없어 `atomicD1`의 사전 선언 batch로
**번역이 아니라 재구성**해야 한다.

### 5.1 line ratchet 현황

| 항목 | 값 [측정] |
| --- | --- |
| harness 소스 실제 합계 (15개 파일) | **3,049줄** |
| `PROVIDER_IMPORT_POSTGRES_HARNESS_TOTAL_LINE_LIMIT` | **3,057** |
| 남은 여유 | **8줄** |

가드는 파일별 상한도 함께 강제한다. 여유가 가장 큰 파일은
`personal-knowledge-scenarios.ts`(43/80)이고, 가장 빡빡한 것은 루트
`provider-import-postgres.harness.ts`(69/70)와 `provider-import-postgres-harness.setup.ts`(57/57)다.

**상한은 올리지 않았다.** 가드 소스 주석 자체가 "Do not raise this constant to make
code fit."라고 못박고 있다. 전체 이식은 기존 파일 안에서 8줄로는 불가능하므로,
이식을 택하면 **상한 상향이 아니라 대상 디렉터리 이동(예: D1 harness 계열로 흡수)**이
전제가 된다.

---

## 6. 이 조사에서 실행한 명령과 출력

```sh
# 격리 클러스터 (PostgreSQL 15.15, 임시 디렉터리, 127.0.0.1 전용, unix socket 없음)
initdb -D <scratch>/data -U harness_owner -A trust --no-locale --encoding=UTF8
pg_ctl -D <scratch>/data -w -o "-p 55480 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
psql -f workspace-cloud/drizzle/0000_mvp_baseline.sql   # 0000 ok, NOTICE 43건(식별자 절단)만
psql -f workspace-cloud/drizzle/0001_article_sharing.sql # 0001 ok
# provider_harness.isolated_database_sentinel 에 실행별 sentinel 1행

node workspace-cloud/scripts/run-provider-import-postgres-harness.mjs
#  × imports once, replays exactly, and rejects stale authority without leaking credentials
#  Error: Personal Knowledge scope projection was incomplete
#  Test Files 1 failed (1) / Tests 1 failed (1) / EXIT=1
```

`0000`/`0001`은 PostgreSQL 15.15에서 **식별자 절단 NOTICE 43건만 내고 통과**한다.
따라서 이 migration에서 나오는 오류는 잡음이 아니라 실제 회귀로 읽어야 한다. [측정]

그룹별 결과는 저장소를 수정하지 않는 scratchpad probe로 측정했다(§3). probe는
커밋하지 않았고 실행 후 워크트리는 깨끗하다(`git status --short --branch` 출력 없음). [측정]

---

## 7. 소유자가 고를 수 있는 선택지

| | 선택지 | 하는 일 | 비용 | 남는 위험 |
| --- | --- | --- | --- | --- |
| A | **전면 존치 + 이식** | 14개 그룹을 모두 D1로 옮긴다 | §5의 변환 비용 전부. line ratchet 8줄로는 불가능해 대상 재배치 필요. 이식 후 04·05·07·09·10·11·12·13은 D1 harness와 중복 | 중복 검증을 유지·관리하는 상시 비용. PostgreSQL 회귀 방지망이라는 원래 목적은 사라진다 |
| B | **선별 이식 후 나머지 폐기** | §4.1의 01·08·14·06(일부)를 기존 D1/contract harness case로 흡수한 뒤, §4.3의 폐기 후보를 정리한다. §4.2는 운영 콘솔 확인 결과에 따른다 | 중간. 새 파일 없이 기존 harness case 확장으로 가능 | 흡수 과정에서 assertion을 옮기다 약화될 수 있다. 흡수가 끝나기 전에 폐기하면 순수 손실 |
| C | **전면 폐기** | suite와 고아 PostgreSQL 자산을 정리한다 | 가장 작다 | `features/articleSharing`, `lib/http` 경계, secret durable 스캔, 권한 세션 헤더의 자동 검증이 사라진다. §4.2의 credential rotation 도구는 운영 콘솔 확인 없이 지우면 복구 수단을 잃을 수 있다 |
| D | **현행 유지(결정 보류)** | 아무것도 바꾸지 않는다 | 0 | 14개 그룹 중 실제로 지키는 것이 01·02·03뿐인 상태가 계속된다. 그룹 14의 false-green이 문서상 "검증됨"으로 읽힐 위험이 남는다 |

### 권고 (근거 포함, 결정 아님)

- **B를 권고한다.** 근거는 셋이다. (1) 폐기 후보 8개 그룹은 같은 애플리케이션
  모듈을 D1 harness가 이미 실행·통과시키고 있어 대체 검증이 실증되었다(추정이
  아니라 CI에서 실제로 도는 13개 case다). (2) 고유 가치가 남은 것은 4건뿐이고 그중 01은
  DB와 무관해 이식 비용이 사실상 0이다. (3) 전면 이식(A)은 §5의 비용을 치르고도
  결과물이 D1 중복 검증이라 얻는 것이 없다.
- **B를 택하더라도 순서가 중요하다.** §4.1의 흡수를 **먼저** 끝내고, 그 다음에
  §4.3을 정리한다. 반대 순서는 검증 공백을 만든다.
- **§4.2(credential rotation 도구)는 코드 조사만으로 결정할 수 없다.** 운영 콘솔에
  PostgreSQL 제어 평면 인스턴스가 실재하는지 소유자가 확인해야 한다.

### 소유자가 결정해야 할 정확한 질문

**PostgreSQL provider-import harness 14개 그룹 중 §4.1이 고유하다고 지목한 4건
(그룹 01·08·14 및 06의 권한 세션 헤더)을 D1·contract harness로 먼저 흡수한 뒤
나머지 PostgreSQL 자산을 정리하는 안(B)을 채택할 것인가, 아니면 전면 이식(A)
또는 전면 폐기(C)를 택할 것인가 — 그리고 `drizzle/provider-credential-key-rotation.ts`를
남길지 판단하기 위해 PostgreSQL 제어 평면을 쓰는 운영 인스턴스가 실재하는지
확인해 줄 수 있는가?**
