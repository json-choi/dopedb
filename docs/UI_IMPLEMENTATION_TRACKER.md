# UI 구현 상태 트래커

이 문서는 [`PRODUCT_UI_SCOPE.md`](./PRODUCT_UI_SCOPE.md)가 허용한 화면의 현재 구현
상태와 소유 경계를 기록한다. 외부 제품과의 기능 개수나 시각 유사도를 평가하지
않는다. 검수는 같은 DopeDB scenario의 전후 상태, accessibility tree, packaged
runtime과 성능 수치로 수행한다.

2026-09-05 전체 실행·접근성 tree·소스 대조에서 닫은 결함과 영구 회귀 조건은
[`UI_UX_AUDIT.md`](./UI_UX_AUDIT.md)가 소유한다.

## 상태

- `complete`: 실제 command와 authoritative state owner가 있고 자동·수동 검수가 끝남
- `partial`: 핵심 경로는 동작하지만 아래 명시된 acceptance gap이 남음
- `missing`: 범위에는 속하지만 아직 구현하지 않음
- `out-of-scope`: 제품 범위 결정상 화면이나 placeholder를 만들지 않음

## 화면 상태

MVP의 provider import는 항상 새 managed connection을 만든다. 기존
member-local connection을 선택해 ID와 참조를 보존하는 전환 단계는 UI/API 범위에
없다. 이미 관리형인 exact DB의 provider 권한 복구는 별도 현재 기능으로 유지한다.

| 영역 | 상태 | 현재 소유자 | 남은 acceptance gap |
| --- | --- | --- | --- |
| App shell/chrome | `complete` | `features/appShell`, design-system chrome primitives | Knowledge 화면에서는 과거 DB breadcrumb를 제거하고, Agent overlay 진입 시 Services를 닫는 단일 작업 주체 규칙을 유지한다. packaged macOS·Windows에서 keyboard launcher와 compact window를 정기 확인 |
| Action Search | `complete` | `features/actionSearch` | cached catalog scope, `/` action mode, focus 복구와 bounded top-k를 유지 |
| Welcome document | `complete` | `screens/Onboarding`, `features/onboarding` | 준비된 Demo는 학습 command 3개만, 연결된 상태는 New Query만, 미연결 상태는 New connection과 사용 가능한 Guided Demo만 보여 준다. 전역 Action Search를 반복하지 않고 command 행의 아이콘·경계·focus 상태를 유지한다. Personal 가이드 데모의 idempotent DB·Project·Environment·binding 준비와 상태별 command 집합을 packaged smoke에서 확인 |
| Workspace account authentication | `partial` | `features/workspaces/WorkspaceAccount`, native workspace deep-link adapter, `workspace-cloud/app/auth/device` | 브라우저 승인 완료 화면은 비밀값 없는 `dopedb://auth/device-complete`로 기존 앱을 활성화하고 즉시 서버 polling을 실행하며 자동 호출이 막힐 때 수동 앱 열기 action을 유지한다. production/dev/benchmark URL scheme 분리와 payload 거절은 자동 검수한다. 실제 Google 승인 왕복을 packaged macOS·Windows에서 확인하면 `complete`로 전환한다. |
| Workspace Web administration | `complete` | `workspace-cloud/app/settings`, `workspace-cloud/features/providerAccess` | 최상위 목적지를 Workspaces, Access, Providers, Workspace settings, My account로 한정한다. 멤버·DB grant와 provider 승인·managed DB를 각각 한 흐름으로 묶고, Analysis 관리는 Desktop에만 둔다. compact header, 한 번의 workspace context, flat section과 revision conflict의 단일 경계를 유지한다. lifecycle은 Backup → key → retention 순서이며 삭제 blocker가 있으면 복구 link만 보여 주고 exact-name 확인 form은 숨긴다. provider 실계정 mutation 검수는 Provider account access 행에서 계속 추적한다. |
| Database Explorer | `complete` | `screens/Connections/DatabaseExplorer`, `features/catalogExplorer` | 검색 결과 key가 실제로 있을 때만 search-active가 되며 문서 선택과 검색 focus를 구분한다. Project 바로 아래의 단일 Databases/Data sources/Analyses 계층, workspace당 connection 하나의 active Project binding, DB 행의 exact-binding 제거, connection 보존·source/grant 폐기·pinned Agent session 중단·active Article 차단을 지키는 Project 삭제, DB 행에만 보이는 Environment marker와 같은 schema group의 Diff 진입점을 유지한다. 배정된 DB 행의 pointer drag·행 메뉴·Option/Alt+위/아래 화살표는 구성원·기기별 표시 순서만 바꾸고 같은 schema group을 production→staging→development→test/custom 연속 블록으로 유지하며 Project·Environment binding을 변경하지 않는다. drag preview·dimming·live announcement는 그 블록 전체를 한 대상으로 표시한다. Project/resource 행은 28px로 맞추고 Project 14px·650, resource folder 13px·550, DB·source·article leaf 13px·450의 Pretendard Variable 계층을 사용한다. provider target과 24px tree action은 한 줄에 머물러 action 유무가 DB 행 높이를 바꾸지 않는다. BigQuery의 일반 access token 갱신은 공식 CLI가 자동 처리하고, Google이 사람의 재인증을 요구하면 local 및 Project-shared member-local 연결 모두 외부 터미널 없이 같은 app-managed 공식 CLI 브라우저 흐름으로 복구한다. 재인증·조회 실패 안내는 복구 버튼 위에 표시해 좁은 Explorer에서도 메시지 폭을 보장한다. Google 계정 CLI profile은 exact Workspace·구성원 범위, 서비스 계정 profile은 개별 member-local connection binding 범위로 격리한다. Unassigned→환경 DB 행 또는 Project Databases folder의 preferred exact Environment binding drag는 Team-local 연결을 비밀값 없는 shared identity로 먼저 승격하고, 실패 시 롤백하며, 성공 시 기존 로컬 복사본을 정리한다. member Google CLI 인증은 기기에 남는다. loaded-only 객체 검색·대형 catalog selection/scroll을 packaged smoke에서 확인한다. |
| Connection editor | `complete` | `features/connections/useConnectionEditorController` | 새 연결의 provider catalog는 실제 command가 있는 항목만 보여 주고 정보 화면은 `닫기`로 끝낸다. 이름 오류는 편집 또는 Save/Test 시도 뒤에만 공개한다. 연결 identity·접속 옵션만 소유하고 쓰기 실행 제어는 Settings → Safety 단일 경계를 유지한다. Workspace 관리형 연결은 내부 placeholder endpoint를 숨기고 관리 주체와 구성원별 단기 lease를 설명하며, `manage` 권한 보유자는 Workspace Web의 exact DB 복구 command로 이동한다. BigQuery는 별도 CLI 선행 설치 없이 SDK와 Python 버전이 고정된 앱 전용 official runtime을 최초 연결 때 준비하고, 직접 ID 입력, 공식 `gcloud` 브라우저 인증, `gcloud --cred-file` 서비스 계정 연결과 실제 project/dataset selector를 제공한다. 앱이 Google token이나 key file을 소유하지 않는지 macOS arm64/x64·Windows x64 packaged runtime에서 유지 검수한다. |
| Provider account access | `complete` | `workspace-cloud/features/providerAccess`, provider application modules | exact DB 행에서 GCP OAuth를 다시 시작하고 기존 integration·project·instance를 고정해 IAM DB 인증과 전용 사용자를 복구한 뒤 같은 행으로 돌아오는 흐름을 유지한다. PostgreSQL은 read/write와 분리된 schema service account, stable IAM database owner, 10분 lease, exact IAM·DB drift 검증까지 같은 복구에서 프로비저닝하고, 이 principal이 없는 기존 연결은 schema lease를 fail-closed 거절한다. Cloud SQL MySQL은 schema 미지원으로 유지한다. OAuth 재승인은 인스턴스 변경과 구분하고, IAM 인증 flag 변경 승인은 실제 설정 변경만 설명하며 재시작이 필요 없는 flag를 재시작 위험으로 과장하지 않는다. 강제 폐기할 수 없는 활성 Cloud SQL IAM DB 자격증명이 있으면 Google 설정 변경 전에 정확한 개수·최종 만료 시각·OAuth 재승인 필요 여부를 표시하고, 같은 조건을 최종 저장 gate에서도 다시 확인한다. 설정 승인은 최대 lease 만료 뒤 안전한 완료 여유까지 유지하되 Google token 자체의 만료를 넘기지 않는다. Cloud SQL privilege bootstrap은 승인한 관리자의 단기 OAuth 신원을 권한 복구용 Data API 실행자로만 사용하고 임시 IAM DB 사용자와 원래 role을 정확히 복구한다. 권한 복구 transaction은 exact schema role로 전환해 database-local 세션 기본값까지 설치한 뒤 setup role을 복구하며, Desktop은 schema IAM role에 임시 구성원이 남거나 다른 role이 결합되면 연결을 거절한다. Workspace Web은 관리 panel의 24px(좁은 화면 16px) gutter를 공유하고 DB 요약·action의 2열 기준선을 유지하며, 긴 복구 안내는 그 아래 전체 폭 행에 표시한다. 실제 계정 OAuth/CLI 실패·recovery와 allowlisted Vault AppRole의 role/lease/revoke packaged 검수를 유지한다. |
| SQL/MongoDB query workflow | `complete` | `features/queries`, `features/documentQueries`, `screens/Sql`, `screens/Documents`, Rust query application | SQLite 경로는 기본 화면에서 basename으로만 표시하고 MongoDB limit는 문자열 draft를 보존한 뒤 blur/실행에서 검증한다. 수동 Run exact 승인, Agent 제안 분리, MongoDB의 지속되는 조회 surface와 collection 없는 정확한 빈 상태, 10 KiB/100 KiB/1 MiB 입력과 cancel/transaction packaged 검수를 유지 |
| Result/Data grid | `complete` | `features/queryResults`, Rust result artifact | WHERE/ORDER BY는 입력 경계·focus·dirty 상태를 드러내고, 행 범위·전체 수·잘림·실행 시간은 tooltip 없이 floating footer에 표시하며 마지막 cell을 덮지 않는다. 30열·50,000행 selection/filter/export와 메모리 경계를 검수 |
| Services/Jobs | `complete` | `features/queryServices`, `features/jobs` | 비로그인 Personal 실행은 현재 process의 session/result를 즉시 보여 주되 계정 범위 영속화는 하지 않는다. Import/Export의 header와 주 동작은 고정하고 내용만 scroll한다. background cancel과 복원된 result handle, 쓰기 권한 차단 시 exact DB의 필요한 권한 계층·`Settings → Safety` 복구 진입을 검수한다. 관리형 DDL 실패도 별도 권한 창을 만들지 않고 동일한 Safety 단계와 provider 지원 여부로 복구한다. |
| Agent tool window | `partial` | `features/agents`, ACP Rust runtime | overlay 진입 시 Services를 닫고 adapter가 없을 때 설정 CTA는 하나만 보여 준다. 한 Project의 DB·BigQuery·GitHub source를 개별/다중 선택하고 trigger에 Project·선택 개수·단일 쓰기 대상을 계속 표시한다. 선택하지 않은 resource 차단, connection별 독립 read, 단일 write target, 공식 adapter 설치·실행 계약 호환성·로그아웃·permission·resume, resource 선택의 즉시 반영과 입력창을 유지하는 백그라운드 선행 준비, 동일 권한 focus-refresh 연속성, 저장 분석 요청의 Article verify/propose 영수증과 실제 Article 도구명에만 대응하는 저장 상태 표시를 packaged runtime에서 검수하면 `complete`로 복귀 |
| External Agent approval | `partial` | `features/agents/ExternalAgentRequestGate`, `dopedb-cli`, Local Broker | `agent init`의 secret-free config 생성, `agent start`의 immutable resource 재검토, token 없는 process-bound MCP 주입·종료 revoke는 자동 회귀 검수한다. macOS/Windows packaged CLI에서 Codex/Claude 각각의 실제 로그인·승인·종료 흐름을 검수하면 `complete`로 전환한다. |
| Knowledge graph | `partial` | Rust `features/knowledge`, frontend Knowledge source projection | exact-commit GitHub 탐색과 Local source revision은 유지한다. 그래프 구성·매핑 검토 UI·exact graph grant는 benchmark와 entitlement 결정 뒤 새 실행 설계로 구현하고 packaged 검수한다. |
| Analysis Article | `partial` | `features/analysisArticles`, cloud analysis application | unavailable Personal 범위에서는 Explorer 필터를 숨기고 로그인/Workspace 선택 복구 동작과 중립 Project/Analysis status context를 보여 준다. 사용자 상태·revision·결과 제한 문구는 i18n presentation mapping을 거친다. Explorer 소유 문자·상태 필터와 단일 중앙 HTML document, exact 단일 query의 로컬 수동 재조회, immutable public HTML 발행과 raw run timestamp의 RFC3339 응답을 실제 환경에서 검수 |
| Settings | `complete` | `features/settings`, `features/safetySettings` | 개인정보 설명은 수집 제외·공유·전송/보관·철회 효과를 의미별 description list로 유지한다. 700px 이하에서는 검색·tree·breadcrumb 대신 한 줄 section select를 사용한다. Desktop `Settings → Safety` 하나에서 항상 켜진 읽기와 누적 DML·DDL 권한을 체크박스로 표시한다. DDL은 DML을 필요로 하고 DML 해제 시 함께 꺼지며, 중복 상태 badge 없이 관리자용 workspace 상한 + 기기 gate를 한 번의 적용 동작으로 fail-closed 저장하고 미적용 변경을 표시한다. 관리형 DDL은 exact `manage` grant와 검증된 Neon 또는 GCP Cloud SQL PostgreSQL schema lease가 있을 때만 열고, 지원하지 않는 provider·engine과 복구 전 GCP 연결의 실행 오류도 exact 연결의 이 화면으로 이동해 사용 가능한 권한과 제한 이유를 보여준다. provider/연결/오류 화면은 별도 변경 control을 만들지 않으며 웹 DB 접근 화면은 같은 상한을 상태로만 표시한다. compact viewport 검수 |
| Diagnostics/Recovery | `complete` | design-system diagnostics, feature recovery boundaries | failure injection에서 오류 owner와 retry가 유지되는지 확인한다. Workspace managed lease·provider 실패는 로컬 host/password 오류와 구분하고 관리자용 exact Web recovery와 일반 구성원용 관리자 요청을 유지한다. |

## 공용 UI 계약

| 계약 | 상태 | 검증 |
| --- | --- | --- |
| semantic token과 raw color 차단 | `complete` | `pnpm check:ui-palette` |
| 공용 icon command/accessible name | `complete` | `pnpm check:ui-primitives` |
| static Tailwind v4 utility | `complete` | build와 source guard |
| modal focus containment/trigger 복구·명시적 footer 종료 | `complete` | browser interaction smoke, 공용 `ModalHeader`/`ModalFooter` primitive |
| popup/menu viewport collision | `complete` | 공용 popup/menu primitive |
| grid composite keyboard/resize separator | `complete` | 공용 roving helper, `ResizeSeparator`, packaged interaction smoke |
| grouped AppShell presentation contract | `complete` | `pnpm check:architecture` |
| generic UI의 feature/adapter 비의존 | `complete` | transitive architecture guard |
| critical test 예산 | `complete` | `pnpm check:test-budget` |

## 핵심 사용자 시나리오

### 1. 처음 연결

1. 실제 데이터 소스는 Welcome에서 새 연결을 열고 engine과 검증된 최소 필드만
   입력한다. 제품을 먼저 체험하려면 Personal Workspace에서 가이드 데모를 한 번
   실행한다.
2. 가이드 데모는 파일 기반 Demo SQLite를 검증하고 `DopeDB Demo → Sandbox`의
   로컬 Environment와 exact binding을 준비한다. 다시 실행해도 기존 자원을
   재사용한다.
3. Test가 실패하면 입력 가까이에서 원인과 recovery를 본다.
4. Apply/OK 또는 데모 준비 후 Explorer, table, query, Agent가 같은 connection
   identity와 Environment binding을 사용한다.

BigQuery는 이미 알고 있는 project/dataset ID를 직접 입력하거나, 공식 `gcloud`
브라우저 로그인을 실행한 뒤 현재 계정이 접근할 수 있는 project와 dataset을
`gcloud`/`bq` 결과로 채운 실제 selector에서 선택한다. 시스템 SDK와 Python 설치에 의존하지 않고
DopeDB가 OS·architecture별 pinned 공식 runtime을 app-owned 경로에 최초 1회 준비하므로
별도 CLI 설치나 PATH 설정이 필요 없다. 서비스 계정은 선택한 JSON 경로를 공식
`gcloud auth login --cred-file` 명령에 일회성으로 넘기며, 연결별 로컬 CLI 프로필을
사용한다.

Acceptance: 임의 고급 옵션, 계획 중 provider, 저장되지 않는 가짜 control이 없어야
하며 장기 secret은 shared record에 들어가지 않는다. BigQuery 연결 과정에서도 앱은
Google token, refresh token, service-account key 내용이나 경로를 읽거나 저장하지 않는다. 데모도 team membership,
credential, 공유 권한을 꾸며내지 않고 실제 local command만 사용한다.

### 2. 공유 연결 사용

1. workspace의 redacted connection revision을 선택한다.
2. 구성원은 member-local secret을 바인딩하거나 허용된 provider/Vault broker의
   구성원별 managed lease를 받는다. Vault AppRole과 공용 DB 비밀번호는 Desktop으로
   전달되지 않는다.
3. Explorer, query, Agent가 같은 workspace/account/connection revision을 사용한다.
4. revoke나 revision 변경 뒤 stale cache와 실행 권한이 재사용되지 않는다.

Acceptance: account integration 조회 실패가 shared connection inventory 전체를
무너뜨리지 않고, 권한과 credential lifetime이 화면 상태와 일치해야 한다.

### 3. Query와 결과 관찰

1. SQL document에서 Run 또는 안전한 statement preview를 실행한다.
2. parameter와 manual transaction 상태를 확인한다. 사용자가 작성한 SQL은 Run이
   exact 승인이고, Agent가 제안한 mutation만 별도 승인·거절한다.
3. streaming result를 grid에서 선택·복사·filter하고 Services에서 작업을 관찰한다.
4. 큰 결과는 native artifact와 streaming export를 사용하고 renderer가 전체 row를
   보관하지 않는다.

Acceptance: cancel 후 connection을 검증 없이 재사용하지 않고 write outcome이
불명확하면 `outcome_unknown`을 보존한다.

### 4. Agent 작업

1. 한 Project 안에서 필요한 DB·BigQuery·GitHub source를 개별 또는 다중 선택하면 trigger에 Project, DB/source 수와 쓰기 대상 유무를 계속 표시하고 공식 ACP adapter를 선행 준비한 뒤 첫 prompt를 같은 제출 흐름에서 전송한다. 내부 Project Environment identity는 계층으로 노출하지 않고 DB 행의 dev/staging/prod marker로만 설명한다.
2. Desktop이 선택한 connection/source/Environment revision 집합과 선택적인 단일 write target을 하나의 exact grant로 immutable pin한다. 선택하지 않은 resource는 접근할 수 없고 여러 DB read는 독립 operation으로 실행한다.
3. 화면은 tool 진행, permission, result, 중단과 복구를 보여준다. 중간 추론은 기본 화면에서 숨기며 debug details에서만 확인한다. 추론 문장의 단어로 DB 실행이나 변경을 추정하지 않으며, 실제 operation 표시는 tool identity에서만 만든다.
4. provider 인증은 로컬 CLI가 소유하며 앱은 token을 읽거나 login UI를 만들지 않는다.
5. Desktop 밖에서는 Project root에서 `dopedb agent init --provider codex|claude`로
   secret-free config를 만들고 `dopedb agent start -- <provider args>`를 실행한다.
   Desktop은 시작 때마다 저장된 exact resource set을 현재 상태로 다시 보여주며,
   승인 뒤 공식 CLI process tree에만 runtime-only 권한을 부여하고 종료 시 폐기한다.

Acceptance: general MCP server, arbitrary provider API, 승인 우회 mode와 stale session
focus가 없어야 한다.

### 5. Knowledge와 Analysis Article

1. GitHub repository 또는 Local Folder를 Project Environment에 연결한다.
2. deterministic extraction이 immutable graph revision과 evidence anchor를 만든다.
3. Agent는 exact connection grant에서 sanitized HTML Article과 단일 bounded
   read query를 제안한다.
4. 사람은 Desktop에서 query를 수동 재조회하고 immutable public HTML을 발행한다.

Acceptance: public article은 query, result row, credential 없이 immutable sanitized
HTML snapshot만 읽고 재조회 command는 인증된 Desktop에만 존재한다.

## 트래커 갱신 규칙

- 화면을 바꾸면 해당 행의 상태, owner, 남은 gap을 같은 변경에서 갱신한다.
- `complete`는 build 통과만 뜻하지 않는다. 실제 command/state owner와 변경 위험에
  비례한 runtime 검수가 모두 필요하다.
- `missing`은 구현된 것처럼 보이는 disabled control로 대체하지 않는다.
- 시점별 긴 작업 일지, 외부 비교 screenshot, 임시 hash는 이 문서에 누적하지 않는다.
  재현 가능한 영구 계약은 ADR, test, architecture guard 또는 제품 scope로 승격한다.
