# 열린 이슈 실기 검증 Runbook

이 문서는 자동 검증을 통과했지만 실제 계정, 기기, provider 또는 설치 앱의
증거가 없어 닫지 못한 이슈를 한 번의 검수 세션으로 묶어 처리한다. 이 문서의
체크박스는 GitHub Issue의 완료 상태를 대신하지 않는다. 각 결과를 해당 이슈에
기록하고 이슈 본문의 완료 조건을 다시 확인한 뒤에만 닫는다.

## 공통 원칙

- 공개 데이터가 없는 격리된 workspace와 폐기 가능한 데이터베이스를 사용한다.
- 비밀번호, access token, OAuth code, connection string, 사용자 데이터는 화면
  캡처와 로그에서 제거한다.
- 앱 버전, commit SHA, OS/architecture, WebView, provider resource 종류와 검수
  시각을 기록한다. secret이나 전체 resource identifier는 기록하지 않는다.
- 성공 화면만 남기지 않는다. 실패 복구가 완료 조건이면 실패 원인, 사용자가 본
  recovery action, 재시도 결과를 함께 기록한다.
- 자동 패키지 하네스 결과를 사람 검수로 대체하거나, 사람 검수 결과를 다른 OS의
  결과로 확대 해석하지 않는다.
- 예상과 다른 상태가 나오면 후속 행동으로 우회하지 말고 해당 단계에서 멈춰
  issue에 재현 절차와 안전하게 정리한 오류를 남긴다.

## 증거 형식

각 issue comment는 다음 형식을 사용한다.

```text
검수 시각:
앱 버전 / commit:
OS / architecture / WebView:
계정·기기 역할: (예: owner/macOS, member/Windows)
대상: (provider와 격리된 resource 종류만 기록)

시나리오:
1. 수행한 동작
2. 관찰한 상태
3. 복구 또는 정리 결과

측정값:
- p50/p95 또는 사람이 관찰한 대기 시간
- cold/warm 구분

첨부:
- secret을 제거한 screenshot 또는 짧은 recording
- 관련 CI run 또는 Sentry event link

판정: pass | fail | blocked
남은 조건:
```

`pass`는 해당 OS와 해당 시나리오에만 적용한다. `blocked`는 권한이나 외부 서비스
상태 때문에 실행하지 못한 경우이며 완료로 표시하지 않는다.

## Session A — 설치 앱, UI, 접근성, 성능

준비물:

- 현재 stable과 직전 stable 설치본
- macOS ARM, macOS Intel, Windows x64
- macOS VoiceOver와 Windows Narrator
- 10 KiB, 100 KiB, 1 MiB SQL fixture
- 30열 이상·50,000행 이상을 탐색할 수 있는 격리 데이터
- 검증할 DopeDB build와 같은 scenario의 내부 before/after evidence

### A1. 안정 업데이트 — #48

1. 각 OS에 직전 stable을 설치하고 표시 버전을 기록한다.
2. 앱에서 latest stable을 확인하고 다운로드, 서명 검증, 설치, 재시작을 진행한다.
3. 재시작한 앱 버전과 latest manifest가 일치하는지 확인한다.
4. 네트워크 중단, 사용자 취소, 유효하지 않은 서명 fixture를 각각 실행한다.
5. 기존 설치가 손상되지 않고 명확한 오류와 재시도 동작이 남는지 확인한다.

### A2. Agent Tools 접근성 — #95

1. screen reader를 켠 상태에서 Agent 선택 modal을 연다.
2. 제목, 설명, Claude/Codex checkbox, 기본 선택, focus 순서를 실제로 듣는다.
3. 정방향·역방향 focus trap, Escape, 확인 동작을 keyboard-only로 수행한다.
4. Settings > Agent Tools에서 설치, 재시작 후 상태 확인, 제거를 듣고 수행한다.
5. 상태가 색이나 아이콘만으로 전달되지 않는지 확인한다.

### A3. 제품 UI interaction polish — #111, #112

같은 viewport와 상태에서 변경 전후 DopeDB를 나란히 검수한다.

- title toolbar, document tab, tool window 전환
- Explorer expand, search, refresh, 폭 resize
- connection 입력 검증, Test, Apply/OK
- SQL Run, streaming first batch, Cancel, 완료
- result tab, Output, grid scroll/select/sort/filter/copy/context menu
- Agent approval pending, approve, deny, completed
- loading, empty, error, reconnect, compact window

geometry, text baseline, icon alignment, visible text, divider, 색 역할, hover/pressed/
focus/selected/disabled/busy, popup/tab/resize/scroll의 상태 연속성을 기록한다. 정지
화면으로 판단할 수 없는 전환은 짧은 60fps recording을 첨부한다.

### A4. SQL 편집기 — #117

각 10 KiB, 100 KiB, 1 MiB 문서에서 다음 동작을 실제 앱으로 수행한다.

1. 연속 입력과 중간 삽입
2. 문서 처음/중간/끝 cursor 이동과 selection
3. Format
4. Run 또는 안전한 statement preview
5. tab 전환과 다시 열기

입력 유실, 전체 화면 freeze, cursor jump, selection 손실, 포맷 결과 손상이 없어야
한다. 자동 성능 run URL과 별도로 사람이 관찰한 응답성을 기록한다.

### A5. Workbench scroll ownership — #123

`1393×862`, `900×600`, `560×700`에서 다음을 wheel/trackpad, scrollbar drag,
PageUp/PageDown, Home/End, keyboard focus로 확인한다.

- Services 닫힘/기본/최소/최대 높이의 script Result
- 긴 EXPLAIN, save conflict, write approval, multi-statement, SQL error
- 일반/virtual Table grid, Structure, cell/row inspector, Job panel
- Mongo find form, 8-row aggregate pipeline, error와 result
- Schema ERD, inspector, 1100px 이하 stacked layout

각 surface의 첫 항목과 마지막 항목, action, footer에 도달해야 하며 resize 뒤 scroll,
selection과 focus가 의도치 않게 초기화되지 않아야 한다.

## Session B — Workspace 두 계정·두 기기

대상 이슈: #22, #23

준비물:

- owner와 member 두 계정
- 서로 다른 두 기기 또는 완전히 분리된 두 OS profile
- owner/member가 각각 소유한 읽기 전용 로컬 DB credential
- 격리 workspace와 폐기 가능한 shared connection

### B1. 초대와 개별 credential binding — #23

1. owner가 workspace와 secret 없는 shared connection identity를 만든다.
2. member를 초대하고 두 기기에서 각자의 DB credential을 binding한다.
3. 두 계정이 같은 connection revision에서 동일한 read를 실행한다.
4. shared record, cloud response와 audit에 장기 비밀값이 없는지 확인한다.
5. member 제거 뒤 신규 실행이 거부되는지 확인한다.
6. connection 삭제 뒤 신규 실행이 거부되고 로컬 DB 계정은 별도 revoke가 필요하다는
   안내가 보이는지 확인한다.

### B2. Offline replay와 idempotency — #22

1. 한 기기를 offline으로 전환한다.
2. 순서가 중요한 허용된 workspace 변경을 만들고 동일 mutation 재전송도 준비한다.
3. 다른 기기에서 충돌 가능한 변경을 만든다.
4. 첫 기기를 reconnect하고 ordered pull cursor가 누락·역행 없이 수렴하는지 본다.
5. 동일 mutation이 한 번만 반영되고 audit sequence가 보존되는지 확인한다.
6. reconnect 도중 앱을 종료·재실행해도 같은 최종 상태로 수렴하는지 확인한다.

## Session C — Provider, Explorer, 첫 행, Neon branch

대상 이슈: #100, #113, #115, #118, #125

준비물:

- 빈 격리 대상이 있는 GCP, PlanetScale, Neon 계정
- 실제 원격 PostgreSQL과 MySQL
- 여러 database와 충분히 큰 schema/object tree
- 로컬 SQLite와 managed Cloud SQL
- owner/member가 분리된 macOS와 Windows 앱

### C1. 세 Provider provision — #100

각 provider에서 빈 대상을 선택해 setup을 시작하고 `Ready`까지 진행한다. 요청된
권한, 실행한 공식 CLI 동작, 생성한 최소 권한 주체, rollback/cleanup 결과를
provider별로 기록한다. unit/contract/isolated integration 결과와 실제 Desktop
lease 실행을 한 comment에 연결한다.

### C2. Neon 공유와 branch 경계 — #113, #115

1. Neon 계정 연결 → DB 준비 → workspace 공유 → member read lease를 macOS와
   Windows에서 실행한다.
2. 기준 checkpoint를 만든다.
3. 격리 branch에서 승인된 실행을 수행한다.
4. 결과와 audit을 검사하고 원본과 격리 상태를 비교한다.
5. 격리 branch를 폐기하고 원본에 변경이 남지 않았는지 확인한다.

### C3. Explorer 원격 catalog — #118

PostgreSQL과 MySQL 각각에서 최초 tree, database expand, schema expand, search를
실행한다. 다음을 분리해 기록한다.

- cold connection의 time-to-first-tree
- warm connection의 time-to-first-tree
- 확장 전 불필요한 catalog 조회 여부
- 다중 database search-to-results
- refresh 뒤 selection과 expanded state 연속성

### C4. Table first row — #125

동일한 table과 표시 column 수를 고정하고 각 조건을 여러 번 측정한다.

- 로컬 SQLite warm click → first grid commit p50/p95
- network PostgreSQL warm click → first grid commit p50/p95
- managed Cloud SQL cold proxy/pool
- managed Cloud SQL warm pool

macOS packaged app의 사람이 관찰한 결과를 함께 기록하며 cold와 warm 수치를 섞지
않는다.

## Session D — Analysis Article manual lifecycle

1. 비민감 fixture를 읽는 하나의 read-only query와 sanitized HTML로 Article을 만든다.
2. 다른 구성원이 자신의 로컬 자격 증명으로 Article을 열 수 있는지 확인한다.
3. Desktop에서 **Run again**을 눌러 현재 Article·connection revision과 grant가 다시
   검증되는지 확인한다.
4. 실행 중 cancel이 bounded time 안에 멈추고 부분 결과가 공유되지 않는지 확인한다.
5. 성공한 결과 행은 실행한 Desktop의 로컬 복구 캐시에만 남고, Web에는 run metadata와
   query receipt만 보이는지 확인한다.
6. immutable HTML publication을 발행한 뒤 saved query와 private result가 공개되지 않는지,
   revoke 직후 같은 slug가 더 이상 열리지 않는지 확인한다.

Production 데이터 값, 계정 식별자, saved query와 query result는 첨부에서 제거한다.
Article revision, 수동 실행, cancel/completion receipt, publication/revoke audit sequence만
남긴다.

## 이슈 종료 순서

1. 각 session의 실패와 blocked 항목을 먼저 해당 이슈에 기록한다.
2. 모든 OS/provider/account 조건이 충족된 issue만 본문의 체크박스를 갱신한다.
3. 최신 `main`에서 관련 CI가 성공했는지 다시 확인한다.
4. 완료 조건을 항목별로 재대조하고 `needs-live-validation` label을 제거한다.
5. 구현·자동 검증·실기 증거가 모두 연결된 뒤 issue를 닫는다.

한 session이 여러 이슈를 검증해도 evidence comment는 각 이슈에 남긴다. 링크만
복사하지 말고 그 이슈가 요구하는 판정과 남은 조건을 함께 적는다.
