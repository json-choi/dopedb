# ADR 0009: Desktop workspace administration

- 상태: Accepted
- 결정일: 2026-10-08
- 관련: [`PRODUCT_UI_SCOPE.md`](../PRODUCT_UI_SCOPE.md) PD-46,
  [ADR 0008](0008-desktop-loopback-pkce-login.md), Issue #282

## 배경

Workspace 관리(구성원·초대·역할, DB grant와 팀 읽기 공유, 공급자 계정 승인과
managed DB 등록·복구, Neon branch, 소유자 backup·key rotation·retention·삭제, 계정
session 관리)는 Workspace Web의 `/settings`가 소유했다. Desktop은 관리가 필요할 때
웹 console로 이동하는 link만 제공했다. 실제 데이터 작업과 Agent는 Desktop에서
일어나므로 사용자는 같은 계정으로 두 surface를 오가야 했고, 관리형 연결 복구도
브라우저 왕복과 앱 복귀 추측에 의존했다.

Desktop은 ADR 0008에 따라 계정별 Better Auth session을 Rust가 OS credential store에
보관하고 Bearer로만 사용한다. 관리 API route는 이미 Bearer 요청을 받는다
(`mutationAllowed`, `authoritativeSession`). 공급자 OAuth callback은 state와 함께
브라우저 cookie session의 사용자를 확인해 다른 계정의 공급자 승인이 workspace에
붙는 것을 막는다.

## 결정

1. Workspace 관리 command는 Desktop `Settings`가 소유한다. 팀 workspace의 관리자와
   소유자에게만 `Workspace` 범위(`구성원`, `DB 접근 권한`, `공급자`, 소유자 전용
   `백업 및 삭제`)를 표시하고, 계정 session 종료와 삭제 예약 취소는 `계정`,
   workspace 생성과 관리 진입은 workspace menu가 소유한다.
2. Rust `workspace_admin` feature가 control plane 관리 API의 닫힌 작업 목록을
   소유한다. WebView는 작업 하나와 행동 계정만 보낸다. Rust는 계정이 이 기기에
   로그인했는지 확인하고, 경로를 고정 문자열과 UUID만으로 만들며, 텍스트·opaque
   값·응답 크기를 제한한다. 응답은 HTTP status와 bounded JSON body로 돌려주어
   화면이 문서화된 conflict와 재시도 code를 직접 처리한다. Bearer session은
   Rust 밖으로 나가지 않으며 관리 응답의 401은 저장된 session을 지우지 않는다.
3. 공급자 OAuth는 Rust가 control plane origin의 `/auth/provider/start` 시작 확인
   페이지만 연다. 이 페이지는 state를 소비하지 않고, 브라우저 계정이 승인을 시작한
   계정과 같을 때만 공급자로 이동하며 아니면 로그인·계정 전환을 안내한다. callback은
   기존처럼 cookie session과 state의 사용자를 함께 검증한 뒤 token 없는
   `/auth/provider/complete` 안내로 끝낸다. Google Cloud SQL 설정은 Desktop이
   `GET .../provider-integrations/gcp-setup`으로 자신의 setup을 찾아 이어 간다.
   state만으로 callback을 신뢰하도록 완화하지 않는다.
4. control plane은 Desktop이 필요한 관리 계약을 추가한다. token을 반환하지 않는
   계정 session 목록·종료(`/api/v1/account/sessions`), 소유자에게만 보이는 삭제
   예약 workspace 목록(`GET /api/v1/workspaces`의 `deletionPending`), Better Auth
   오류의 JSON 응답이 그것이다.
5. Workspace Web의 관리 화면을 제거한다. 웹에는 로그인과 Desktop 승인, 초대 수락,
   공급자 OAuth 시작 확인과 완료 안내, 공개 Article만 남긴다. 예전 `/settings`는
   관리가 Desktop으로 옮겨졌다는 안내와 앱 열기만 보여 준다.

## 결과

관리 화면과 데이터 작업이 같은 계정·workspace 문맥을 공유하고, 관리형 연결 복구가
같은 앱 안에서 해당 DB 행으로 이어진다. 입력한 공급자 secret은 component state와
Rust 요청 한 번에만 존재하고 query cache나 로컬 저장소에 남지 않는다.

관리 API는 이제 Desktop 릴리스와 독립적으로 배포되는 공개 계약이다. control plane은
지원 중인 Desktop 버전이 보내는 요청과 읽는 응답을 하위 호환으로 유지해야 하며,
Desktop은 알 수 없는 응답을 실패 상태로 표시한다. 새 관리 API와 웹 관리 화면 제거는
같은 control plane 배포에 들어 있으므로, 이 기능을 포함한 Desktop 릴리스를 먼저
공개하고 곧바로 control plane을 배포한다. 그래야 이전 Desktop 사용자가 관리 수단을
잃지 않고 안내 페이지에서 새 버전을 받을 수 있다. 두 배포 사이에는 새 Desktop의 계정
session 목록·종료, 삭제 예약 목록, 공급자 승인 시작과 Google Cloud 설정 이어 가기가
실패 상태로 보이고, 나머지 관리 기능은 기존 API로 동작한다.
