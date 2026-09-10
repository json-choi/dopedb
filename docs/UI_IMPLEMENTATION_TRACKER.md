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

## 공개 소개 사이트

- 상태: `partial` — 승인된 은하 디자인을 기존 Next.js/OpenNext 사이트에 적용했다.
  검색 수집·실사용 Core Web Vitals 검증은 아직 하지 않았다. 운영 반영은
  Git 푸시와 별개로 Worker 배포 및 운영 도메인의 배포 영수증 일치로 확인한다.
- 소유자: `site/app/page.tsx`는 언어·metadata·JSON-LD,
  `HomeSections.tsx`는 서버 본문, `GalaxyHero.tsx`는 지연 로드 장식,
  `HomeScopeWalkthrough.tsx`는 실제 DB와 연결되지 않는 설명용 reducer를 소유한다.
- 2026-09-10 로컬 production build 검수: 한·영 초기 HTTP HTML의 H1·FAQ 4개,
  canonical·hreflang·OG·WebSite/SoftwareApplication JSON-LD와 정상 404를 확인했다.
  기존 한·영 정책 문서, robots.txt, sitemap.xml은 HTTP 200을 유지한다.
  Chrome 1440×960 및 390×844 모바일 에뮬레이션에서 가로 넘침 없이 동작하며,
  선택 해제 시 진행 차단, 승인·거절·재시작, 이미지 dialog의 Escape/focus 복구,
  은하 탐험·정지·Escape를 확인했다. 실제 Safari·모바일 기기 성능 검증은 남아 있다.
- 동작 줄이기를 모의한 환경과 화면 아래로 이동한 상태에서는 GPU draw 호출이
  증가하지 않았다. WebGL 미지원 모의 환경은 정적 canvas로 대체했고,
  context loss 이후에도 페이지 재로딩 없이 데모 상태가 유지됐다.
  모바일은 37,503개 입자와 DPR 1.4 상한, 데스크톱은 87,653개와 DPR 1.75 상한을
  사용한다. 이 값은 렌더링 예산이지 FPS·검색 순위 보장이 아니다.
- 검증: `pnpm --dir site build:cloudflare`, `pnpm build`, `pnpm test`
  (42개), 구조·hooks·UI primitive/palette 검사 통과. 기존 Next.js의
  middleware 명칭 폐기 예정 및 tracing/turbopack root 설정 경고는 남아 있다.
- 재검수 시 루트 pnpm의 workspace 설치 기록 불일치가 자동 재설치를 요구했다.
  의존성을 변경하지 않고 `pnpm_config_verify_deps_before_run=warn`으로
  루트 build·test를 실행해 통과했다. 사이트의 독립 Cloudflare 빌드는 그대로 통과했다.

## 공용 브랜드 아이콘

- 상태: `partial` — 저장소의 활성 브랜드 사용처와 생성물은 고리형 D로 통일했다.
  공개 웹 배포, 외부 콘솔의 업로드 이미지 교체, 새 macOS·Windows 설치 파일의
  Dock/시작 메뉴/installer 검수는 별도 릴리스·배포 뒤 확인한다.
- 단일 원본은 `assets/brand/dopedb-icon.svg`다. 기존 배경 `#151a16`과
  마크 `#ccf36b`, 승인된 좁은 D·−24° 고리·위성 점을 유지한다.
  `scripts/generate-icons.py`는 공용 `DopeDBMarkGraphic`과 PNG/SVG/ICO/ICNS
  17개 생성물을 같은 원본에서 만들며 `pnpm icons --check`로 불일치를 차단한다.
- Desktop title toolbar 24px, Workspace selector 20px(문자 D placeholder 제거),
  소개 사이트와 Workspace `Brand`, 한·영 README, 약관·개인정보 문서,
  favicon·홈 화면·OAuth·Tauri bundle/Windows installer 자산이 이 원본을 사용한다.
  과거 버전의 실제 스크린샷과 외부 DB/Agent 로고는 변경하지 않았다.
- 2026-09-10 로컬 검수: PNG 10개의 규격·RGBA·투명 모서리·배경색,
  ICO의 16–256px 프레임과 ICNS 프레임을 확인했다. 두 웹 앱의 아이콘 HTTP 응답이
  동일 생성물 hash와 일치했고 한·영 초기 HTML에도 마크가 포함된다.
  소개·정책·Workspace 로그인·기기 승인 완료 화면은 HTTP 200을 유지한다.
  1440px 및 390px 모바일 에뮬레이션에서 새 아이콘을 확인했고,
  한 화면의 여러 SVG ID·mask 참조가 충돌하지 않는다.
  Desktop은 브라우저의 실제 header·selector를 라이트/다크에서 확인한 범위이며,
  Tauri IPC를 제공하지 않는 이 실행은 native 동작·packaged 검수의 대체가 아니다.
- 검증: `pnpm icons --check`, `pnpm build`, `pnpm workspace:cloud:build`,
  소개 사이트·Workspace의 `build:cloudflare`, `pnpm test`(42개),
  `git diff --check` 통과. 원본 SVG의 1024px 렌더 결과는 승인된 오른쪽 시안과
  픽셀 단위로 동일하다. Graphify AST도 갱신했다. 기존 Next.js의 middleware/root
  설정 경고와 Graphify의 `Cargo.toml` zero-node 경고는 남아 있다.
- 사용처·생성 환경·외부 반영 경계는
  [`브랜드 자산 안내`](../assets/brand/README.md)를 따른다.

## 화면 상태

MVP의 provider import는 항상 새 managed connection을 만든다. 기존
member-local connection을 선택해 ID와 참조를 보존하는 전환 단계는 UI/API 범위에
없다. 이미 관리형인 exact DB의 provider 권한 복구는 별도 현재 기능으로 유지한다.

2026-09-10 실제 1200px Desktop 화면 검수에서 중앙 작업면의 최소 읽기 폭을
480px로 보정하고, Explorer 복구 상태를 공용 `TreeInlineStatus`의 짧은 메시지와
평평한 action으로 정리했다. Welcome command 목록의 불필요한 card 경계도 제거했다.
AI Chat dock의 하단·오른쪽 4px 여백과 둥근 card 경계를 제거해 title/status
chrome에 정확히 맞췄다.
공용 Tooltip·ToolbarMenu·PopupMenu와 workspace account menu의 수동 viewport
계산은 Floating UI 기반의 자동 갱신·flip·shift·size·숨김 감지로 교체하고 기존
semantic token과 공개 API를 유지했다. 중앙 modal·toast·pointer drag preview는
trigger에 연결된 surface가 아니므로 이 경계에 포함하지 않는다.
같은 상태의 Windows packaged 검수는 남아 있다.

Welcome은 중앙 작업면의 padding을 제거한 우주 배경을 사용한다. Rust는 고정 크기
레시피만 만들고 GPU의 곡선 광선 근사가 회전하는 강착 원반과 위·아래 렌즈,
별·성운을 그린다. 목표 30fps·최대 DPR 2·400만 pixel이며 대형 particle 배열이나
프레임 IPC 복사는 없다. 장식 준비·WebGL2 실패가 실제 command를 차단하지 않는다.
2026-09-11 Chromium의 실제 Welcome component fixture에서 1040×700·480×500 배치,
32px 버튼, 계속 바뀌는 픽셀·드래그·휠·초기화·정지·동작 줄이기·context 복구를
확인했다. 문서 숨김은 합성 visibility 이벤트로 추가 draw 0회를 확인한 것이며
실제 OS 창 숨김 검수와 동일하지 않다. 새 macOS·Windows packaged 렌더링과 GPU
메모리 실측은 남아 있다.
같은 날짜의 격리된 실제 controller·Explorer·Workbench fixture에서 Welcome canvas와
중앙 pane의 경계가 일치함을 측정했다. 마지막 Project 삭제 뒤 연결 identity를
보존하고 최상위 level 1로 표시하며, 상단 시작 화면 command와 마지막 연결 삭제가
기존 Knowledge route를 벗어나는 것을 확인했다. 실제 DB에는 삭제를 실행하지 않았다.
기존 Rust 저장소 회귀도 실제 Project binding 삭제 뒤 전체 연결 profile·credential
reference·safety 값 보존을 검증한다.

이번 Agent UI 정리에서는 AI Chat 입력을 직각 1~3줄 자동 높이로 제한하고 dock의
최대 폭을 전체 창의 50%로 맞췄다. 앱 시작 시에는 CLI 탐지·adapter 검증·기존
session 목록·Project inventory를 읽기 전용으로 예열한다. persisted connection으로
exact resource가 확정되면 닫힌 panel을 mount한 채 write target 없는 ACP session까지
선행 준비하고, exact resource 선택 전에는 ACP process나 Broker grant를 만들지 않는다.
Agent Tools는 중복 page title과 상시
설명 문단을 제거하고, checkbox 자리를 예약한 고정 identity/state/action grid와
32px 반복 action, tooltip 상태 아이콘을 사용한다. 전역 작업 검색과 설정·Explorer·
목록 검색 입력은 같은 직각 경계를 사용한다.

| 영역 | 상태 | 현재 소유자 | 남은 acceptance gap |
| --- | --- | --- | --- |
| App shell/chrome | `partial` | `features/appShell`, design-system chrome primitives | 시스템·라이트·다크 semantic palette, 검색의 위아래 여백을 없앤 32px title toolbar와 같은 중앙선의 32px action, 296px Explorer, Workspace·Databases·Articles 탐색과 평평한 main pane을 적용했다. 공용 고리형 D 마크, Agent 말풍선, 브랜드 오른쪽에서 현재 왼쪽 패널을 복원하는 토글을 적용했다. AI Chat 진입은 헤더 오른쪽에만 두고, Explorer 탐색·도구·검색·트리는 12px gutter를 공유한다. 새 macOS 개발 bundle에서 토글 위치·닫기·복원과 헤더 AI Chat 진입을 확인했다. macOS 개발 bundle의 넓은·좁은 창에서 정렬, Explorer·Local History 복원, drawer Escape, 검색, 라이트·다크를 확인했다. 실제 컴포넌트 fixture의 로그인 계정 버튼도 32px와 동일 중앙선을 측정했다. 새 macOS 개발 bundle에서 탐색·검색·Workspace fallback·SQL editor·Agent pane을 확인했다. Local History header의 뒤로 버튼과 상단 메뉴 재선택은 Explorer로 복귀하며, 기존 Explorer를 유지해 검색·트리 상태와 중앙 문서를 보존한다. 실제 macOS 개발 앱의 1200px·520px 창에서 복귀·메뉴 재선택·패널 숨김/복원·검색어 유지·tree focus와 compact Action Search 진입을 확인했다. Windows packaged의 새 palette와 compact 검수는 남아 있다. Knowledge 화면에서는 과거 DB breadcrumb를 제거한다. Agent는 왼쪽 pane과 중앙 480px를 예약한 뒤 360px까지 줄여 dock하며, 공간 부족 시 제목 표시줄과 상태 표시줄 사이의 396px overlay로 전환한다. 하단 Services 패널·토글·resize·저장 상태를 제거하고 중앙 본문과 32px 상태 표시만 유지한다. 브라우저 shell에서 본문이 title/status 사이를 채우는 것을 확인했다. packaged macOS·Windows에서 keyboard launcher와 compact window를 정기 확인 |
| Action Search | `complete` | `features/actionSearch` | cached catalog scope, `/` action mode, focus 복구와 bounded top-k를 유지 |
| Welcome document | `complete` | `screens/Onboarding`, `features/onboarding` | 준비된 Demo는 학습 command 3개만, 연결된 상태는 New Query만, 미연결 상태는 New connection과 사용 가능한 Guided Demo만 보여 준다. 전역 Action Search를 반복하지 않고 command 행의 아이콘·경계·focus 상태를 유지한다. Personal 가이드 데모의 idempotent DB·Project·Environment·binding 준비와 상태별 command 집합을 packaged smoke에서 확인 |
| Workspace account authentication | `partial` | `features/workspaces/WorkspaceAccount`, native workspace deep-link adapter, `workspace-cloud/app/auth/device` | 브라우저 승인 완료 화면은 비밀값 없는 `dopedb://auth/device-complete`로 기존 앱을 활성화하고 즉시 서버 polling을 실행하며 자동 호출이 막힐 때 수동 앱 열기 action을 유지한다. production/dev/benchmark URL scheme 분리와 payload 거절은 자동 검수한다. 실제 Google 승인 왕복을 packaged macOS·Windows에서 확인하면 `complete`로 전환한다. |
| Workspace Web administration | `complete` | `workspace-cloud/app/settings`, `workspace-cloud/features/providerAccess` | 최상위 목적지를 Workspaces, Access, Providers, Workspace settings, My account로 한정한다. 멤버·DB grant와 provider 승인·managed DB를 각각 한 흐름으로 묶고, Analysis 관리는 Desktop에만 둔다. compact header, 한 번의 workspace context, flat section과 revision conflict의 단일 경계를 유지한다. lifecycle은 Backup → key → retention 순서이며 삭제 blocker가 있으면 복구 link만 보여 주고 exact-name 확인 form은 숨긴다. provider 실계정 mutation 검수는 Provider account access 행에서 계속 추적한다. Desktop에서 시작한 exact 연결의 실제 복구 저장·본인 grant 저장 뒤 token-free 앱 복귀를 시도하고 수동 버튼을 유지한다. 실제 컴포넌트 fixture에서 성공·다른 연결·계정 변경을 확인했고 macOS 개발 bundle에서 정상 callback의 최소화 해제·전면 복귀와 query가 붙은 잘못된 callback의 무시를 확인했다. 운영 웹과 정식 앱을 연결한 검수는 배포 전이다. |
| Database Explorer | `partial` | `screens/Connections/DatabaseExplorer`, `features/catalogExplorer` | 상단은 Project 추가·Environment 추가·새로고침·검색만 두며 닫기·보기 옵션과 메뉴 전용 상태·callback·번역을 제거했다. 실제 컴포넌트에서 다크·라이트 enabled hover 배경·glyph와 disabled 유지, 추가 dialog 진입을 확인했고 macOS 개발 bundle에서 네 action과 검색·Escape·헤더 패널 닫기·복원을 확인했다. 검색 결과 key가 실제로 있을 때만 search-active가 되며 문서 선택과 검색 focus를 구분한다. Databases의 Project → Databases/Data sources와 Articles의 Project → Article collection으로 분리된 계층, workspace당 connection 하나의 active Project binding, DB 행의 exact-binding 제거, connection 보존·source/grant 폐기·pinned Agent session 중단·active Article 차단을 지키는 Project 삭제, DB 행에만 보이는 Environment marker와 같은 schema group의 Diff 진입점을 유지한다. 배정된 DB 행의 pointer drag·행 메뉴·Option/Alt+위/아래 화살표는 구성원·기기별 표시 순서만 바꾸고 같은 schema group을 production→staging→development→test/custom 연속 블록으로 유지하며 Project·Environment binding을 변경하지 않는다. drag preview·dimming·live announcement는 그 블록 전체를 한 대상으로 표시한다. Project/resource 행은 28px로 맞추고 Project 14px·650, resource folder 13px·550, DB·source·article leaf 13px·450의 Pretendard Variable 계층을 사용한다. provider target과 24px tree action은 한 줄에 머물러 action 유무가 DB 행 높이를 바꾸지 않는다. BigQuery의 일반 access token 갱신은 공식 CLI가 자동 처리하고, Google이 사람의 재인증을 요구하면 local 및 Project-shared member-local 연결 모두 외부 터미널 없이 같은 app-managed 공식 CLI 브라우저 흐름으로 복구한다. 재인증·조회 실패 안내는 복구 버튼 위에 표시해 좁은 Explorer에서도 메시지 폭을 보장한다. Google 계정 CLI profile은 exact Workspace·구성원 범위, 서비스 계정 profile은 개별 member-local connection binding 범위로 격리한다. Unassigned→환경 DB 행 또는 Project Databases folder의 preferred exact Environment binding drag는 Team-local 연결을 비밀값 없는 shared identity로 먼저 승격하고, 실패 시 롤백하며, 성공 시 기존 로컬 복사본을 정리한다. member Google CLI 인증은 기기에 남는다. 브라우저의 실제 tree 컴포넌트에서 Databases에 Article이 없고 Articles에 DB/source가 없는 것을 확인했다. Articles에서는 DB 객체 검색·Environment 생성 action을 숨긴다. 변경된 탐색 분리와 loaded-only 객체 검색·대형 catalog selection/scroll의 native packaged 검수는 남아 있다. |
| Connection editor | `complete` | `features/connections/useConnectionEditorController` | 새 연결의 provider catalog는 실제 command가 있는 항목만 보여 주고 정보 화면은 `닫기`로 끝낸다. 이름 오류는 편집 또는 Save/Test 시도 뒤에만 공개한다. 연결 identity·접속 옵션만 소유하고 쓰기 실행 제어는 Settings → Safety 단일 경계를 유지한다. Workspace 관리형 연결은 내부 placeholder endpoint를 숨기고 관리 주체와 구성원별 단기 lease를 설명하며, `manage` 권한 보유자는 Workspace Web의 exact DB 복구 command로 이동한다. BigQuery는 별도 CLI 선행 설치 없이 SDK와 Python 버전이 고정된 앱 전용 official runtime을 최초 연결 때 준비하고, 직접 ID 입력, 공식 `gcloud` 브라우저 인증, `gcloud --cred-file` 서비스 계정 연결과 실제 project/dataset selector를 제공한다. 앱이 Google token이나 key file을 소유하지 않는지 macOS arm64/x64·Windows x64 packaged runtime에서 유지 검수한다. |
| Schema comparison | `partial` | `screens/SchemaDiff`, `lib/schemaDiff` | 기준·대상 선택을 한 번만 표시하고 상태 필터에 건수를 합쳤다. 관계 경로는 그룹 제목 한 곳에만 두고 객체 이름은 대소문자를 보존해 줄바꿈한다. 모든 기준·대상 값을 클릭 없이 나란히 보여 주고, 색과 −/+ 기호로 변경 전후를 구분하고 값에서 차이가 있는 구간을 강조한다. 테이블 자체의 추가·누락은 그룹 제목에서 한 번만 표시한다. 검색·펼치기·별도 안내 행은 제거했다. 실제 workbench 폭 440px 이하에서 두 값을 라벨과 함께 세로로 배치하고 본문 하나가 스크롤을 소유한다. 실제 컴포넌트 fixture의 420·500·1000px, 한·영, 다크·라이트, 상태 필터, 비교 대상·기준 전환과 일치·해당 유형 없음 상태를 검수했다. macOS 개발 runtime의 같은 fixture에서 긴 이름·값 표시를 확인했다. CLI `schema diff`와 session MCP `schema_diff`는 같은 Rust 비교 모델과 fresh Broker 조회를 사용한다. 공용 fixture의 Desktop/CLI 결과 일치, 실제 macOS CLI·브리지 바이너리의 전체 텍스트/JSON, 권한 거절·중간 회수·조회 실패·다른 대상 응답의 무결과 실패, Agent 페이지 이동·fingerprint drift 거절을 격리 Broker에서 검수했다. 실제 DB와 Windows packaged 검수는 남아 있다. |
| Provider account access | `partial` | `workspace-cloud/features/providerAccess`, provider application modules | GCP 연결·복구는 기존 integration·project·instance·connection ID와 멤버 grant를 유지한다. PostgreSQL 14 이상에 새 세대의 전용 read/write 서비스 계정과 IAM DB 사용자를 만들며 생성 시 predefined data role을 지정한다. 기존 DB 사용자 PUT/DELETE, 관리자 DB 사용자 임시 승격, Data API 권한 SQL, PUBLIC/기본 ACL/객체 소유권 변경은 제거했다. 기존 전용 계정이 기대한 권한과 다르면 변경 없이 중단한다. 기존 신뢰 항목은 삭제하지 않는다. 일반 연결·복구에서 schema principal을 자동 구성하지 않으며 기존 schema credential의 엄격한 발급·Desktop 검증은 유지한다. 이전 PostgreSQL/MySQL 자동 구성은 변경 전에 중단하고 member-local 자격 증명을 안내한다. OAuth, IAM 인증 flag 승인과 활성 lease 사전 검사는 유지한다. 계약 harness와 격리 PostgreSQL에서 기존 및 새 스키마의 서버 접근을 검증하며, 이번 수정의 실제 사용자 OAuth→DB 연결 성공 및 Desktop 재검수는 미완료다. |
| SQL/MongoDB query workflow | `complete` | `features/queries`, `features/documentQueries`, `screens/Sql`, `screens/Documents`, Rust query application | SQLite 경로는 기본 화면에서 basename으로만 표시하고 MongoDB limit는 문자열 draft를 보존한 뒤 blur/실행에서 검증한다. 수동 Run exact 승인, Agent 제안 분리, MongoDB의 지속되는 조회 surface와 collection 없는 정확한 빈 상태, 10 KiB/100 KiB/1 MiB 입력과 cancel/transaction packaged 검수를 유지 |
| Result/Data grid | `complete` | `features/queryResults`, Rust result artifact | WHERE/ORDER BY는 입력 경계·focus·dirty 상태를 드러내고, 행 범위·전체 수·잘림·실행 시간은 tooltip 없이 floating footer에 표시하며 마지막 cell을 덮지 않는다. 30열·50,000행 selection/filter/export와 메모리 경계를 검수 |
| 결과/Jobs | `partial` | `features/queryServices`, `features/jobs` | 하단 Services는 보조 보기 없이 제거했다. SQL 문서는 SQL/결과를 전환하고, 중앙 실행 결과 문서는 같은 연결의 보존된 session·Output·다중 statement를 표시한다. 상태 표시의 실행 중 query는 원래 문서로 이동해 controller를 유지한다. 브라우저 실제 컴포넌트에서 420px·900px 결과 폭, SQL 편집기 인스턴스·내용 보존, 다른 connection 결과 제외, Article/DB 탐색 분리를 확인했다. native packaged 실행·취소·재시작 복원 검수는 남아 있다. 비로그인 Personal 실행은 현재 process의 session/result를 즉시 보여 주되 계정 범위 영속화는 하지 않는다. Import/Export의 header와 주 동작은 고정하고 내용만 scroll한다. background cancel과 복원된 result handle, 쓰기 권한 차단 시 exact DB의 필요한 권한 계층·`Settings → Safety` 복구 진입을 검수한다. 관리형 DDL 실패도 별도 권한 창을 만들지 않고 동일한 Safety 단계와 provider 지원 여부로 복구한다. 직접 권한 변경·분류 불가 SQL은 `sqlPolicyBlocked`와 문자 기준 구문 위치로 안내하며 쓰기·DDL 설정을 복구 수단으로 제시하지 않는다. 실제 결과 컴포넌트에서 한·영 및 다크·라이트 안내를 검수했다. |
| Agent tool window | `partial` | `features/agents`, ACP Rust runtime | Claude 표기를 사용하고, 15px 채팅 본문·14px control·12px 상태 계층과 28px header/context control을 적용했다. 공식 adapter가 제공한 model·mode select만 전달하고, ready 세션에서 명시적으로 승인 모드를 변경한다. mode를 기본값으로 저장하지 않으며 DB write approval은 별도다. 360px·396px 실제 컴포넌트 fixture에서 두 행 정렬·light/dark·키보드 모드 변경·permission 대기 중 설정 비활성화를 확인했다. 실제 session store·transcript fixture에 시간차 조각을 보내 완료 전 본문 증가·작성 커서·완료 시 커서 제거·긴 답변의 입력창 유지와 자동 스크롤·위로 스크롤한 위치 보존을 확인했다. token burst는 화면 frame으로 합치며, 권한/완료 경계는 즉시 반영하고 account 전환 시 대기 frame을 취소한다. 실제 provider의 자동 승인 도구 실행 검수는 남아 있다. adapter가 없을 때 설정 CTA는 하나만 보여 준다. 한 Project의 DB·BigQuery·GitHub source를 개별/다중 선택하고 trigger에 Project·선택 개수·단일 쓰기 대상을 계속 표시한다. 선택하지 않은 resource 차단, connection별 독립 read, 단일 write target, 공식 adapter 설치·실행 계약 호환성·로그아웃·permission·resume, resource 선택의 즉시 반영과 입력창을 유지하는 백그라운드 선행 준비, 동일 권한 focus-refresh 연속성, 저장 분석 요청의 Article verify/propose 영수증과 실제 Article 도구명에만 대응하는 저장 상태 표시를 packaged runtime에서 검수하면 `complete`로 복귀 |
| External Agent approval | `partial` | `features/agents/ExternalAgentRequestGate`, `dopedb-cli`, Local Broker | `agent init`의 secret-free config 생성, `agent start`의 immutable resource 재검토, token 없는 process-bound MCP 주입·종료 revoke는 자동 회귀 검수한다. macOS/Windows packaged CLI에서 Codex/Claude 각각의 실제 로그인·승인·종료 흐름을 검수하면 `complete`로 전환한다. |
| Knowledge graph | `partial` | Rust `features/knowledge`, frontend Knowledge source projection | exact-commit GitHub 탐색과 Local source revision은 유지한다. 그래프 구성·매핑 검토 UI·exact graph grant는 benchmark와 entitlement 결정 뒤 새 실행 설계로 구현하고 packaged 검수한다. |
| Analysis Article | `partial` | `features/analysisArticles`, cloud analysis application | unavailable Personal 범위에서는 Explorer 필터를 숨기고 로그인/Workspace 선택 복구 동작과 중립 Project/Analysis status context를 보여 준다. 사용자 상태·revision·결과 제한 문구는 i18n presentation mapping을 거친다. Explorer 소유 문자 필터와 단일 중앙 HTML document를 유지한다. Serif 제목·본문, 실제 h2/h3 목차, 216px query 도구 열, 상단 Edit·Share·More와 publication modal을 적용했다. 본문 DOM은 memo로 보존해 목차 관찰과 keyboard focus가 유지된다. 실제 컴포넌트의 로컬 fixture에서 1536/1200/860/740px 배치, 목차 이동·포커스, 공유·편집·공개 modal·Escape, 로딩 실패 복구를 확인했다. authenticated Article의 packaged 검수는 남아 있다. exact 단일 query의 로컬 수동 재조회, immutable public HTML 발행과 raw run timestamp의 RFC3339 응답을 실제 환경에서 검수 |
| Article private sharing / invitations | `partial` | `features/analysisArticles`, `workspace-cloud/features/articleSharing` | 이메일 지정 48시간 초대, verified-email 수락 시 membership + 정확한 DB read grant, 기존 높은 권한 유지, 취소·만료·권한 변경·동시 수락·소비한 링크의 권한 복원 차단은 격리 PostgreSQL harness로 검수했다. Desktop 공유 dialog의 생성·복사·취소·앱 복귀 UI는 로컬 fixture로 검수했다. 브라우저의 Article deep link가 packaged macOS 개발 앱을 열고 비로그인 계정의 로그인 복구 화면으로 연결되는 것을 확인했다. 새 Cloud 배포와 Desktop 배포를 연결한 실제 설치→로그인→원래 Article 복귀는 아직 배포 전이며, query 자동 실행은 없다. |
| Appearance/theme | `partial` | `design-system/theme.ts`, `screens/Settings/Appearance`, `lib/appProviders` | 시스템 기본값·명시적 라이트/다크·기기별 저장과 복원을 구현했다. 다크 palette의 큰 면은 near-black 대신 soft charcoal surface를 사용하고 파랑은 선택·focus·실행 역할에만 남긴다. 탐색 아이콘과 헤더 정렬은 App shell/chrome 항목에서 관리한다. macOS 개발 bundle에서 기본 선택·다크 적용·앱 재시작 후 복원·시스템 복귀를 확인했다. 실제 컴포넌트 fixture에서 OS 변경 event 반영과 고정 테마 유지, SQL 편집 내용·터미널 출력 보존, Agent 코드·Mermaid 재렌더링을 확인했다. Windows packaged 및 실제 OS 자동 전환 검수는 남아 있다. |
| Settings | `complete` | `features/settings`, `features/safetySettings` | 개인정보 설명은 수집 제외·공유·전송/보관·철회 효과를 의미별 description list로 유지한다. 700px 이하에서는 검색·tree·breadcrumb 대신 한 줄 section select를 사용한다. Desktop `Settings → Safety` 하나에서 항상 켜진 읽기와 누적 DML·DDL 권한을 체크박스로 표시한다. DDL은 DML을 필요로 하고 DML 해제 시 함께 꺼지며, 중복 상태 badge 없이 관리자용 workspace 상한 + 기기 gate를 한 번의 적용 동작으로 fail-closed 저장하고 미적용 변경을 표시한다. 관리형 DDL은 exact `manage` grant와 검증된 Neon 또는 GCP Cloud SQL PostgreSQL schema lease가 있을 때만 열고, 지원하지 않는 provider·engine과 복구 전 GCP 연결은 DDL 적용 전에 online 권한과 검증된 schema 설정을 확인해 기기 gate 저장을 차단한다. Safety와 SQL 실행 오류는 exact 연결의 Workspace Web 복구 command를 제공하며, 관리 권한이 없는 구성원에게는 관리자 복구 요청을 안내한다. provider/연결/오류 화면은 별도 변경 control을 만들지 않으며 웹 DB 접근 화면은 같은 상한을 상태로만 표시한다. compact viewport 검수 |
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
3. streaming result를 중앙 결과 문서에서 선택·복사·filter하고 상태 표시에서 작업을 관찰·취소한다.
4. 큰 결과는 native artifact와 streaming export를 사용하고 renderer가 전체 row를
   보관하지 않는다.

Acceptance: cancel 후 connection을 검증 없이 재사용하지 않고 write outcome이
불명확하면 `outcome_unknown`을 보존한다.

### 4. Agent 작업

1. 한 Project 안에서 필요한 DB·BigQuery·GitHub source를 개별 또는 다중 선택하면 trigger에 Project, DB/source 수와 쓰기 대상 유무를 계속 표시하고 공식 ACP adapter를 선행 준비한 뒤 첫 prompt를 같은 제출 흐름에서 전송한다. 내부 Project Environment identity는 계층으로 노출하지 않고 DB 행의 dev/staging/prod marker로만 설명한다.
2. Desktop이 선택한 connection/source/Environment revision 집합과 선택적인 단일 write target을 하나의 exact grant로 immutable pin한다. 선택하지 않은 resource는 접근할 수 없고 여러 DB read는 독립 operation으로 실행한다.
3. 화면은 tool 진행, permission, result, 중단과 복구를 보여준다. 중간 추론은 기본 화면에서 숨기며 debug details에서만 확인한다. 추론 문장의 단어로 DB 실행이나 변경을 추정하지 않으며, 실제 operation 표시는 tool identity에서만 만든다.
4. provider 인증은 로컬 CLI가 소유하며 앱은 token을 읽거나 login UI를 만들지 않는다. 응답 언어는 사용자의 명시 요청, 메시지 언어 순으로 따르고 언어를 알 수 없을 때만 앱 UI 언어를 기본값으로 사용한다.
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
5. 공유에서 기존 권한용 링크를 복사하거나 동료 이메일을 지정한다. 수락자는 검증한 계정으로 워크스페이스 가입과 해당 DB 읽기 권한을 함께 받고, 설치·로그인 뒤 Desktop의 원래 Article로 돌아온다.

Acceptance: public article은 query, result row, credential 없이 immutable sanitized
HTML snapshot만 읽고 재조회 command는 인증된 Desktop에만 존재한다.

## 트래커 갱신 규칙

- 화면을 바꾸면 해당 행의 상태, owner, 남은 gap을 같은 변경에서 갱신한다.
- `complete`는 build 통과만 뜻하지 않는다. 실제 command/state owner와 변경 위험에
  비례한 runtime 검수가 모두 필요하다.
- `missing`은 구현된 것처럼 보이는 disabled control로 대체하지 않는다.
- 시점별 긴 작업 일지, 외부 비교 screenshot, 임시 hash는 이 문서에 누적하지 않는다.
  재현 가능한 영구 계약은 ADR, test, architecture guard 또는 제품 scope로 승격한다.
