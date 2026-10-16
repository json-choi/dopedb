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
| UX-019 | `완료` | Welcome command를 상태별로 분리했다. 준비된 Demo는 실제 학습 command 3개만, 연결된 일반 상태는 New Query만, 미연결 상태는 New connection과 사용 가능한 Guided Demo만 표시한다. 전역 chrome이 소유한 Action Search를 Welcome에서 반복하지 않는다. |
| UX-020 | `완료` | 700px 이하 Settings의 검색·tree·breadcrumb를 한 줄 section select로 줄여 실제 설정을 바로 보이게 했다. 680px에서는 select만, 920px에서는 기존 search/tree/breadcrumb가 유지되는 것을 실행 확인했다. |

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

## Workspace Web 0.4.1 점검

인증된 production Workspace Web을 1512×863에서 accessibility tree와 함께
확인하고 Desktop의 소유 경계와 대조했다. 실계정 이름, 이메일, workspace ID는
검수 기록에 남기지 않았다.

| ID | 상태 | 발견 사항과 닫힌 동작 |
| --- | --- | --- |
| WW-001 | `완료` | 8개 번호형 최상위 메뉴를 Workspaces, Access, Providers, Workspace settings, My account 5개로 줄였다. 역할상 사용할 수 없는 목적지는 계속 숨긴다. |
| WW-002 | `완료` | 멤버와 DB별 grant를 Access 한 화면에, provider 승인과 managed DB 등록·복구를 Providers 한 화면에 배치해 한 작업을 위해 메뉴를 왕복하지 않게 했다. |
| WW-003 | `완료` | Workspace Web의 Analysis 관리 화면을 제거했다. Article 작성·조회·수동 재실행·공개 관리는 Desktop이 소유하고 immutable 공개 HTML 읽기 경로만 Web에 남긴다. |
| WW-004 | `완료` | 같은 페이지에서 최대 세 번 반복되던 번호·제목·설명·workspace 요약을 한 개의 compact page header와 한 줄 context로 축소했다. 첫 실제 command가 초기 viewport 안에 나타난다. |
| WW-005 | `완료` | 1480px 폭의 장식 중심 hero와 큰 빈 공간, shadow panel과 card-in-card를 제거하고 1120px의 flat 관리 surface, 짧은 문장과 일정한 divider를 사용한다. |
| WW-006 | `완료` | provider 목록은 연결된 계정과 새 계정 연결을 분리하되 setup form은 사용자가 provider를 선택했을 때만 연다. managed DB 목록과 recovery는 같은 Providers 문맥에 유지한다. |
| WW-007 | `완료` | 백업·암호화와 삭제 위험 영역을 분리하고 삭제 control은 접힌 위험 영역에서만 공개한다. 차단 항목의 복구 link는 Providers 또는 Access의 실제 목적지로 연결한다. |
| WW-008 | `완료` | Desktop의 exact managed DB 복구 deep link와 OAuth callback을 새 Providers URL로 통일하고, 사용하지 않는 과거 settings section alias와 Analysis 관리 component를 제거했다. |
| WW-009 | `완료` | AI Chat의 Environment binding은 공개 connection content revision을 pin한다. 내부 lease/revocation epoch 변경을 콘텐츠 변경으로 오인해 409를 반복하던 경로를 차단했다. |
| WW-010 | `완료` | 페이지별 단일 h1과 실제 관리 영역의 h2 계층, keyboard-native details, 가로 overflow를 지원하는 compact navigation을 유지해 좁은 화면과 보조기기에서도 구조를 읽을 수 있게 했다. |
| WW-011 | `완료` | Workspace settings의 일반 제목과 lifecycle 내부 제목 반복을 실제 lifecycle h1 하나로 합쳤다. 불필요한 외곽 card를 제거하고 Backup → encryption key → retention → danger zone을 선행 조건 순서의 단일 세로 흐름으로 배치했다. |
| WW-012 | `완료` | workspace 삭제 blocker가 있으면 이름 입력과 삭제 command를 숨기고 해결 항목과 Access/Providers 복구 link만 보여 준다. blocker 해소 뒤에는 exact-name 입력을 유일한 확인으로 사용하며 같은 동작에 browser confirm을 겹치지 않는다. |
| WW-013 | `완료` | Access의 revision conflict는 conflict article 하나만 경계로 유지하고 두 version과 field를 무테 column·row divider로 평탄화해 관리 panel 안의 중첩 surface를 줄였다. |

## 공개 사이트 검수 — 2026-09-16 (#240)

정본 브랜드 생성기는 1200×630 정적 Open Graph 카드를 함께 생성한다.
한·영 Open Graph와 Twitter metadata는 같은 `/og-card.png`를 가리킨다.
`brand-assets` CI는 기존 ICNS까지 포함한 18개 생성물의 drift를 검사한다.
FAQ의 기존 7개 답변을 모두 표시해 서비스 중단 시의 제한, Article 초대,
Alpha 사용 범위가 실제 페이지에서도 읽히도록 했다. 법률 문구와 역사적
Desktop screenshot은 이 변경의 대상이 아니다.

로컬 Chromium에서 1440×1000 영어와 390×844 한국어를 확인했다. 애니메이션을
정지한 실제 합성 배경을 캡처하고 글자만 숨긴 동일 위치의 픽셀과 computed
foreground/alpha를 sRGB 상대 휘도로 비교했다. 텍스트 영역의 최소 대비이며
모든 시점·기기에서의 성능이나 접근성 보증은 아니다.

| 대표 영역 | 변경 전 desktop / mobile | 변경 후 desktop / mobile |
| --- | --- | --- |
| 큰 hero 제목 | 4.63 / 15.34 | 4.32 / 15.38 |
| 본문 | 8.12 / 9.93 | 9.34 / 9.87 |
| 로컬 실행·Alpha 보조 문구 | 3.56 / 2.84 | 8.02 / 8.37 |
| 은하 탐험 도움말 | 3.95 / 3.52 | 10.01 / 9.93 |

실패한 두 작은 텍스트만 수정했다. 보조 문구의 65% opacity를 제거하고,
은하 위 도움말에 기존 night 90% 배경과 전체 muted foreground를 사용한다.
제목은 큰 글자 기준 3:1, 본문·보조 문구는 4.5:1을 넘었다.
두 캡처의 별 위치 차이가 있어 변경하지 않은 영역도 수치가 조금 다르다.

일반 재생 2.1초 동안 renderer rotation 갱신 46회(약 21.9fps)를 관찰했다.
DPR 3의 1440×1000 viewport는 drawing buffer 1697×1178(1,999,066 pixel)로
제한되었다. 이는 30fps·DPR 1.5·200만 pixel 상한을 확인하는 표본이며 GPU
프레임 시간이나 실기기 성능 벤치마크는 아니다. 기존 초기 compact 10,600개 /
desktop 23,200개 별과 한 번만 만드는 buffer 계약은 그대로 유지했다.
reduced-motion은 `running=false`, 강제 WebGL context loss는 fallback과 서버
본문을 유지했다. JavaScript를 끈 영어 페이지도 제목·FAQ 7개를 렌더링했다.
두 viewport 모두 가로 overflow가 없었다. 배포는 수행하지 않았다.

## 핵심 기능 15종 감사 — 2026-10-10

### 조건과 방법

- 기준선: app 0.5.2(`5aaa0882`). 개선 결과는 같은 기준선 위의 미커밋 작업 트리다.
- 각 기능은 읽기 전용 독립 감사(5묶음)로 채점했다. 수정한 뒤 같은 기준과 같은 감사자로
  세 차례 다시 채점했고, 감사자는 코드 근거(file:line)로만 판정했다.
- 실기 검수에는 개발 앱(debug build)과 로컬 PostgreSQL 18, 왕복 30ms 지연 프록시를 썼다.
  실제 UI 경로는 웹뷰 DOM으로 조작했고, 앱 tracing 단계와 PostgreSQL statement 로그로
  쟀다. 창이 가려진 상태에서 측정해 프런트 ACK 대기가 부풀므로 아래 수치는 ACK 대기를
  뺀 백엔드 시간이다.
- 채점 기준(100점): 기능 완결성·정확성 25, 성능·반응성 20, 상태 피드백 15,
  사용성·발견 가능성 15, 오류 예방·복구 10, 접근성 10, 일관성·국제화 5.

### 점수

| # | 기능 | 감사 전 | 1차 재감사 | 최종 |
| --- | --- | --- | --- | --- |
| 01 | DB 연결 설정·접속 검사 | 59 | 81 | 92 |
| 02 | 멤버별 로컬 자격 증명 보관 | 62 | 81 | 92 |
| 03 | 구성원별 단기 DB 자격 증명 | 54 | 74 | 87 |
| 04 | 테이블·열·키 메타데이터 조회 | 52 | 80 | 92 |
| 05 | 기준·대상 스키마 차이 비교 | 62 | 79 | 89 |
| 06 | SQL 편집·수동 쿼리 실행 | 56 | 78 | 92 |
| 07 | 조회 쿼리의 결과값 검사 | 56 | 77 | 89 |
| 08 | CSV·JSON 결과 내보내기 | 65 | 81 | 90 |
| 09 | 공식 Claude·Codex Agent 연동 | 56 | 86 | 94 |
| 10 | 선택 리소스 한정·단일 쓰기 대상 | 69 | 87 | 94 |
| 11 | Agent 변경 제안 승인·거절 | 52 | 77 | 93 |
| 12 | 읽기 기본값·DML/DDL 안전 설정 | 63 | 83 | 89 |
| 13 | 실행 취소·수동 트랜잭션 롤백 | 49 | 84 | 87 |
| 14 | 감사 기록·실행 결과 확인 | 61 | 83 | 88 |
| 15 | 분석 문서 공유·수동 재조회 | 53 | 82 | 88 |
| | 평균 | 57.9 | 80.9 | 90.4 |

### 성능 실측

| 시나리오 | 감사 전 | 개선 후 |
| --- | --- | --- |
| 연결 선택(콜드) | DB 목록·개요 ≈0.55s + 전체 인트로스펙션 ≈1.6s | 접속·세션 설정·DB 목록·개요 ≈0.44s, 인트로스펙션 없음 |
| 테이블 열기(카탈로그 콜드) | 페이지 ≈270ms(EXPLAIN ≈120ms 포함) + 건수 + 인트로스펙션 2회 ≈3.1s, 편집·구조 사용까지 ≈4.2s | 첫 배치 ≈0.2s + 건수 + 인트로스펙션 1회(7문장, 같은 스냅샷) ≈0.35–0.6s, 편집·구조 사용까지 ≈0.7–1.1s |
| 테이블 열기(카탈로그 웜) | + 스냅샷 인트로스펙션 ≈0.9s | 페이지·건수만 |
| 다음 페이지 | ≈205ms, 10초마다 건수 재실행 | 첫 배치 ≈120ms, 건수는 5분 캐시 |
| 정렬(인덱스 없는 열) | ≈400ms | ≈284ms(서버 정렬 시간이 대부분) |
| 필터 | ≈250ms + 건수 | ≈181ms + 건수 109ms |
| SQL 실행(5천 행 조인) | ≈570ms(EXPLAIN 미리보기 ≈200ms 포함) | ≈290ms |
| SQL 문서의 큰 `SELECT *`(행 상한 1000) | 913–1029ms(나머지 행을 끝까지 수신) | 53–58ms(상한에서 연결을 닫고 서버 전송 중단) |
| 실행 중 취소 | 서버 쿼리는 끝까지 실행 | 0.6–1.8s 안에 서버 쿼리 중단 |

### 실기에서 찾아 고친 결함

- 첫 결과가 오기 전에 취소하면 실행 ID 없이 스트림 capability만 전달되어 이미 실행 중인
  스트림을 찾지 못했다. capability로도 실행 중인 스트림과 executor를 멈추고, 취소된 스트림은
  시작하지 않는다.
- 취소한 편집기 읽기가 Activity에 `실패`로 기록되던 문제를 `취소됨`으로 바로잡았다.
- 파서가 다음 토큰 위치를 보고해 구문 오류 캐럿이 한 토큰 뒤를 가리켰다. 이름이 나온 토큰을
  가리키도록 보정했다.
- 재시작 뒤 "저장된 스키마를 표시하며 현재 스키마를 읽는 중…"이 사라지지 않았다. 원인은
  TanStack Query structural sharing이 같은 내용의 영속 Catalog 객체를 유지한 것이었다.
  영속 표식을 데이터 필드로 옮기고 시드를 항상 교체해 해결했다.
- 연결 반납 정리의 `ROLLBACK`이 대상 DB 서버 로그에 반납마다 WARNING을 남겼다. 조용한
  트랜잭션 잔존 검사로 바꾸고 호환성 확인을 첫 반납으로 미뤘다.

### 유지할 영구 계약

- 읽기 연결은 유휴 상태일 때만 풀로 돌아간다. 잘린 결과, 트랜잭션 안의 오류, 취소·시간
  초과된 읽기는 남은 행을 받지 않고 연결을 닫는다.
- Agent 변경 제안의 승인 버튼에는 자동 포커스를 두지 않는다. 새 제안은 polite 알림과
  `승인 대기 N` 표시로만 알린다.
- 스키마 비교 결과는 비교한 속성과 비교하지 않은 속성을 함께 싣는다. Agent는 `total: 0`을
  스키마 동일로 해석하지 않는다.
- 공유 연결의 구성원 비밀번호는 바인딩 당시 템플릿 엔드포인트와 TLS 강도에 묶인다.

### 95점 미만으로 남은 이유

- 실계정·배포가 있어야 검증할 수 있다.
  - 공식 Claude/Codex 로그인 세션(resume, 승인·거절·중지 왕복, 외부 `dopedb agent start`)
  - Team workspace의 hosted 재확인과 GCP/Neon/Vault 관리형 흐름
  - workspace-cloud 배포가 필요한 변경: lease 복구 코드와 복구 판정 범위, 관리형
    엔드포인트 PATCH 보존, `view=summary` 목록, 삭제 시 공개본 해지
  - packaged·Windows 빌드
- 프로토콜 릴리스가 필요하다: 제약 의미(EXCLUDE, NOT ENFORCED, NOT NULL 유효성 등),
  describe의 `capturedAt`, 스키마 비교 엔진 확장.
- 소유자 결정이 필요하다: 작업별 원격 권한 확인 캐시, Agent 프롬프트 감사 기록, 감사
  기록의 계정 범위, NULL과 빈 문자열 내보내기 구분, JSON 셀 원문 표현, MySQL 수동
  트랜잭션 읽기의 savepoint 한계.
