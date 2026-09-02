# DopeDB UI 디자인 시스템

DopeDB의 UI/UX는 제품 작업 흐름, 접근성, 지원 플랫폼 동작을 정본으로 한다.
app chrome, tool window, document tab, toolbar, data editor, query console,
Services와 status bar는 이 문서의 제품 소유 구조·밀도·상호작용을 따른다.
안전 승인·감사 기능도 같은 UI 문법 안에서 확장한다.

DopeDB는 Tailwind CSS v4를 화면 배치의 기본 도구로 사용한다. Tailwind는 별도
디자인 언어가 아니라 `--ds-*` 역할 토큰과 앱 정본 primitive를 사용하는 얇은
utility 계층이다. 기존 CSS는 기능 단위로 제거하며 vendor widget처럼 CSS가
구조적으로 더 알맞은 경계만 유지한다.

영역별 UI와 기능 상태는
[`docs/UI_IMPLEMENTATION_TRACKER.md`](../../docs/UI_IMPLEMENTATION_TRACKER.md)에
기록한다. DopeDB screenshot baseline은 내부 회귀 증거일 뿐 디자인 정본이나
packaged runtime 증거가 아니다.

## 정본

| 관심사 | 정본 |
| --- | --- |
| core chrome 색상·타이포그래피·간격·radius·elevation | `src/design-system/tokens.css` |
| terminal·Agent syntax·chart 범위 palette | `src/design-system/scoped-palettes.css` |
| CSS 변수를 읽을 수 없는 생성 artifact palette | `src/design-system/artifactPalettes.ts` |
| Tailwind theme bridge와 진입점 | `src/design-system/index.css` |
| 버튼·배지·카드·폼·toolbar·상태 | `src/design-system/system.css` |
| 반복되는 React UI primitive | `src/design-system/components/` |
| 앱 shell과 workbench 레이아웃 | shell·tool-window TSX의 정적 Tailwind utility |
| 새 화면 고유 배치 | TSX에 직접 작성한 정적 `tw:` utility |
| React Flow generated DOM | `src/features/erd/ErdCanvas.css` vendor integration |
| xterm generated DOM | upstream `@xterm/xterm/css/xterm.css` + host TSX Tailwind utility |

컴포넌트 코드에 토큰이 이미 있는데 hex/rgb 값을 직접 추가하지 않는다. 새 역할이
필요하면 `tokens.css`에 surface/foreground 쌍으로 정의하고 사용한다.

## Tailwind v4 계약

- `tailwindcss`와 공식 Vite/PostCSS 통합은 `4.3.3`으로 고정한다.
- 모든 utility는 `tw:` 접두어를 사용한다. 기존 의미 클래스와 이름이 충돌하지
  않게 하는 migration 경계다.
- Preflight는 import하지 않는다. 기존 reset을 화면별로 옮기고 세 앱의 시각
  회귀를 확인한 뒤 별도 변경에서만 활성화를 검토한다.
- `@theme inline`은 semantic token만 노출한다. `tw:bg-[#111]`,
  `tw:text-[rgb(...)]` 같은 raw color utility는 금지한다.
- utility class는 TSX에 보이는 정적인 완전한 문자열이어야 한다. 런타임 조각
  조합과 utility 문자열만 감추는 `styles.ts`/style map은 사용하지 않는다.
- 같은 시각·상호작용 계약이 반복되면 class 문자열을 복사하지 않고
  `src/design-system/components/`의 실제 공용 컴포넌트나 `system.css`의 정본
  primitive로 승격하고 이 문서에 등록한다.
- 버튼은 `src/design-system/components/Button.tsx`가 소유한다. `.badge`,
  `.ds-panel`, `.ds-toolbar`처럼 비 React surface에 필요한 정본 primitive만
  `system.css`가 소유한다. utility로 같은 primitive를 화면마다 재구현하지 않는다.
- 새 screen/component CSS와 CSS module은 만들지 않는다. CSS 추가는 token,
  reset, 정본 primitive, 문서화된 vendor integration
  경계에만 허용한다.
- 전용 CSS를 이전하면 import와 파일을 같은 변경에서 삭제한다. 호환용 wrapper나
  중복 selector를 남기지 않는다.
- 데스크톱은 `@tailwindcss/vite`, 두 Next 앱은 `@tailwindcss/postcss`를
  사용한다. 세 실행면 모두 같은 migration 원칙을 따른다.

결정 배경과 완료 조건은
[`docs/adr/0005-tailwind-v4-migration.md`](../../docs/adr/0005-tailwind-v4-migration.md)에
기록한다.

## 시각 방향

- 앱 chrome은 눈에 띄지 않고 사용자의 데이터와 도구를 감싼다.
- macOS native menu와 별도로 WebView 안에 File/Edit/View 계열 텍스트 메뉴를
  만들지 않는다. 앱 내부 title toolbar는 project context, tool-window launcher,
  search와 settings를 소유한다. project context의 chevron은 단순 화면 이동
  button에 붙이지 않는다. 실제 활성 workspace 이름과 전환, 새 연결, workspace
  관리 action을 제공하는 portal menu여야 하며 Explorer 안에 같은 selector를
  중복 배치하지 않는다.
- title toolbar 중앙에는 현재 주요 tool window의 직접 launcher만 둔다.
  보조 tool window와 document 생성 action은 끝단의 실제 `ToolbarMenu`에
  배치하고, 구현되지 않은 Files/VCS를 모양만 있는 launcher로 만들지 않는다.
  Analysis Article도 별도 직접 launcher로
  승격하지 않고 Environment의 `Analyses` folder와 More menu가 소유한다.
- generic `새 연결` 진입은 특정 engine form을 임의 선택하지 않고 검색 가능한
  provider/driver `CommandMenu`를 즉시 연다. engine/provider preset이 명시된
  진입만 해당 속성 form을 바로 표시한다. 실제 생성하지 않는 demo나 지원하지
  않는 provider resource를 선택지 설명으로 약속하지 않는다.
- Data Sources and Drivers dialog는 제품 계약의
  42px 세로 category rail과 250px catalog list로 책임을 분리한다. rail에는
  실제 화면이 있는 Data Sources, Clouds, Drivers만 두며 label은 hover와
  keyboard focus tooltip로 제공한다. data source와 driver는 각각 하나의
  검색 가능한 목록만 가지며, driver detail은 backend
  catalog가 반환한 이름, version, 설치 상태, 지원 connection method와
  capability만 표시한다. `+` popup의 provider group은
  `Data Source from Cloud Provider`를 사용한다. Clouds category는 실제
  credential inventory를 열고
  로그인·권한·조회 실패를 그대로 드러내며, 존재하지 않는 cloud resource
  browser를 모양만 만들어 대체하지 않는다. General의 connection type은
  `Default`와 실제 URL parser가 소유하는 `URL only`만 제공한다. URL mode도
  분리된 임시 모델을 저장하지 않고 Test, Apply, OK가 사용하는 하나의
  `ConnectionProfile`로 즉시 정규화하며 password, token과 DopeDB 내부
  parameter는 redacted URL projection에 표시하지 않는다.
  선택 mode는 driver URL과 분리된 내부 profile metadata로 저장·복원한다.
  runtime이 지원하지 않는 SQLite In-memory는 선택지처럼 보이게 만들지 않는다.
  760px 이하 dialog에서는 같은 세 책임을 `SegmentedControl`로 유지하고,
  현재 data source/provider/driver를 실제 selector로 전환한다. desktop
  catalog pane을 숨기면서 전환 기능까지 없애지 않는다.
  Options는 실제 runtime에 연결된 PostgreSQL/MySQL time zone, keep-alive,
  allowlisted session `SET` startup script와 전체 engine의 idle
  auto-disconnect만 enabled control로 제공한다. operation 단위 automatic
  transaction은 읽기 전용 상태로 설명하고 manual transaction, sticky single
  session, switch-schema, auto-sync처럼 backend lifecycle이 없는 기능은
  selector나 checkbox로 흉내 내지 않는다. 이 값은 Advanced driver property와
  중복하지 않는 `dopedb.*` 내부 profile metadata로 저장하며 Test, Apply, OK의
  같은 validation/runtime 경로를 사용한다.
  Schemas는 configured database를 root로 두고 backend overview가 반환한 실제
  namespace를 checklist로 표시한다. relation에서 schema 이름을 추측하는
  경로만 사용하지 않아 empty PostgreSQL schema도 선택할 수 있어야 한다.
  PostgreSQL/MySQL의 다른 database는 별도 pool과 catalog identity가 구현되기
  전까지 현재 database 아래의 가짜 node로 추가하지 않는다.
- tool window는 좌·우·하단 anchor, tab stack, resize와 persistence를 공유하는
  하나의 layout 문법으로 구현한다.
- Database Explorer는 별도 제목 header나 누적 section header를 두지 않고 한 개의
  compact command strip만 사용한다. 고정 action은 Project 추가(`folderPlus`),
  Environment 추가(`plus`), 전체 refresh, view option이며 hide는 strip hover 또는
  keyboard focus에서만 나타난다. expand/collapse, 검색, 현재 editor 객체 동기화,
  row count는 view option 안에 둔다. 연결 생성·설정·query·relation data/DDL·schema
  compare는 각각 Environment 상세, connection row/menu, 전역 workbench, relation
  surface가 소유하며 Explorer 상단에 중복하지 않는다.
  SQL data source 행의 작은 범위 badge는 발견한 namespace 중 현재 선택 수를
  표시하고 portal `ToolbarMenu`의 실제 checklist를 연다. 이 checklist는 Data
  Sources의 Schemas 탭과 같은 저장 값을 사용하며 화면별 popup이나 별도 style
  map을 만들지 않는다.
  검색 input은 view option이 열었을 때만 하나만 표시하며 connection subtree에
  검색 input을 중복하지 않는다. backend disconnect lifecycle이 없는 동안
  소유자 없는 Deactivate를 모양만 있는 action으로 추가하지 않는다.
- 색상보다 `muted`, `selection`, `border`를 먼저 사용한다.
- 일반 surface는 평평하게 유지한다. 그림자는 popover, dialog, toast처럼 떠 있는
  surface에만 사용한다.
- 카드 안에 카드를 중첩하지 않는다.
- 선택 상태는 `--ds-selection`을 사용한다. primary 색을 선택 배경으로 쓰지 않는다.
- primary 버튼은 한 흐름에 하나만 둔다.

## 색상 역할

토큰은 surface와 foreground를 쌍으로 사용한다.

| 역할 | 용도 |
| --- | --- |
| `--ds-background` / `--ds-foreground` | 앱 canvas와 기본 텍스트 |
| `--ds-card` / `--ds-card-foreground` | canvas 위 작업 패널 |
| `--ds-popover` / `--ds-popover-foreground` | menu, dialog, toast |
| `--ds-primary` / `--ds-primary-foreground` | 단일 affirmative action |
| `--ds-secondary` / `--ds-secondary-foreground` | 낮은 강조의 control |
| `--ds-muted` / `--ds-muted-foreground` | caption, placeholder, 비활성 chrome |
| `--ds-selection` / `--ds-selection-foreground` | muted IDE selection, active tab, current row; affirmative primary blue와 분리 |
| `--ds-destructive` / `--ds-destructive-foreground` | 삭제·폐기·차단 |
| `--ds-input` | form field와 outline control |
| `--ds-ring` | focus-visible과 selected cell outline |
| `--ds-editor-surface` | SQL editor와 코드 인접 surface |
| `--ds-worktree-sidebar*` | database explorer와 navigation |

`--ds-background`는 editor와 tool-window 내부의 가장 어두운 작업 면,
`--ds-card`와 `--ds-bg-app`은 title/status chrome 및 panel gutter를 소유한다.
따라서 화면별 wrapper가 임의의 어두운 배경을 다시 만들지 않는다.
title toolbar는 `--ds-card`의 평평한 chrome surface를 사용한다. project context를
장식용 tint나 gradient로 강조하지 않고 실제 선택·focus 상태만 semantic token으로
표시한다.

DopeDB 기존 화면은 `--ds-surface-*`, `--ds-text*`, `--ds-accent*` 별칭을 사용한다.
이 별칭은 위 역할 토큰에 연결되어 있으므로 새 화면에서는 역할이 더 명확한 정본
토큰을 우선한다.

색상 상태는 다음에만 사용한다.

- `--ds-info`: 정보와 실행 중 상태
- `--ds-success`: 성공, 연결됨, trust
- `--ds-warning`: 검토 필요, medium risk
- `--ds-danger`: 실패, 차단, destructive

상태색을 navigation 선택이나 장식에 재사용하지 않는다.

### 범위별 palette 소유권

core chrome과 색이 본질인 출력 surface는 같은 namespace를 공유하지 않는다.
`pnpm check:ui-palette`는 아래 소비자 경계를 검사하고 feature TSX/CSS의 raw
color를 거부한다.

| 범위 | 정본 | 허용 소비자 | fallback과 경계 |
| --- | --- | --- | --- |
| core chrome | `tokens.css`의 surface/foreground/selection/focus/status 역할 | 모든 제품 화면과 공용 primitive | neutral surface가 기본이며 다른 palette의 색을 navigation·button·panel에 사용하지 않음 |
| Agent syntax | `scoped-palettes.css`의 `--ds-syntax-*` | `agentSyntax`의 완료된 code fence | grammar/highlighter가 없으면 색 없는 escaped code를 표시하며 terminal ANSI 역할을 빌리지 않음 |
| terminal ANSI | `scoped-palettes.css`의 `--ds-terminal-*` | `resolvePtyTheme` | xterm host의 background/foreground/selection은 core 역할을 별도 주입하고 ANSI 색은 terminal 밖에서 사용하지 않음 |
| provider/engine brand | `src/assets/db-icons/`와 `AgentProviderMark`의 로컬 정본 SVG | `EngineMark`, `AgentProviderMark` | asset이 없으면 accessible text/neutral glyph를 사용하고 brand pigment를 chrome 상태색으로 승격하지 않음 |
| ERD export artifact | `artifactPalettes.ts`의 `ERD_EXPORT_PALETTE` | `erdExport.ts` | live CSS와 무관한 deterministic SVG/PNG/PDF 출력 전용이며 앱 surface에서는 사용하지 않음 |

새 scoped palette를 만들 때는 namespace, 단일 소비자 경계, 색 없는 fallback을 이
표에 먼저 추가한다. 단순히 새 색이 필요하다는 이유로 core token을 늘리지 않는다.

## 타이포그래피

- Sans: 앱에 번들한 `SUIT Variable` 우선, OS sans-serif fallback. npm package
  `@sun-typeface/suit`의 Variable WOFF2를 고정 버전으로 포함하며 CDN이나 설치된
  시스템 폰트에 의존하지 않는다.
- Mono: `--ds-font-mono`. 경로, SQL, 값, 식별자, 숫자 비교에 사용한다.
- Body: 14px.
- Dense UI: 13px.
- 보조 텍스트: 12px.
- 기본 본문과 일반 leaf row는 최소 450, tree section·일반 control·DB row는 550,
  section emphasis는 650, heading과 강한 category label은 700 weight를 사용한다.
  `font-normal/medium/semibold/bold`는 이 네 semantic token에 대응하며 화면별
  임의 숫자 weight로 가독성을 보정하지 않는다.
- uppercase category label: 11px, 650–700 weight, `0.05em` tracking.
- 큰 제목은 `-0.02em`, 패널 제목은 `-0.01em` tracking을 사용한다.
- 데이터 숫자는 `font-variant-numeric: tabular-nums`를 사용한다.

## Radius와 elevation

compact control과 둥근 outer tool-window geometry를 역할별 scale로 표현한다.

- 작은 내부 요소: `--ds-radius-xs` (4px)
- button/input: `--ds-radius-sm` (6px)
- 일반 surface: `--ds-radius-md` (8px)
- card/panel: `--ds-radius-lg` (10px)
- badge/count: `--ds-radius-pill`

Elevation은 세 단계만 허용한다.

1. 기본: border 또는 divider
2. control: `--ds-shadow-control`
3. floating: `--ds-shadow-popover`

일반 card/panel에는 shadow를 추가하지 않는다.

## 컴포넌트

### React primitive

- `workspace-cloud/app/components/Brand`와 `site/app/DopeDBMark`: workspace의
  선형 D 마크를 DopeDB 브랜드 정본으로 공유한다. 공개 사이트 header/footer와
  workspace navigation은 이 도형을 사용하고, favicon·OAuth·Tauri bundle
  아이콘은 `scripts/generate-icons.py`가 같은 D 마크에서 생성한다. database
  engine이나 외부 Agent provider 로고는 이 브랜드 자산으로 대체하지 않는다.
- `site/app/MarketingButton`: 공개 마케팅 사이트의 다운로드·소스 CTA가 공유하는
  primary/secondary anchor primitive. `TrackedLink`를 합성해 선택적인 analytics
  event와 동일한 반응형 폭·상태를 소유하며 page에서 CTA utility를 복사하지
  않는다. 사이트 전용 색·배경·그림자는 `site/app/globals.css`의 theme token만
  소유하고 화면 selector는 두지 않는다.
- `site/app/PlatformDownloads`: 공개 사이트의 header·hero·download CTA가 공유하는
  OS/CPU 추천 경계. Windows와 브라우저가 확실히 밝힌 Mac architecture만 안정된
  latest-download 별칭으로 직접 연결하고, Mac CPU가 숨겨지거나 지원하지 않는
  기기에서는 Apple Silicon/Intel/Windows 선택 surface로 이동한다. 추천과 수동
  선택 analytics를 구분하며 user-agent 추측으로 잘못된 DMG를 자동 선택하지 않는다.
- `workspace-cloud/app/components/Controls`: workspace 관리 화면의
  `ControlButton`, `ControlLink`, field/input/select/textarea 밀도를 함께 소유한다.
  외부 관리 콘솔로 이동하는 action도 화면에서 button utility를 복사하지 않고
  `ControlLink`를 사용한다. Workspace 관리 panel의 header와 최상위 본문은
  desktop 24px, 640px 이하 16px의 같은 content gutter를 사용한다. Database
  요약과 우측 action은 확장 상태에서도 첫 2열을 유지하고, 복구 안내처럼 길어지는
  보조 내용은 그 아래 전체 폭 grid row가 소유한다.
- `IdeTitleToolbar`, `IdeStatusBarSurface`: title/status chrome의
  고정 높이와 좌·중앙·우 slot. feature shell은 command와 state만 제공한다.
- `IdeToolbarLauncher`: title toolbar의 32px launcher와 중립적인 open/pressed
  상태. tool window가 열렸다는 이유만으로 primary 파랑을 사용하지 않는다.
- `IdeTabStrip`, `IdeTab`: 평평한 document strip과 strip 안쪽의 둥근 active
  tab. active tab만 Tab 순서에 두고 ArrowLeft/Right/Home/End로 enabled tab을
  이동·선택한다. 화면별 rectangular selection이나 bottom accent를 다시 만들지
  않는다.
- query toolbar는 정상 autosave 완료 아이콘을 상시 반복하지 않는다. 저장 중,
  미저장, conflict, 실패처럼 사용자가 알아야 하는 예외 상태만 schema selector
  뒤의 status slot에 표시하고, 실행 결과는 editor inline marker가 소유한다.
- `IdeToolTabStrip`, `IdeToolTab`: Services 같은 tool window의 tab row와
  둥근 selected capsule. 일반 document 전환은 40px `document`, Services처럼
  36px command row와 나란히 놓이는 tab은 `compact` density를 사용한다. 다중
  결과 tab이 가용 폭을 넘으면 strip 안에서 수평 이동하고 바깥 pane을
  밀어내지 않는다. horizontal roving keyboard 규칙은 `IdeTab`과 동일하다.
- `Button`: 전역 `.btn`을 대체하는 Tailwind button primitive. variant, density,
  icon geometry, tone, active/expanded state를 semantic prop으로 소유한다.
  popup 내부 full-width action은 화면별 class를 만들지 않고
  `presentation="menuItem"`을 사용한다.
- `ResizeSeparator`: shell sidebar, Services 높이, data-grid column이 공유하는
  keyboard/pointer resize 경계. 실제 dimension과 min/max/now ARIA를 연결하고,
  방향키의 bounded step, Home/End 경계 이동, double-click reset을 소유한다.
  저장과 pointer drag lifecycle은 각 feature의 기존 state owner가 유지한다.
- `Tooltip`: icon-only command와 compact help affordance의 portal tooltip.
  짧은 hover/focus delay, viewport collision, 위·아래 flip, `Esc` dismiss를
  소유한다. `Button iconOnly`는 `title` 또는 `aria-label`을 이 primitive에
  전달해 native tooltip과 화면별 hover popup을 만들지 않는다.
- `WorkbenchButton`: `Button`을 합성한 query, table, result command row의
  32px label/icon action.
  `variant`, `tone`, `active`, `collapse` data contract로 상태와 compact overflow를
  표현하며 화면이 전역 `.btn` 조합이나 조건부 class string을 만들지 않는다.
- `ManualTransactionControls`: query/data toolbar가 공유하는 feature composition.
  `WorkbenchButton`만 합성해 Auto/Manual/failed 상태와 commit/rollback command를
  같은 밀도로 표시하며 화면별 Tx utility나 style map을 만들지 않는다.
- `ProgressBar`: 업데이트 다운로드, Services 작업, 결과 내보내기가 공유하는
  determinate/indeterminate 진행률 primitive. `default`와 `compact` 밀도만
  허용하고 화면별 track/fill utility나 임의 최소 진행률을 다시 만들지 않는다.
- `RenderRecoveryBoundary`: Markdown, diagram, provider payload처럼 선택적인
  rich surface의 render 실패를 해당 feature 안에 격리한다. 오류 원문은 UI에
  노출하지 않고 호출자가 제공한 안전한 fallback과 명시적 retry만 표시하며,
  이후 진단 수집은 별도 observer가 소유한다.
- `ProviderTargetLabel`: Explorer, connection picker, workbench가 공유하는
  provider target feature composition. 현재는 PD-28의 Neon branch identity만
  허용하며, 긴 ID는 mono ellipsis와 tooltip으로 보존하고 provider state는
  semantic status dot으로 표시한다. 화면마다 별도 branch badge를 만들지 않는다.
- `ToolbarMenu` trigger도 `custom`/`variant` data contract가 label, icon,
  tree badge, grid header 밀도를 소유한다. feature가 trigger별 class map을
  만들거나 전역 `.btn`을 섞지 않는다.
- `ToolWindowHeader`: Database Explorer, Agent, provider 패널의 고정 헤더와
  우측 action 슬롯. `divider={false}`는 Agent surface처럼 header와 본문이
  하나의 평면을 이루는 tool window에서만 하단 divider를 제거한다.
- `ToolWindowSideSurface`: Explorer와 Local History의 데스크톱
  left-anchor frame과 compact full-sheet/open state. feature CSS나 부모
  selector 없이 정적 Tailwind data variant로 같은 slide 동작을 공유한다.
- `ToolWindowHideButton`: 닫기/숨기기의 공통 minus command.
- `ToolWindowVerticalSplit`: Local History에서 관찰한 primary/secondary
  vertical split. 비율은 `--ds-tool-window-primary-ratio`가 소유한다.
- `EngineMark`: form/action 기본 크기와 24px tree row 안의 `tree` 크기를
  함께 소유한다. 로컬 엔진 SVG와 Iconify Simple Icons의 공식 브랜드 SVG가
  동일한 quiet monochrome 크기·필터를 사용하며, feature가 이미지 크기나
  wrapper 크기를 다시 지정하지 않는다.
- `ToolWindowComposer`, `ToolWindowComposerDock`, `ToolWindowComposerInput`,
  `ToolWindowComposerContext`: AI Chat의 multiline 입력면, 내부 context row와
  외부 Agent/model row. 입력면의 `expanded` 상태는 실제 확대·복원 action과
  연결되고 `busy` 상태는 Agent가 응답·승인을 기다리는 동안 활성 작업 경계를
  유지한다. 화면별 textarea 크기 CSS를 만들지 않는다.
- `AgentProviderMark`: AI Chat과 Agent 설치 흐름에서 Claude와 Codex를 구분하는
  16px 단색 브랜드 마크. Iconify Simple Icons의 `claude`와 `openai` 정본을
  로컬 번들로 사용하고 feature별 임시 SVG나 상태색 대용 브랜드색을 만들지 않는다.
- `AgentCliStatusBadges`, `AgentCliDetectionNotice`: 시작 모달과 Agent Tools가
  공유하고 AI Chat도 같은 상태 어휘를 따르는 feature composition. 로컬 CLI의
  탐지 중, probe 실패, 미설치, 로그인 필요, 준비 상태를 구분하며 실패를
  미설치로 축약하지 않는다. probe 상세와 재시도는 같은 inline 상태 surface가
  소유한다.
- `ToolbarMenu menuSize="scope"`: Explorer schema scope popover의 outer
  frame을 300px로 고정한다. feature child가 popover padding과 border를
  중복 계산하지 않는다.
- `ToolbarMenu triggerVariant="treeAction"`: 28px tree row 안의 24px overflow
  action. `triggerVariant="gridHeader"`: 28px data-grid header 안의
  filter action을 24px로 제한해 header를 늘리지 않는다.
- `ToolWindowSection`: dense tool window 안의 제목 있는 명령 그룹.
  `prominence="catalog"`는 Data Sources처럼 강한 group heading을 사용한다.
- `ToolWindowAction`: provider/demo/object launcher의 icon-label-trailing 행.
  `flush`는 Data Sources catalog처럼 selection surface가 pane 전체 폭을
  소유하되 icon/label은 20px content inset을 유지해야 하는 목록에만 사용한다.
  일반 action list의 inset rounded row와 혼용하지 않는다. 단순히 상세 영역을
  바꾸는 catalog row는 navigation chevron을 표시하지 않고, 실제 status나
  command가 있을 때만 trailing slot을 예약한다.
- `Field`, `PropertyRow`, `TextInput`, `TextAreaInput`, `SelectInput`,
  `InlineSelect`, `CheckboxField`: label, focus, disabled 상태를 함께 소유하는 dense form
  control. `PropertyRow`는 Data Sources General처럼 100px label과 control을
  가로로 맞추고 compact dialog에서는 세로로 접는다. property
  field는 `density="compact"`의 32px control을 사용하며 feature가 별도
  input class를 만들지 않는다. `InlineSelect`는 General 상단의 Connection
  type·Driver처럼 label과 값이 한 줄에 놓이는 실제 선택 속성을 소유한다.
  SQL/session 설정처럼 여러 줄인 값은 화면별 textarea class를 만들지 않고
  monospace `TextAreaInput`을 사용한다. 계층 checklist의 parent는
  `CheckboxField`의 native `indeterminate` 상태로 부분 선택을 표현한다.
- `PanelTabs`: 데이터소스 속성·설정 패널의 ARIA tab navigation. 좁은 폭에서는
  가로로 스크롤하며 선택 변경과 viewport resize 뒤에도 active tab을 자동으로
  노출한다. active tab만 Tab 순서에 두고 ArrowLeft/Right/Home/End 이동에서
  disabled tab을 건너뛴다.
- `IconRailTabs`: desktop dialog의 42px 세로 category navigation. icon-only
  tab의 selection, tooltip, roving arrow/Home/End keyboard focus를 소유한다.
- `SegmentedControl`: 속성 편집기의 소수 상호 배타 선택을 위한 compact
  radiogroup. 전체 또는 capability가 없는 개별 option의 비활성화와 이를
  건너뛰는 keyboard focus, semantic selection treatment를 소유한다.
- `EnvironmentBadge`: database context에서 dev/staging/prod를 neutral 대문자와
  작은 의미색 점으로 표시한다. Explorer에서는 Project의 단일 `Databases`
  folder 아래 DB connection row에만 두고 Data source·Analysis Article·Project
  행에는 반복하지 않는다. Environment는 Explorer folder가 아니라 exact binding
  identity로 유지하며 production도 채운 danger pill로 강조하지 않는다.
- `TreeSectionButton`, `TreeRowActions`, `TreeSearch`, `VirtualTreeRows`: 객체 트리의
  일반 문장형 hierarchy row, keyboard toggle, dense object search와 대형 leaf
  row windowing. `TreeSectionButton`의 `selected`는 현재 Project나
  resource folder를 같은 tree selection 문법으로 표시하고 `trailing`은 실제
  command만 받는다. Environment badge는 DB connection row가 직접 소유하며 연결
  개수는 folder 행에
  상시 표시하지 않는다. `TreeRowActions`는 행의
  실제 command만 받아 hover/focus에서 표시하고 title 폭을 상시 차지하지 않는다.
  Workspace Explorer의 Project/resource 행은 28px로 고정한다. Project는
  13px·650 weight, resource folder는 12px·550 weight,
  DB·source·article leaf는 12px·450 weight를 사용한다. DB의 24px tree
  action과 provider target metadata는 같은 한 줄 안에 머물러 Diff·관리 action의
  유무나 target 길이가 행 높이를 바꾸지 않는다.
  toggle은 native button이고 interactive row action은 그 sibling이므로 nested
  button을 만들지 않으며, action은 접근성 트리와 keyboard tab 순서에 독립 노출한다.
  `VirtualTreeRows`의
  inline height/translate는 TanStack React
  Virtual이 측정한 viewport geometry를 적용하는 vendor integration 예외이며,
  색상·간격·row 외형은 계속 semantic utility가 소유한다. 데이터베이스·스키마·
  객체 폴더 이름을 uppercase category heading처럼 바꾸지 않는다.
  Explorer의 전체 카탈로그는 하나의 `role="tree"`와 하나의 visible-item
  순서를 사용한다. 각 row는 stable key, parent key, `aria-level`,
  `aria-expanded`, `aria-selected`를 소유하고 roving `tabIndex`로 Tab 진입점을
  하나만 둔다. ArrowUp/Down은 화면 순서, ArrowRight/Left는
  펼침·자식/접힘·부모, Home/End는 처음·끝, Enter/Space는
  row의 primary action을 실행하고 Shift+F10/ContextMenu는 실제 context action을
  연다. 검색은 원래 펼침 상태와 focus key를
  변경하지 않고 임시 visible set만 투영한다. 가상화 row의 이동은
  전체 모델 순서로 대상을 계산한 뒤 해당 row를 pin·scroll·focus한다.
- `PopupMenu`, `PopupMenuItem`, `PopupMenuCheckbox`: 평평한 popover menu
  surface와 keyboard-focus 가능한 command/check row.
- `ToolbarMenu triggerVariant="statusBar"`와 `menuSize="tasks"`: status bar
  높이를 유지하는 background-task trigger와 380px 이내의 관찰·중단 popup.
  실제 전역 작업 모델에 있는 task만 표시하고 지원되지 않는 중단 control은
  만들지 않는다.
- `CommandMenu`, `CommandMenuGroup`, `CommandMenuItem`: 검색 입력, 분류,
  설명이 필요한 생성·선택 command popup. `CommandMenuItem`의
  `aria-selected`는 Action Search와 같은 listbox의 공용 선택 row
  treatment를 소유한다. 이 surface는 modeless anchored popup으로 유지하며,
  Escape만 trigger focus를 복원하고 outside pointer·selection dismiss는 현재
  작업 focus를 강제로 되돌리지 않는다.
- Action Search는 672px 이하의 transparent-backdrop modal로 투영한다. 최상위
  modal Escape와 focus containment를 공유하고 dismiss 뒤 opener focus를
  복원한다. 빈 질의는 결과 영역을
  늘리지 않고, 실제 검색 가능한 Database·Documents·Actions·Settings
  범위만 `Button` tab으로 표시한다. `/`는 실제 action catalog를
  열며 Files·Code·Text 같은 범위 밖 category placeholder를 만들지
  않는다.
- `ModalBackdrop`, `ModalSurface`, `ModalTitleBar`, `ModalDetailActionBar`,
  `ModalFooter`: background interaction을 차단하는 공용 viewport backdrop,
  responsive dialog frame과 30px title/48px detail action/50px primary action
  bar. SQL parameter, DDL viewer, provider credential처럼 background interaction을
  막는 feature dialog도 이 frame을 사용하고 별도 modal CSS를 만들지 않는다.
  `ModalSurface`는 열릴 때 `[data-modal-initial-focus]` 또는 첫 control로 focus를
  옮기고, Tab/Shift+Tab을 최상위 dialog 안에서 순환시키며, 외부로 이동한
  programmatic focus를 다시 포함한다. 닫힐 때는 아직 존재하는 원래 trigger로
  focus를 복구한다. Escape는 최상위 surface 하나에서만 `onRequestClose`를
  호출하고 event를 소비한다. pending operation처럼 닫을 수 없는 상태는
  `dismissible={false}`와 disabled title close action으로 명시한다. 첫 작업
  control을 명시해야 하는 feature만
  `data-modal-initial-focus`를 사용한다.
  `ModalTitleBar`의 빈 영역과 제목은 공용 Tauri deep drag region으로 현재 앱
  창을 이동하고 close button은 명시적인 non-drag region으로 남긴다. 전체
  backdrop이나 modal body에 drag region을 확장하지 않는다. 이 mouse 계약은
  macOS·Windows·Linux가 공유한다. Windows touch/pen 전용 `app-region: drag`는
  title control의 click을 가로챌 수 있으므로 현재 적용하지 않는다.
  `size="settings"`는 제품 계약의 982×722 설정 dialog를,
  `size="dataSources"`는
  제품 계약의 980×731 frame을 compact full-height fallback과 함께
  소유한다. Data Sources의 `Problems`는 catalog 하단, `Test Connection`은
  detail action bar, `Cancel/Apply/OK`는 `ModalFooter`에 두며 한 footer에
  섞지 않는다.
- `WorkbenchPane`, `WorkbenchContainedBody`, `WorkbenchScrollBody`,
  `WorkbenchToolbar`, `WorkbenchSelect`,
  `WorkbenchDivider`, `WorkbenchEmptyState`: 데이터
  편집기·SQL·문서 화면의 평평한 IDE pane, command row, compact context select,
  object context, empty state 계약.
  `WorkbenchPane`은 edge-to-edge document의 바깥 clip boundary만 소유한다.
  고정 toolbar/tab/footer 다음에는 정확히 하나의 body를 둔다. CodeMirror나
  DataGrid처럼 내부 viewport가 스크롤하는 문서는 `WorkbenchContainedBody`를,
  Schema/error/output처럼 문서 전체가 길어지는 경우는
  `WorkbenchScrollBody`를 사용한다. 두 body 모두 `min-h-0`, 실제 pane 크기의
  size container와 overscroll 경계를 제공하며 화면에서 `vh`로 가용 높이를
  다시 추측하지 않는다.
  중앙 workbench의 data source 문맥은 별도 대형 connection header를 만들지
  않고 document tab, context toolbar, status bar에 나눠 표시한다. SQL 문서
  제목은 tab을 더블 클릭해 편집한다. SQL schema selector는 catalog에서 발견한
  namespace만 표시하는 compact native control이며, 선택값을 문서에 영속하고
  Explain/read/write/script 실행과 status/Services projection이 같은 값을
  사용한다. Playground/Script resolve mode도 같은 `WorkbenchSelect`를 사용하고
  문서에 영속하며, SQL editor의 engine dialect와 caret 기준 schema completion
  context를 바꾼다. selector를 위해 feature CSS나 style map을 만들지 않는다.
  SQL 실행 상태는 실행 당시 document snapshot과 정확한 CodeMirror source
  range가 현재 문서에 그대로 남아 있을 때만 문장 끝 inline widget으로
  표시한다. 성공 duration과 running/waiting/failed/cancelled label은 Services와
  같은 lifecycle projection을 사용한다. 동일한 SQL이 여러 번 있어도 단순
  문자열 검색으로 첫 occurrence에 붙이지 않으며, widget은 정적 Tailwind
  utility와 semantic token만 사용한다.
  document tab은 welcome/schema/data/SQL/activity를 숨김 예외 없이 같은 strip에
  투영한다. 스키마 비교처럼 일시적으로 중앙 workbench를 점유하는 도구도 큰
  화면 제목이나 card dashboard를 만들지 않고 같은 `IdeTabStrip`과
  `WorkbenchToolbar`를 사용한다. 비교 대상 전환은 `IdeToolTabStrip`으로
  표현하고 결과 grid 바깥에 별도 rounded panel을 추가하지 않는다.
  각 tab은 읽을 수 있는 고정 폭을 유지하고 활성 문서가 바뀌면
  수평 strip 안에서 자동으로 드러난다. 끝단의 portal `ToolbarMenu`는 모든
  열린 문서를 나열해 overflow된 문서도 실제 활성화할 수 있어야 한다. 새 쿼리,
  Activity처럼 title toolbar나 status에서 이미 제공하는 action을 tab strip에
  중복 배치하지 않으며, tab용 feature CSS나 style map을 만들지 않는다.
  Welcome 본문도 logo·page title·설명 card를 만들지 않고 `Button`의 flat
  `menuItem` projection으로 실제 AppShell command만 나열한다. 연결 전에는 첫
  데이터 소스 선택에 필요한 한 줄만 허용한다. Personal 첫 실행의 가이드 데모는
  실제 local DB·Project·Environment·binding을 준비하는 command 하나로 진입하며,
  준비 뒤에는 table 탐색·Environment-pinned Agent 읽기·Safety를 거친 쓰기 승인
  세 command를 같은 flat 목록으로 투영할 수 있다. 설명 card, 가짜 team 상태,
  범위 밖 IDE command나 비활성 placeholder는 표시하지 않는다.

chrome 높이, panel gutter, 화면별 검수 순서와 기능 결정은
[`docs/PRODUCT_UI_SCOPE.md`](../../docs/PRODUCT_UI_SCOPE.md)를 따른다. 이 값은
DopeDB의 실제 작업 흐름과 접근성, supported viewport를 위한 제품 소유 계약이다.
- Explorer와 Local History는 같은 왼쪽 anchor를 쓰되 서로 다른 저장 폭을
  가진다. AI Chat도 오른쪽 anchor 폭을 별도로 저장해 한 tool window의 수동
  resize가 다른 종류의 기본 비율을 훼손하지 않게 한다.
  supported desktop viewport의 Explorer/center/Agent 3분할에 맞춰 Explorer와
  Agent의 desktop 기본 폭은 396px이다. 검수된
  `1385×918` AI Chat 상세 참조처럼 약 595px까지 넓힌 값도
  `agentDockWidth`에 독립 저장한다.
  다만 열린 왼쪽 tool window와 저장된 Agent 폭을 함께 적용했을 때 중앙
  workbench가 520px보다 좁아지면 Agent는 modeless 오른쪽 overlay로 투영한다.
  창 폭만 보는 고정 breakpoint로 세 pane을 강제로 유지하거나 중앙 pane을
  0에 가깝게 축소하지 않는다.
  compact Agent가 modal일 때 배경 shell은 실제 grid 형제에 `inert`를 적용한다.
  WKWebView에서 자손의 text·icon·border paint를 누락시키는 `display: contents`
  wrapper를 shell grid와 접근성 경계로 사용하지 않는다.
  상태는 desktop 선호 폭을 소유하고 shell projection만 현재 viewport에 맞춰
  clamp한다. 따라서 compact viewport에서 처음 mount되거나 왕복해도 저장된
  desktop 폭과 다음 desktop projection은 변경되지 않는다.
- Services 기본 높이는 동일 상태 참조처럼 viewport의 33%로 시작하고, 사용자가
  조절한 높이는 독립 저장한다. 이전 고정 기본값 280/284px만 새 비율로 한 번
  이관하며 다른 수동 높이는 보존한다.
- Local History의 현재 `Recent` view는 tool-window header가 소유한다. 실제
  revision 복원 action은 검색/필터 문맥과 같은 command row에 두고 panel
  close와 섞지 않는다. project external-change 기능이 생기기 전에는 빈 file
  tree나 가짜 view action을 추가하지 않는다.
- Services는 tool window 이름과 닫기 action을 전체 폭 `ToolWindowHeader`가
  소유한다. 그 아래에서 실행 가능한 database/document/session tree와
  Output/Result tab surface를 약 `32% / 68%`로 나눈다. Schema·Activity처럼
  query lifecycle에 속하지 않는 열린 문서는 Services tree에 투영하지 않는다.
- tabular Result는 `WorkbenchToolbar`에 현재 grid 표시, 실제 전체 셀 검색,
  복사·CSV·JSON action을 놓고 `DataGrid` 아래 고정 footer에
  visible/filtered row count와 duration을 표시한다. 다른 제품에 보인다는 이유만으로
  transaction, DDL, edit action을 handler 없이 추가하지 않는다.
- AI Chat composer는 큰 multiline surface, 내부 context chip/action row,
  외부 Agent/model context row의 세 층을 사용한다. 첨부 chip과 popup은
  semantic token과 기존 button/icon 규칙으로 조합하며 feature CSS를 만들지
  않는다. Project Environment와 공식 adapter가 준비되면 panel이 ACP session을
  선행 초기화하고, 초기화와 동시에 제출된 첫 prompt도 준비 완료 뒤 같은 제출
  흐름에서 이어서 전송한다. session 전용 tab action menu는 활성 session이 있을 때만 표시하며
  빈 AI Chat에 disabled kebab을 남기지 않는다.
- AI Chat의 desktop dock은 modeless tool surface다. 좁은 desktop의 오른쪽
  overlay도 `role="dialog"`인 modeless side sheet로 유지해 background focus와
  작업을 막지 않으며, focus가 sheet 안에 있을 때만 Escape로 닫는다. compact
  fullscreen projection만 `aria-modal="true"`, background `inert`, 공용 topmost
  modal focus·Tab·Escape 계약을 사용한다. 두 projection은 실제 opener를
  복원하고, 위에 열린 nested modal의 Escape를 먼저 소비하게 한다.
- Workspace Explorer는 `Project → Databases / Data sources / Analyses`를 실제
  folder hierarchy로 표시한다. Environment는 exact grant와 binding identity로
  유지하지만 Project 아래에 별도 folder를 만들지 않는다. `Databases`는 Project의
  모든 Environment binding을 한 목록으로 투영하고 DB row에만 해당 Environment의
  neutral badge를 표시한다. `Data sources`는 GitHub와 Local Folder source binding을,
  `Analyses`는 Project의 종합 Analysis Article을 모아 표시하되 각 leaf action은
  원래 Environment identity를 중앙 pane에 그대로 전달한다. 환경에 묶인 DB를
  root에 중복 표시하지 않고, 아직 묶이지 않은 연결만 `Unassigned`에 둔다. 선택한
  resource folder는 현재 선택된 Environment가 같은 Project에 있으면 그것을, 아니면 첫
  Environment의 상세를 중앙 pane에 열며 별도 Knowledge launcher, Dashboard 전용
  sidebar, 중복 Project navigation을 만들지 않는다. `Analyses`가 현재 resource면
  Explorer의 단일 contextual search row가 Project collection의 Article 문자·상태
  필터를 함께 소유하고, 중앙 document는 선택한 Article만 표시해 두 번째 collection
  rail을 만들지 않는다. Explorer의 단일 command strip에서 Project와 Environment
  생성 action을 구분하고, Project 생성 dialog는 기본 `main` Environment를 함께
  설정한다. Project 행의 hover/focus `plus`는 해당 Project에 Environment를 추가하고
  시각적 folder를 만들지 않은 채 Project의 `Databases`와 새 Environment binding
  상세를 연다. 같은 action rail의 overflow menu 안 `프로젝트 삭제`는 2단계 확인 뒤
  Project를 제거한다. 이때 workspace의
  database connection은 삭제하지 않고 `Unassigned`로 돌려보내며, active Analysis
  Article이 있으면 Article history를 보존하기 위해 Project 삭제를 차단한다. 삭제된
  Project의 source sync와 Agent grant는 즉시 폐기하고 해당 Environment에 고정된 실행 중
  Agent session도 중단한다. `Databases` folder의 `plus`는 기존 connection editor를
  exact Project Environment preset과 함께 열고 저장 성공 시 같은 binding command로
  해당 Project에 즉시 넣으며,
  `Data sources` folder의 `plus`는 현재 exact Environment의 source 연결 상세를,
  `Analyses` folder는 Agent가 제안한 Article draft collection을 열며 수동 빈 draft
  `plus`를 제공하지 않는다. collection의 유일한 생성 action은 현재 Environment와
  연결 revision을 고정한 AI Chat composer로 이동해 분석 질문을 받은 뒤, Agent가
  검증된 읽기 결과로 제안한 draft를 다시 collection에 넣는다. Project가 없는
  workspace에서는 설명만 표시하고 별도 생성 row를 누적하지 않으며, 생성 직후 새
  Project의 `Databases` folder와 기본 Environment binding 상세를 연다. resource
  folder와 `Unassigned` 행에는 연결 개수 badge를 붙이지 않는다. `Unassigned` 연결
  행은 pointer drag로 원하는 Environment에 이미 묶인 DB row나 Project의
  `Databases` folder에 놓을 수 있고, 유효한 대상은 drag 중 semantic border와
  surface로 표시한다. folder drop은 현재 선택된 Environment를 우선하고 없으면 첫
  Environment를 exact binding 대상으로 사용한다. Environment가 없거나 키보드를
  사용하는 경우에는 기존 Environment database binding 화면을 사용한다. 이 shortcut은
  기존 environment binding command를 재사용한다. Team-local 연결은 같은 동작에서
  비밀값 없는 shared connection identity를 먼저 발행하고 exact Environment에
  binding하며, 실패 시 새 identity를 롤백한다. 구성원 자격 증명과 BigQuery Google
  CLI 인증은 기기에 남는다. 이미 묶인
  연결의 암묵적 이동이나 복제를 허용하지 않는다. 한 workspace에서 동일한 connection은
  하나의 Project Environment에만 active binding을 가질 수 있다. 배정된 DB 행의 메뉴는
  전역 connection 삭제 대신 `프로젝트에서 제거`를 제공하고 exact binding만 해제한다.
  같은 schema group의 DB는 단일
  `Databases` 목록 안에서 각 DB row의 `diff` command와 connection menu로 동일한
  Schema Diff workbench를 열 수 있어야 한다. 중앙 환경 상세나 AI Chat 안내에 같은
  생성 form을 중복하지 않는다. Dashboard, Funnel Analysis, Agent Report는 별도
  navigation이나 screen을 갖지 않는다.
- 이 hierarchy의 Project prominence와 header action locality는 공개 Orca의
  `SidebarHeader`·`ProjectHeaderActions`·`WorktreeList`의 정보 구조를 재사용하되,
  행 높이, surface, icon, selection은 이 문서의 semantic primitive가 소유한다.
  Agent/worktree 행은 DopeDB
  resource tree로 가져오지 않는다.
- AI Chat의 context control은 한 Project의 `Databases`와 `Source code`를 같은
  300px scope menu 안에서 평평한 checkbox group으로 표시한다. Project Environment를
  별도 계층이나 이름으로 노출하지 않고 DB 행에만 기존 `EnvironmentBadge`를 둔다.
  메뉴는 여러 항목을 고르는 동안 열린 상태를 유지하고 별도 `Write target` radio
  group에서 선택된 쓰기 가능 DB만 후보로 표시한다. `Read only`가 기본이며
  쓰기 대상은 최대 하나다. trigger는 닫혀도 Project 이름, 선택한 DB/source 수,
  쓰기 대상 유무를 축약해 보여준다. 선택하지 않은 resource는 새 ACP session의
  immutable grant에 포함하지 않으며 여러 DB 결과는 UI에서 join된 것처럼 표현하지
  않는다.
- 외부 `dopedb agent init/start` 요청은 기존 `Modal` primitive의 wide/fill surface를
  쓰는 전역 approval gate로 표시한다. configure 요청만 같은 Project resource
  checkbox와 단일 write-target radio를 편집할 수 있고, start 요청은 저장된 exact
  set의 현재 이름·읽기/쓰기 상태와 provider·canonical working directory를 읽기
  전용으로 보여준다. resource가 사라졌거나 inventory를 불러오지 못하면 승인을
  비활성화하고 거절만 허용한다. modal은 secret, connection URL, capability를 표시하지
  않는다.
- 빈 AI Chat transcript는 제목·설명 card를 만들지 않고 실제 SQL 작업,
  스키마·선택 데이터 탐색, 명시적 변경 승인 세 줄만 표시한다. 화면에 없는
  IDE capability를 본뜨거나 steady-state onboarding 문단을 반복하지 않는다.
- Query parameter dialog는 parameter token/이름과 SQL expression 값을 한 행에
  대응시키고, 빈 값에서는 primary 실행 action을 비활성화한다. 치환 설명은
  divider surface에 두며 feature 전용 CSS나 style map을 만들지 않는다. title과
  action row는 feature-local header/footer가 아니라 `ModalTitleBar`와
  `ModalFooter`가 소유한다.
- Explain과 Services 오류는 결과 영역 안에 별도 rounded card를 만들지 않는다.
  `ResultMeta`와 divider 기반의 평평한 workbench row를 사용하고 SQL/error
  원문만 monospace scroll surface로 표시한다.
- SQL toolbar의 실행은 채움 primary button이 아니라 compact command 문법의
  평평한 icon action과 semantic success glyph를 사용한다. manual transaction이
  구현되기 전에는 `Tx: Auto`에 가짜 menu chevron이나 commit/rollback action을
  붙이지 않는다.
  사용자가 편집기에서 작성한 SQL은 이 Run command 자체가 exact payload 승인이며,
  같은 SQL을 별도 review surface에 복제하거나 확인 문구 입력을 요구하지 않는다.
  Agent가 제안한 mutation은 별도 단일 승인·거절 surface를 유지한다.
- `ResultMeta`, `SqlSnippet`: 결과 pane의 고정 metadata bar와 축약 SQL 표기.
- `DataGridStatusPill`: table data와 query result가 공유하는 grid 하단 중앙의
  floating row-count surface. 범위·duration·선택 상태의 상세 정보는 접근 가능한
  title에 유지하고 grid를 밀어내는 전체 폭 footer를 만들지 않는다.
- `ResultWorkbenchToolbar`, `ResultWorkbenchFooter`: materialized/streaming
  결과가 공유하는 grid mode, 전체 셀 검색, 실제 export action과 행·duration
  상태. workbench export는 별도 CSV/JSON text button을 나열하지 않고
  `CSV` format menu 하나로 투영하며, inline metadata
  표현만 명시적 text action을 유지한다. 두 표현은 같은 export handler를
  공유한다. 실행 SQL 문맥은 document/session/result tab이 소유하므로 result
  command row에 SQL snippet을 반복하지 않는다. `ResultWorkbenchFooter`는
  `DataGridStatusPill`을 합성하고, 부분
  stream은 평탄화하지 않고 완료된 결과에만 검색을 적용한다.
- 일반·가상 `DataGrid`는 공용 `DataGridViewport`와
  `data-data-grid-scroll` surface 계약을 공유한다.
  sticky header, filter, hover/selection, resize handle, scrollbar는
  컴포넌트의 정적 Tailwind v4 utility와 semantic token으로만 구성한다.
  grid 전용 CSS 파일이나 class selector를 다시 만들지 않는다. 주변 pane이
  compact/busy 상태를 투영할 때도 이 data attribute를 사용한다.
  `panel`은 독립 surface, `workbench`는 `WorkbenchContainedBody`의 남은 높이,
  `embedded`는 `WorkbenchScrollBody` 안에서 현재 size container 높이에 묶인
  nested result를 뜻한다. virtual/non-virtual renderer가 동일한 surface와
  scrollbar 계약을 사용하며 floating status footer가 있는 grid는 scroll
  bottom inset을 명시해 마지막 행과 keyboard focus가 footer 아래에 가리지 않게
  한다.
  `dataGridGeometry.ts`가 제품 기준의 28px header/row, 28px row-number
  column, 144px default data column을 소유하며 일반·가상 renderer는 이 값을
  중복 선언하지 않는다. identifier/value/row number는 `font-mono`를 사용하고
  강한 zebra 배경을 추가하지 않는다.
  header와 row-number/frozen boundary만 구조적 세로선을 유지하며 body data
  cell은 기본 vertical border를 그리지 않는다.
  두 grid의 셀 선택은 공용 anchor/focus 좌표 계약을 사용한다. Shift+click과
  Shift+방향키는 직사각형 범위를 확장하고, 범위 복사는 행을 줄바꿈하고 셀을
  tab으로 구분한 텍스트를 만든다. 선택 배경과 focus ring도 기존
  `selection`/`ring` semantic token만 사용한다.
  body composite는 rowheader를 첫 열로 포함한 roving tab stop 하나를 사용한다.
  Arrow는 같은 행·열을 이동하고 Home/End는 행 경계, Cmd/Ctrl+Home/End는 전체
  경계, PageUp/PageDown은 viewport 한 페이지를 이동한다. 가상 renderer도 target을
  scroll/render한 뒤 같은 row/column ARIA 좌표의 요소로 focus를 옮긴다.
- SQL table data editor는 command toolbar 바로 아래에 `WHERE`와 `ORDER BY`
  expression field를 둔다. 넓은 main에서는 제품 계약의 경계 비율인
  `1.75fr / 1fr`(`약 64% / 36%`)를 사용하고, 480px 이하 main container에서는
  같은 폭으로 되돌린다. Enter 또는 field action으로 실제 server query를
  다시 실행하고 Escape는 적용되지 않은 draft를 되돌린다.
  refresh는 toolbar 왼쪽의 첫 실제 action으로 두고,
  삭제는 row 제거 의미의 minus glyph를 사용한다. 이미 구현된 relation DDL과
  현재 page export는 `TableToolbar`의 직접 `DDL`, `CSV` command로 투영한다.
  relation DDL은 Explorer row hover action으로 중복하지 않고 Explorer command
  row와 table toolbar가 소유한다.
  compact 폭에서는 DDL을 유지하고 CSV/JSON만 기존 `더보기` command surface로
  접는다. direct command와 overflow command는 같은 handler를 공유하며 화면별
  export 구현이나 style map을 복제하지 않는다. SQL/Mongo 문서 모두 connection
  context를 document tab과 status bar에 표시하므로 data surface 위에 대형
  object context header를 다시 만들지 않는다.
  fragment는 backend read-only proposal을 통과해야 하며 주석, 문장 구분자,
  다른 clause로 경계를 벗어나 generated `LIMIT`을 삼킬 수 없다.
- MongoDB document query도 별도 큰 화면 제목이나 세로 label toolbar를 만들지
  않는다. 제품 명칭은 범용 `문서`가 아니라 `MongoDB 조회`를 사용하고 마지막
  query tab을 닫은 뒤에도 같은 조회 surface를 유지한다. 조회 가능한 collection이
  없으면 toolbar나 생성 button 없이 `WorkbenchEmptyState`로 정확한 빈 상태만
  표시한다. 실행/중지는 `WorkbenchToolbar`의 평평한 icon command, operation과
  collection은 `WorkbenchSelect`, JSON 입력은 공용 `Field`와
  `TextAreaInput`을 사용한다.
- 정렬 trigger와 column filter trigger는 header 안의 서로 다른 button이다.
  filter popover는 현재 page에서 관찰한 값과 원래 개수를 검색 가능한 checklist로
  표시하고, 선택 뒤 결과가 바뀌어도 그 inventory를 유지한다. popover, field,
  selected trigger는 공용 menu와 semantic `popover`/`selection` token의 정적
  Tailwind v4 utility로만 구성한다.
- `InspectorHeader`, `InspectorFooter`: 셀 보기·행 편집·검토 inspector의 제목,
  action cluster, sticky footer 계약.
- `ToolbarMenu`, `ToolbarMenuItem`: portal 기반 floating command/check surface와
  공통 command row. `triggerVariant="badge"`는 Explorer의 선택/전체 수처럼
  조밀한 범위 trigger를 소유한다. trigger가 compact 전환이나 tool-window
  교체로 viewport 밖에 나가면 열린 portal도 함께 닫는다. command 선택으로
  menu가 닫힐 때 trigger를 먼저 focus해, 이어서 열린 modal이 macOS pointer
  경로에서도 실제 호출자를 return-focus owner로 캡처하게 한다. 선택 가능한
  `menuitemradio`·`menuitemcheckbox`는 `aria-checked`와 semantic selection surface로
  현재 값을 메뉴 안에서도 명확히 표시한다.
- `StatusBadge`, `StatusDot`, `StatusBarItem`, `StatusBarBreadcrumbs`,
  `StatusBarIconButton`, `LoadingLabel`, `InlineNotice`: lifecycle 상태 점,
  semantic success/warning/danger badge, IDE 하단 상태 segment, database
  breadcrumb, icon action, 비동기 진행 label, warning/danger inline 상태 행.
  `StatusBadge`의 tone은 `data-tone`과 정적 Tailwind variant가 소유하며 화면별
  `riskClass`/`badgeClass` style map을 만들지 않는다. 왼쪽 breadcrumb는
  `Database → data source → namespace → object group → object/document` 순서를
  사용하고 database/source/namespace/object 항목은 고정 Explorer의 같은 문맥을
  reveal한다. 열린 document 항목은 현재 문서가 문맥을 소유하므로 정적으로
  유지한다. 오른쪽은 workspace의 실제 manual transaction과
  running/waiting session 수, CodeMirror가 보고한 `line:column`, line ending,
  encoding, 동일한 editor indent 설정, 실제 safety allow-write 상태와 unread
  operation만 표시한다. manual transaction popup은 active 상태에서
  connection 이동·commit·rollback, failed 상태에서 이동·rollback만 제공한다.
  완료 query 결과, engine/schema 이름과 top toolbar의 Settings action을 하단에
  중복하지 않는다.
  잠금 action은 해당 data source의 Safety 설정을, bell action은 실제 Activity
  문서를 연다. 화면 전용 status CSS나 style map은 만들지 않는다.
- `DiagnosticSummary`, `DiagnosticCount`: 설정·속성 편집기의 Problems 목록과
  오류/경고 개수를 같은 compact hierarchy로 표시.
- `SettingsGroup`: 설정·정책 화면의 제목, 상단 divider, dense spacing을 공유하는
  평평한 control group. Settings dialog 안에 card surface를 다시 중첩하지 않는다.
  202px settings rail은 검색 input에 8px gutter를 두고 24px hierarchy의
  hover/selection row는 rail 전체 폭을 차지하는 평평한 surface를 사용한다.
  선택 항목을 inset rounded pill로 만들지 않는다.

툴윈도우 primitive는
[`src/design-system/components/ToolWindow.tsx`](components/ToolWindow.tsx)에
있고 form과 tab primitive는 같은 디렉터리의 `FormControls.tsx`,
`PanelTabs.tsx`, `IconRailTabs.tsx`, `SegmentedControl.tsx`에 있다. 같은
형태는 화면에서 utility 문자열로 다시 만들지 않는다.

ACP처럼 protocol이 작업 상태를 소유하는 화면은
[`src/design-system/components/Agent.tsx`](components/Agent.tsx)의
`AgentActivityLine`, `AgentToolCallCard`, `AgentPermissionCard`를 사용한다.
첫 번째는 일반 사용자에게 ACP 내부 작업을 의미 있는 한 줄 상태로 축약한다.
두 번째는 디버깅 화면에서 tool의 제목, 진행 상태, 구조화 결과와 상세
입력/출력을 한 observation surface에 묶고, 세 번째는 protocol이 실제로 제공한
선택지만 approval action으로 받는다. 화면별로
승인 card의 warning border, status dot, icon/본문/action grid를 복제하지 않는다.
Agent provider나 model 선택은 이 primitive의 책임이 아니며, 지원 결정이 없는
provider를 disabled option으로 노출하지 않는다.

Agent의 최종 답변과 streaming 답변 본문은
[`src/design-system/components/AgentRichText.tsx`](components/AgentRichText.tsx)의
`AgentRichText`, `AgentStreamingText`, `AgentPlainText`를 사용한다. streaming
중에는 React가 소유하는 escaped plain text만 표시하며, turn boundary 뒤
`react-markdown` + `remark-gfm`으로 최종 본문을 한 번 렌더링한다. rich parsing은
답변당 64KiB·1,000줄, transcript당 최근 12개·192KiB·2,400줄 안에서만 허용하고
이전 답변과 한도 초과 답변은 내용 손실 없이 일반 텍스트로 표시한다. Markdown render가
실패해도 답변별 `RenderRecoveryBoundary`가 일반 텍스트로 되돌리며 AI Chat의
feature boundary가 앱 shell 전체의 unmount를 막는다.
raw HTML과 원격 image는 렌더링하지 않고, `rehype-sanitize`를 통과한 외부
`http(s)`/`mailto` link만 시스템 browser로 연다. 완료된 code fence는
fine-grained Shiki JavaScript engine과 요청된 grammar만 지연 로드하며 색상은
기존 semantic/terminal role에 연결한다. Mermaid fence는 turn이 완료된 뒤에만
지연 렌더링하고 크기를 제한한 source를 CSP가 있는 sandbox iframe 안에 표시한다.
이 vendor integration을 위한 screen CSS나 별도 syntax palette는 만들지 않는다.
database ERD는 이 renderer가 아니라 기존 React Flow + ELK surface가 소유한다.

### 버튼

모든 일반 버튼은 `Button`을 사용한다. Tailwind utility 조합이나 전역 selector로
버튼의 variant와 밀도를 다시 만들지 않는다.

| prop | 용도 |
| --- | --- |
| `variant="primary"` | 저장·확인·실행 등 한 흐름의 단일 affirmative action |
| 기본 `variant` | toolbar 또는 독립 outline action |
| `variant="ghost"` | icon button과 list-row action |
| `variant="danger"` | 삭제·폐기·되돌릴 수 없는 최종 action |
| `variant="dangerGhost"` | toolbar의 삭제 후보 action; 최종 확인 전에는 채우지 않음 |
| `size="compact"` | 32px dense toolbar control |
| `size="compact" iconOnly` | 32px toolbar icon action; padding 없는 정사각형 |
| `size="xs" iconOnly` | 24px close·dismiss·inline remove action |
| `size="tree"` | 24px tree-row action; 28px resource row 안에서만 사용 |

Cancel, Close, Dismiss는 destructive가 아니다. 기본 variant 또는 `ghost`를
사용한다.

아이콘 버튼은 중요도에 따라 세 단계만 사용한다.

1. 24px: 패널 닫기, tab/목록의 제거처럼 주변 문맥이 분명한 보조 action
2. 32px: toolbar, pagination, refresh, overflow menu의 기본 icon action
3. 36px: title toolbar의 workspace처럼 앱의 주 navigation action

아이콘 명령은 `Button iconOnly`를 사용한다. `title` 또는 `aria-label`은 접근 가능한 이름과
canonical `Tooltip`의 hover/focus 문구를 함께 제공한다. `pnpm
check:ui-primitives`는 raw icon-only button의 재도입과 이름 없는 `Button
iconOnly`를 차단한다. 보통 icon action은 투명한 surface로 시작하고
hover/active에서만 중립 배경을 드러낸다.
삭제 icon도 idle 상태에서는 빨간 채움 상자로 만들지 않고 의미색 glyph를 사용하며,
최종 확인 action만 `variant="danger"`의 채움 surface를 사용한다. 변경한 화면에서는
단일 아이콘 `Button`의 정사각형 규격과 접근 가능한 이름을 직접 확인한다.

### Surface

- `.card` / `.ds-card`: 반복 항목과 작은 정보 그룹
- `.ds-panel`: 넓은 작업 surface
- `.grid-panel`: job 결과 surface
- `[data-data-grid-scroll]`: Tailwind로 구성하는 표·쿼리 결과 surface

Surface는 기본적으로 `card + border + rounded-lg + no shadow`다. floating surface만
`--ds-shadow-popover`를 사용한다.

### Badge

- `.badge`: 중립 metadata
- `.badge.kind`: 선택보다 약한 category 표기
- `StatusBadge tone="success"`: 성공/trust
- `StatusBadge tone="warning"`: warning/review
- `StatusBadge tone="danger"`: 오류/차단
- `.badge.nowhere`: 실행 위치가 없어 실제로 차단된 상태

### Form

- label과 control은 `space-2` 수준의 간격을 유지한다.
- input/select/textarea는 `--ds-input` surface를 사용한다.
- 오류는 `aria-invalid`, `role="alert"`, semantic danger utility로 표시한다.
- 사용자가 읽거나 재시도해야 하는 오류는 toast로만 숨기지 않는다.
- form action은 destructive → neutral → primary 순으로 배치한다.

### 리스트 행

- idle: 투명
- hover: `--ds-muted`
- keyboard selected/current: `--ds-selection`
- focus: `--ds-ring`

선택 상태를 임의 hex나 primary 버튼 색으로 만들지 않는다.

## 공통 클래스

워크벤치:

- `.ds-workbench-head`, `.ds-workbench-title`, `.ds-title-line`
- `.ds-meta-row`, `.ds-meta-dot`

Toolbar:

- `.ds-toolbar-spacer`
- `.ds-control-row`
- `ToolbarMenu`, `.ds-menu-popover`, `.ds-menu-item`

Agent/safety:

- `.ds-card-stack`, `.ds-card-title-row`, `.ds-card-row`
- `.ds-tone-trust`
- `.ds-attention-stack`, `.ds-attention-badge`

Utility:

- `.icon`, `.icon-only-badge`
- `.scrollbar-sleek`

텍스트 색·크기·간격 같은 단일 속성을 `.muted`, `.error`, `.loading`, `.form`
같은 범용 클래스에 다시 모으지 않는다. 화면에서는 semantic `tw:` utility를
사용하고, 비동기 진행처럼 구조와 접근성 계약이 있는 경우 `LoadingLabel` 같은
React primitive로 승격한다.

## UX 규칙

1. 0–100ms 작업에는 별도 feedback을 보이지 않는다.
2. 100ms–1s는 control만 disabled 처리한다.
3. 1–3s는 spinner 또는 label swap을 사용한다.
4. 3s 이상은 현재 단계를 구체적인 동사로 표시한다.
5. loading label이 길어져도 layout이 움직이지 않도록 공간을 예약한다.
6. tooltip은 icon-only control의 이름을 알려줄 때만 사용한다.
7. 오류·경고·blocking state는 사용자가 행동할 수 있는 곳에 inline으로 둔다.
8. `Esc`는 조용히 빠져나가는 경로이며 별도 색상이나 keyboard chip을 붙이지 않는다.
9. icon-only 버튼에는 `aria-label` 또는 접근 가능한 이름이 있어야 한다.
10. hover, focus-visible, disabled, empty, error 상태를 함께 구현한다.
11. 애니메이션은 continuity를 설명할 때만 사용하고 reduced motion을 존중한다.
12. macOS, Windows, Linux와 좁은 창에서 control label과 shortcut을 확인한다.

## 툴바와 floating menu 계약

데이터·ERD처럼 control 수가 많은 작업 툴바는 두 영역으로 나눈다.

1. 선행 작업 영역은 `min-width: 0`과 수평 overflow를 소유한다.
2. pagination, 저장, overflow menu 같은 끝단 control은 축소되지 않고 고정된다.

좁은 창에서 툴바 전체를 여러 줄로 쌓지 않는다. 덜 자주 쓰는 명령은
`ToolbarMenu`로 이동하고, icon-only shortcut은 접근 가능한 이름과 tooltip을
  유지한다. 이 구조는 action locality와 고정된 끝단 control을 현재 workbench에
  맞게 표현한 것이다.

toolbar의 command overflow menu는 반드시 portal 기반 `ToolbarMenu`를 사용한다.

- `--ds-menu-min-width`보다 작아지지 않으며 항목 label을 숨기지 않는다.
- `--ds-viewport-gutter` 안으로 좌우 위치를 clamp하고, 아래 공간이 부족하면 위로
  뒤집는다.
- pane의 `overflow: hidden/auto`에 잘리지 않는다.
- `Esc`, 바깥 클릭, 위·아래/Home/End 키 이동을 제공한다.
- 각 항목은 박스형 `Button`을 중첩하지 않고 평평한
  `role="menuitem"` `.ds-menu-item`을 사용한다.

과거의 `.toolbar-menu`와 `.toolbar-menu-panel`은 금지한다.

## 좁은 창 shell 계약

Tauri 최소 창 크기에서는 explorer와 main을 세로로 고정 분할하지 않는다. 고정
분할은 header와 toolbar가 본문 높이를 모두 소비해 데이터 행을 볼 수 없게 만든다.

- 560px 이하에서도 별도 product rail이나 bottom navigation을 만들지 않는다.
  workspace, Explorer, Services, AI Chat, account, search, settings 진입은
  desktop과 같은 `IdeTitleToolbar`가 소유한다.
- main과 열린 compact tool window는 title toolbar 아래부터 32px status bar
  바로 위까지의 전체 높이를 소유한다.
- explorer는 왼쪽 drawer이며 title toolbar의 현재 Explorer launcher, 바깥
  scrim, `Esc`로 열고 닫는다.
- table/connection을 선택하면 drawer를 닫아 결과에 초점을 돌린다.
- macOS overlay title bar의 높이는 닫힌 drawer에서도 main 위쪽에 구조적으로
  예약한다.
- drawer는 본문을 재배치하지 않고 덮으므로 열고 닫을 때 데이터 grid의 크기와
  scroll 위치가 바뀌지 않는다.

## 시각적 깊이 계약

한 화면의 시각적 깊이는 control을 포함해 최대 3단계다.

1. 화면/영역: 배경 또는 한 방향 divider
2. 작업 surface/반복 항목: 실제 정보 그룹에만 border
3. control/상태: button, input, badge

`panel -> card -> card`나 `inspector -> bordered list -> bordered row` 구조를 만들지
않는다. 새 박스보다 여백, 제목, divider를 먼저 사용한다.

새 horizontal control cluster는 `.ds-control-row`를 포함하고, grid track은 `1fr`
대신 `minmax(0, 1fr)`를 사용한다.
화면별 높이는 해당 행에 `--ds-row-control-size`를 지정한다. 공통 규칙은 이 값을
재정의하지 않고 `--ds-control-field` fallback만 사용하므로 CSS import 순서에 따라
32px/36px control이 뒤섞이지 않는다. `Button`의 `size`와 `iconOnly` prop이
명시한 control 크기는 row의 암묵적 fallback보다 우선하므로, 뒤에서 로드된
`.ds-control-row`가 32px 버튼을 다시 36px로 키우지 않는다.

## 새 UI를 추가할 때

1. 가장 가까운 sibling screen을 먼저 확인한다.
2. `system.css`와 `src/design-system/components/`의 기존 primitive를 먼저
   검색한다.
3. 화면 고유 배치는 TSX의 정적 `tw:` utility로 구현한다.
4. 같은 class/interaction 묶음이 반복되면 실제 공용 컴포넌트로 승격하고 이
   문서의 컴포넌트 목록에 추가한다.
5. 이관한 기능의 legacy selector, import, CSS 파일을 같은 변경에서 삭제한다.
6. 색상은 theme role로만 선택하고 raw arbitrary color를 쓰지 않는다.
7. 새 token은 세 화면 이상에서 같은 의미로 반복될 때만 추가한다.
8. 한 사용자 흐름은 `data-primary-flow` 경계 안에 primary action 하나만 둔다.
9. `pnpm build`를 실행하고 실제 앱에서 변경한 화면과 좁은 창을 확인한다.

참고 기준:

- [`docs/PRODUCT_UI_SCOPE.md`](../../docs/PRODUCT_UI_SCOPE.md)
- [`docs/UI_IMPLEMENTATION_TRACKER.md`](../../docs/UI_IMPLEMENTATION_TRACKER.md)
