# UI text·line·color inventory

이 문서는 #112의 전면 UI 정리에서 화면별로 무엇을 계속 보이고, 어떤 선과 색을
허용하는지 기록한다. 기능 범위는
[`PRODUCT_UI_SCOPE.md`](./PRODUCT_UI_SCOPE.md)의
결정 표가 우선하며, 이 inventory는 제외·미결 기능의 control을 추가하는 근거가
아니다.

## 증거 경계

- 정적 source audit와 DopeDB `1393×862` browser projection으로 text, line,
  palette owner를 확인한다.
- browser projection은 Tauri runtime 동작이나 packaged 검수의 증거가 아니다.
- 같은 DopeDB scenario의 viewport·상태와 accessibility tree를 사용해
  `complete` / `partial` / `missing`을 갱신한다.
- macOS·Windows packaged App의 font rendering, focus, native chrome은 별도
  수동 검수 항목으로 남긴다.

## 화면별 inventory

| 화면 | 항상 보이는 text | 필요할 때만 보이는 text | 유지할 line | 허용 color | 소유 primitive·상태 |
| --- | --- | --- | --- | --- | --- |
| title toolbar·document tabs·status bar | workspace, active document, database→source→namespace→object 문맥, 실행/미저장/차단 상태 | launcher 이름은 Tooltip, background task detail은 popup, 정상 autosave 설명은 숨김 | title/main/status split, active tab boundary, 실제 resize handle | neutral chrome, selection, focus, 실제 lifecycle status | `IdeTitleToolbar`, `IdeTabStrip`, `IdeStatusBarSurface`, `Status*` |
| Database Explorer | data source/database/schema/object 이름, 선택 scope 수, 접근·불러오기 오류와 recovery | 반복 command는 icon+Tooltip, object metadata는 expand/hover, empty source catalog는 연결 전만 표시 | tool-window split, sticky header, selected/focus, resize boundary | neutral tree, selection/focus, diff/error에만 status | `ToolWindowHeader`, `TreeSectionButton`, `VirtualTreeRows`, `ToolbarMenu` |
| Data Sources and Drivers | category/source/driver identity, 실제 property label, validation, Problems, Test/Save/Save and close | driver capability detail과 credential 도움말은 선택된 detail/오류에만 표시 | catalog/detail split, field/focus, sticky action bars, dialog boundary | neutral form, focus, validation status, local brand asset | `Modal*`, `PropertyRow`, `Field`, `PanelTabs`, `DiagnosticSummary` |
| SQL editor | document/schema/mode, 실행·취소, parameter/Tx 예외 상태 | 실행/history/format은 icon+Tooltip, 정상 저장 상태는 숨김, 결과 SQL은 Result toolbar에서 반복하지 않음 | editor/result split, toolbar divider, focus/selection | neutral editor, success glyph, running/warning/error 상태 | `WorkbenchPane`, `WorkbenchToolbar`, `WorkbenchButton`, `ManualTransactionControls` |
| Services·Result·Output | session/document/result tab, running/waiting/error, row count/duration | full SQL/error detail은 선택 Result/Output에서만, export 형식은 menu | tree/result split, sticky tab/header/footer, selected/focus | neutral workbench, lifecycle status, grid selection/focus | `ToolWindowHeader`, `IdeToolTabStrip`, `ResultWorkbench*`, `DataGridStatusPill` |
| table data·Mongo Documents | object/query context, WHERE/ORDER BY 또는 operation, staged/write/error 상태, 실제 values | 반복 edit/export command는 icon/menu, query 도움말은 error/first-use에만 | toolbar/body/inspector split, grid header/frozen/resize/focus; body vertical cell line 없음 | neutral data surface, selection/focus, NULL/mutation/error 의미 | `TableToolbar`, `TableExpressionBar`, `DataGridViewport`, `Inspector*` |
| Agent·approval | Agent identity, user/final answer, current one-line activity, permission reason/options, attached DB context; 빈 transcript는 실제 capability 3줄만 표시 | raw tool input/output는 debug mode, provider setup/terms는 CLI missing·logout일 때만, 종료 세션 resume은 History 선택 뒤만, 빈 상태 제목·설명 문단은 숨김 | tool-window split, composer/approval/focus boundary; transcript card border 반복 금지 | neutral transcript, focus, trust/warning/danger와 local provider mark | `ToolWindowComposer*`, `AgentActivityLine`, `AgentToolCallCard`, `AgentPermissionCard`, `AgentRichText` |
| Settings·provider·jobs | selected setting, editable value, progress, failure와 recovery | 정상 상태 설명과 provider metadata는 detail/diagnostic으로 이동 | rail/detail split, field/focus, progress track, modal boundary | neutral settings, progress/focus, 실제 status | `SettingsGroup`, form primitives, `ProgressBar`, `InlineNotice`, `Modal*` |
| onboarding·empty·loading·error | 첫 선택에 필요한 설명, 현재 blocked reason, 직접 실행할 recovery | steady-state에서는 onboarding 문단 제거, 3초 미만 loading은 control/label feedback으로 축약 | dialog/empty owner의 한 boundary; nested card 금지 | neutral surface, actionable warning/danger only | `WorkbenchEmptyState`, `LoadingLabel`, `InlineNotice`, startup `Modal*` |
| popup·menu·tooltip·toast | menu command label, current selection, actionable toast | Tooltip은 icon command명/shortcut만, 위험·오류 본문은 owner surface에 유지 | viewport collision을 가진 floating boundary와 focus ring | popover surface, selection/focus, 실제 status | `ToolbarMenu`, `PopupMenu*`, `Tooltip`, toast primitive |

## 2026-08-06 source audit 결과

- core chrome의 색 역할은 `tokens.css`에 남기고 chart, terminal ANSI, Agent
  syntax는 `scoped-palettes.css`의 닫힌 namespace로 분리했다.
- provider/engine 색은 로컬 brand asset만 소유하고, ERD SVG/PNG/PDF의 색은
  CSS와 분리된 `ERD_EXPORT_PALETTE`가 소유한다.
- 일반·virtual DataGrid는 body vertical cell line을 사용하지 않고 같은 header,
  row-number/frozen, resize, selection/focus 계약을 사용한다.
- icon-only 공용 `Button`은 native title 대신 hover/focus parity와 Escape dismiss를
  가진 canonical `Tooltip`을 사용한다.
- ERD, Documents, Schema, Dashboard, Job, Schema Diff에 남아 있던 raw
  `.btn.icon-only` 명령 13개를 공용 `Button`으로 이관하고
  `pnpm check:ui-primitives`로 재도입을 차단한다.
- `pnpm check:ui-palette`가 scoped palette 소비자 이탈과 feature TSX/CSS의 raw
  color 재도입을 build에서 차단한다.
- Explorer의 단일 namespace badge가 `1`로 축약되어 선택/전체 의미를 잃던
  gap은 같은 `1393×862` fixture의 before/after를
  [`audits/ui-polish-2026-08-06`](../audits/ui-polish-2026-08-06/README.md)에
  기록하고 `1 of 1`로 교정했다.
- 빈 AI Chat은 큰 제목과 설명 문단을 제거하고 실제 SQL·탐색·승인 capability
  세 줄만 남겼다. `1400×929` 검수 viewport에서도 composer와 picker를 유지하며
  editor 전용 capability는 추가하지 않았다.
- Welcome 문서는 logo·큰 제목·반복 설명 구획을 제거하고 실제 새 쿼리·새
  연결·전체 검색 command만 남겼다. 연결 전에는 첫 데이터 소스 선택에 필요한
  한 줄만 표시하며 Files/VCS command는 기능 범위 결정에 따라 추가하지 않았다.
- 공용 modal은 첫 작업 control, Tab/Shift+Tab 순환, 외부 focus containment와
  trigger 복구를 소유한다. 360px Agent 선택 modal은 첫 checkbox와 semantic
  focus ring을 사용하고 body/footer를 같은 viewport 안에 유지한다.

## 아직 완료 증거가 아닌 항목

- Explorer scope badge, Agent 빈 transcript, Welcome 외 shell·data editor·Agent
  실행 상태 등 기준 시나리오의 같은 state·viewport before/after capture
- 30개 이상 column, 긴 NULL/text/numeric data에서 line 없는 grid의 실제 비교
- macOS·Windows packaged App의 compact tooltip/focus/text rendering
- popup, tab, resize, loading 전환의 60fps continuity와 selection/scroll 보존 기록

이 네 항목이 남아 있는 동안 #111과 #112를 완료로 닫지 않는다.
