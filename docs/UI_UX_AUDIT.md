# UI/UX 검수 결과

이 문서는 DopeDB `0.4.0` 전체 UI/UX 점검에서 발견한 결함과 닫힌 회귀 조건을
기록한다. 기능 범위는 [`PRODUCT_UI_SCOPE.md`](./PRODUCT_UI_SCOPE.md)가 계속 소유하며,
범위 밖 기능이나 표시만 되는 control은 추가하지 않았다.

## 검수 조건

- 기준일: 2026-09-05
- 실행 검수: 현재 `main` 작업 트리의 개발 앱, macOS, 한국어, 다크 테마,
  1200×800, 비로그인 Personal Workspace, 가이드 Demo SQLite
- 실행 범위: App shell, Welcome, Explorer, Project/Environment, 연결 편집기,
  driver/cloud catalog, SQL, table, DDL, Import/Export, Services, Agent,
  Analysis Article 빈 상태, Settings
- 정적·자동 검수: Activity, MongoDB Documents, Local History, provider/승인
  dialog, compact container 상태, i18n catalog와 authoritative state owner
- 대조 기준: 실제 화면, accessibility tree, 동일 DopeDB scenario,
  [`UI_IMPLEMENTATION_TRACKER.md`](./UI_IMPLEMENTATION_TRACKER.md), 디자인 시스템 계약

## 닫힌 항목

| ID | 상태 | 닫힌 동작과 회귀 조건 |
| --- | --- | --- |
| UX-001 | `완료` | 비로그인 Personal Workspace도 실행 session/result를 현재 process 메모리에 병합한다. 계정 범위가 없을 때는 영속화하지 않고 다른 Workspace/account scope의 update는 거부한다. Demo SQLite의 `SELECT 1;` 결과가 Services에 나타나는 것을 실행 확인했다. |
| UX-002 | `완료` | 새 Environment는 빈 이름과 `development`로 시작한다. `production`을 고르면 별도 확인 checkbox를 완료해야 mouse·keyboard 제출이 모두 활성화된다. |
| UX-003 | `완료` | Explorer relation은 실제 search result key가 있을 때만 search-active가 된다. 검색이 없을 때 전체 행이 선택색으로 보이지 않으며 pure-state 회귀 검사를 추가했다. |
| UX-004 | `완료` | 새 연결 Cloud catalog에는 실제 credential command가 있는 GCP Cloud SQL만 보인다. 정보 전용 Cloud/Driver 화면 footer는 `닫기` 하나만 제공한다. 기존 managed profile의 provider 복구 항목은 유지한다. |
| UX-005 | `완료` | Import/Export panel의 header와 create/approval action footer를 scroll body 밖에 고정했다. 1200×800에서 form과 history가 내부 scroll되고 `Job 만들기`가 status bar와 겹치지 않는 것을 확인했다. |
| UX-006 | `완료` | Personal 범위의 Analysis filter를 숨기고 로그인 또는 Team Workspace 선택 CTA를 제공한다. Knowledge 화면의 status breadcrumb는 중립 `Projects > Analysis`로 바뀌며 과거 DB/table 경로를 재사용하지 않는다. |
| UX-007 | `완료` | SQLite 실행 대상, connection overview, Action Search와 접근성 이름은 절대 경로 대신 연결명과 안전한 basename을 사용한다. 경로를 검색 keyword로만 유지하며 일상 화면·tooltip에는 노출하지 않는다. |
| UX-008 | `완료` | Agent가 overlay mode로 열릴 때 경쟁 Services panel을 닫는다. 1200×800에서 Services toggle이 꺼지고 Agent가 단일 작업 주체가 되는 것을 확인했다. |
| UX-009 | `완료` | WHERE/ORDER BY에 입력 경계, background, focus와 dirty affordance를 추가했다. 결과 pill은 행 범위·전체 수·잘림·실행 시간을 항상 표시하고 grid footer inset으로 마지막 cell을 가리지 않는다. |
| UX-010 | `완료` | 연결 이름 진단은 이름 편집 또는 Save/Test 시도 뒤에만 공개한다. catalog 탐색 직후에는 `문제 0`, Save 시도 뒤에는 field 오류와 `문제 1`이 나타나는 것을 접근성 tree로 확인했다. |
| UX-011 | `완료` | Driver capability, Action Search relation 종류, Activity action/status/origin/kind, Local History, Analysis actor/result/revision 상태를 i18n presentation mapping으로 통일했다. |
| UX-012 | `완료` | BigQuery의 내부 generic provider 값은 UI에서 `Google BigQuery CLI`로 표시해 실제 공식 CLI 인증·실행 경로를 설명한다. |
| UX-013 | `완료` | Activity 새로고침은 진행 중에도 의미 있는 번역 label을 유지하고 `aria-busy`와 회전 icon으로 상태를 전달한다. |
| UX-014 | `완료` | DDL viewer의 고정 최소 높이를 줄이고 내용 기반 높이와 최대 높이 내부 scroll을 사용한다. 7줄 SQLite DDL에서 compact modal과 항상 보이는 footer를 확인했다. |
| UX-015 | `완료` | 개인정보 설명을 `수집하지 않음 / 공유 항목 / 전송 및 보관 / 끄면 삭제되는 항목` description list로 나눴다. 정책 link와 build 가용성은 별도 계층을 유지한다. |
| UX-016 | `완료` | 활성 Agent adapter가 없으면 composer 전체를 숨기고 중앙 빈 상태의 설정 CTA 하나만 남긴다. |
| UX-017 | `완료` | Welcome command를 icon과 행 경계가 있는 flat menu로 바꿨다. connection overview는 같은 SQLite basename/endpoint를 중복하지 않고 안전 상태를 함께 표시한다. |
| UX-018 | `완료` | MongoDB limit는 입력 중 문자열 draft를 보존한다. 빈 값·0·소수·상한 초과는 blur/실행 때 가까운 오류로 표시하고 조용히 `100`으로 바꾸지 않는다. pure validation 회귀 검사를 추가했다. |

## 유지할 영구 계약

- 위험한 기본값은 두지 않으며 production 의미는 명시적 재확인을 요구한다.
- enabled control은 실제 command와 state owner가 있을 때만 표시한다.
- 화면의 현재 scope, breadcrumb, 권한·안전 상태와 접근성 이름은 같은 대상을
  가리킨다.
- 로컬 절대 경로, 내부 enum과 wire value는 일상 UI에 그대로 노출하지 않는다.
- scroll이 필요한 tool panel도 header와 주 동작, 복구 경로는 항상 보이게 한다.
- 공용 semantic token, static Tailwind v4 utility, 공용 modal/button/grid primitive를
  유지한다.

## 남은 실환경 검수 경계

이번 변경에서 실제 Team 로그인 왕복, Neon/GCP/BigQuery 실계정 권한, 실제 쓰기
승인, 공식 Claude/Codex adapter 세션, Windows와 900px 이하 모든 compact 조합은
실행하지 않았다. 이 경계는 위 결함의 미수정 상태가 아니라 각 기능의 기존 packaged
acceptance이며, [`UI_IMPLEMENTATION_TRACKER.md`](./UI_IMPLEMENTATION_TRACKER.md)의
`partial` 항목에서 계속 추적한다.
