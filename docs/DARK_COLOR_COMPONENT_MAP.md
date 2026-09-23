# 다크 색 역할과 컴포넌트 배정

이 문서는 Desktop 다크 테마의 색 배정과 UI TSX 파일 전수 목록을 기록한다.
Desktop의 값은 `src/design-system/tokens.css`에 적용되어 있다. Workspace Web은
현재 밝은 관리 화면을, 공개 사이트는 별도 브랜드 화면을 유지한다. 그 두 surface의
행은 Desktop 색을 그대로 이식하라는 뜻이 아니라 색 역할과 소유 파일을 명시한다.

## 색 사용 원칙

선택한 네 색 `#0d1a63`, `#1a2ca3`, `#2845d6`, `#f68048`은 Welcome의 장식
범위에서 직접 사용한다. 작업 화면은 같은 파랑 계열의 채도를 낮춘 면과 밝기를
조절한 단일 primary blue를 사용한다. 주황은 경고·실패·쓰기 권한을 뜻하지 않는다.
연결 상태는 neutral/info/success/warning/danger의 독립된 의미색을 사용한다.
SQL 데이터 값, provider 로고, 그래프 범주에는 앱 chrome 팔레트를 강제로 씌우지
않는다. 색만으로 선택·위험·환경을 전달하지 않고 텍스트와 표시를 함께 둔다.

| 역할 | 다크 값 | 적용 위치 |
| --- | --- | --- |
| `background` | `#101422` | 작업 canvas |
| `editor` | `#111722` | SQL/코드 입력과 출력 |
| `sidebar` | `#151c2c` | Explorer, 보조 탐색 |
| `sidebar-accent` | `#22304b` | Explorer의 낮은 강조 |
| `secondary` | `#1b2537` | 낮은 강조의 구역과 control |
| `card` | `#202a3e` | 선택 가능한 연결 카드와 정보 그룹 |
| `popover` | `#29344a` | 떠 있는 메뉴·dialog·tooltip |
| `muted` | `#242e42` | hover, 낮은 강조 배경 |
| `selection` | `#253a70` | 선택된 탭·행; primary 버튼과 분리 |
| `border-subtle` | `#39455b` | 장식적 구분선 |
| `border-strong` | `#657795` | 필요한 control 경계 |
| `foreground` | `#e8eefa` | 주요 글자 |
| `card/popover/secondary-foreground` | `#e8eefa` | 각 surface 위 주요 글자 |
| `muted-foreground` | `#acbbd2` | 보조 글자 |
| `text-subtle` | `#97a7c1` | 덜 중요한 metadata |
| `input` | `#354157` | 입력 필드 경계 |
| `primary` | `#3556e5` | 한 흐름의 주 동작 |
| `primary-hover` | `#4565f0` | 주 동작 hover |
| `primary-foreground` | `#ffffff` | primary 버튼 위 글자 |
| `accent-text` | `#a5b6ff` | 선택·강조의 작은 텍스트 |
| `accent-soft` | `#24336b` | 낮은 강조의 blue 면 |
| `ring` | `#8ba3ff` | 키보드 초점, 강한 선택 outline |
| `overlay` | `rgb(0 0 0 / 0.6)` | modal 뒤 차광 |
| `info` | `#8db4ff` | 진행·정보 |
| `success` | `#88d7a9` | 확인된 성공·연결 |
| `warning` | `#f4c26f` | 검토 필요 |
| `danger` | `#f08a8d` | 실패·차단·삭제 |
| `destructive-foreground` | `#101422` | danger 동작 면 위 글자 |
| `cosmic-night-raised` | `#0d1a63` | Welcome 장식의 깊은 파랑 |
| `cosmic-night-soft` | `#1a2ca3` | Welcome 장식의 중간 파랑 |
| `cosmic-electric` | `#2845d6` | Welcome 장식의 밝은 파랑 |
| `cosmic-warm` | `#f68048` | Welcome의 작은 온색 강조 |

표의 일반 역할은 같은 이름의 `--ds-*` 토큰을 뜻한다. 예외적으로 `editor`는
`--ds-editor-surface`, `sidebar`는 `--ds-worktree-sidebar`와 sidebar의
`--ds-surface-1`, `success`는 `--ds-positive`, `warning`은 `--ds-caution`,
`danger`는 `--ds-destructive`(동작 면)와 `--ds-critical-emphasis`(문구)를
뜻한다. 컴포넌트에서는 이 역할에 대응하는 공용 Tailwind utility를 사용한다.

`primary`는 원래 팔레트의 밝은 파랑을 버튼에서 식별할 수 있게 밝힌 값이다.
`foreground`/`background`는 15.75:1, `muted-foreground`/`card`는 7.38:1,
흰 글자/`primary`는 5.81:1, `border-strong`/`card`는 3.16:1이다. 이 값은
정의된 단색 쌍의 계산이다. 투명도·겹침·화면 밝기·실제 렌더링은 별도 검수가
필요하다. `border-subtle`은 장식선이며 input·focus의 유일한 경계로 쓰지 않는다.

## 적용 경계

- Desktop: 화면에서 raw hex를 넣지 않고 `tw:bg-background`, `tw:bg-card`,
  `tw:text-foreground`, `tw:text-muted-foreground`, `tw:bg-selection`,
  `tw:ring-ring` 등 기존 semantic utility를 사용한다. 공용 primitive의 상태
  변형은 primitive가 소유한다.
- Welcome: `cosmic-*`만 장식에 쓰고 실제 연결·권한·오류 control에는 core 역할을 쓴다.
- Agent 코드 fence와 터미널 ANSI: `scoped-palettes.css`의 독립 palette를 유지한다.
  코드 fence의 배경과 기본 글자만 새 editor scale에 맞췄다.
- Workspace Web: `workspace.css`의 밝은 인증·관리 색 계약을 유지한다. 별도
  다크 모드를 만들 때 `background/surface/foreground/primary/status` 의미를
  재사용하며 Desktop의 hex를 그대로 복제하지 않는다.
- 공개 사이트: `site/app/globals.css`의 별도 브랜드 palette를 유지한다. 앱의
  작업 화면 색을 마케팅 배경에 자동 적용하지 않는다.

## 컴포넌트별 색 배정

아래 표는 UI TSX 파일을 빠짐없이 나열한다. `직접 색 없음`은 provider·wrapper처럼
스스로 색을 그리지 않고 자식 또는 상위 surface의 역할을 따르는 파일이다.
값은 파일에 hex를 쓰라는 지시가 아니라 그 컴포넌트가 소비하거나 상속할 의미
역할이다. 상태색은 실제 상태가 있을 때만 사용한다.

### Desktop 공통 primitive (30개)

| 컴포넌트 파일 | 배정할 색 역할 |
| --- | --- |
| [`src/design-system/components/Agent.tsx`](../src/design-system/components/Agent.tsx) | card·foreground·info/warning/danger: 관찰·승인 카드 |
| [`src/design-system/components/AgentRichText.tsx`](../src/design-system/components/AgentRichText.tsx) | editor·foreground·muted-foreground; 코드 fence는 syntax 전용 |
| [`src/design-system/components/AnalysisArticleBody.tsx`](../src/design-system/components/AnalysisArticleBody.tsx) | background·foreground·muted-foreground; 본문 링크만 info |
| [`src/design-system/components/AppChrome.tsx`](../src/design-system/components/AppChrome.tsx) | card·sidebar·foreground·border-subtle: 제목·상태 chrome |
| [`src/design-system/components/Button.tsx`](../src/design-system/components/Button.tsx) | primary/secondary/danger + 각 foreground·ring: variant별 단일 동작 |
| [`src/design-system/components/CommandMenu.tsx`](../src/design-system/components/CommandMenu.tsx) | popover·foreground·selection·ring: 검색과 결과 행 |
| [`src/design-system/components/DataGridViewport.tsx`](../src/design-system/components/DataGridViewport.tsx) | editor·foreground·selection·border-subtle: grid scroll 면 |
| [`src/design-system/components/Diagnostics.tsx`](../src/design-system/components/Diagnostics.tsx) | card·muted-foreground·warning/danger: 진단 행 |
| [`src/design-system/components/DopeDBMark.tsx`](../src/design-system/components/DopeDBMark.tsx) | brand SVG 상속; 배경색 직접 지정 없음 |
| [`src/design-system/components/DopeDBMarkGraphic.tsx`](../src/design-system/components/DopeDBMarkGraphic.tsx) | 생성된 brand SVG; 직접 수정·재색칠 없음 |
| [`src/design-system/components/EnvironmentBadge.tsx`](../src/design-system/components/EnvironmentBadge.tsx) | muted·foreground + 상태 dot: 환경 텍스트 유지 |
| [`src/design-system/components/FormControls.tsx`](../src/design-system/components/FormControls.tsx) | secondary·foreground·input·ring·danger: 필드와 검증 |
| [`src/design-system/components/IconRailTabs.tsx`](../src/design-system/components/IconRailTabs.tsx) | sidebar·muted-foreground·selection·ring: 선택 category |
| [`src/design-system/components/IdeTabs.tsx`](../src/design-system/components/IdeTabs.tsx) | card·foreground·muted-foreground·selection·ring: 열린 탭 |
| [`src/design-system/components/Modal.tsx`](../src/design-system/components/Modal.tsx) | popover·overlay·foreground·border-strong·ring: dialog |
| [`src/design-system/components/PanelTabs.tsx`](../src/design-system/components/PanelTabs.tsx) | card·foreground·selection·ring: 설정/property 탭 |
| [`src/design-system/components/PopupMenu.tsx`](../src/design-system/components/PopupMenu.tsx) | popover·foreground·selection·ring: 메뉴 행 |
| [`src/design-system/components/Progress.tsx`](../src/design-system/components/Progress.tsx) | muted·primary·info: 진행 막대 |
| [`src/design-system/components/RenderRecoveryBoundary.tsx`](../src/design-system/components/RenderRecoveryBoundary.tsx) | card·foreground·danger·primary: 재시도 |
| [`src/design-system/components/ResizeSeparator.tsx`](../src/design-system/components/ResizeSeparator.tsx) | border-subtle·ring: 크기 조절 focus |
| [`src/design-system/components/SegmentedControl.tsx`](../src/design-system/components/SegmentedControl.tsx) | secondary·selection·foreground·ring: 단일 선택 |
| [`src/design-system/components/Settings.tsx`](../src/design-system/components/Settings.tsx) | background·foreground·border-subtle: 그룹 구분 |
| [`src/design-system/components/SettingsList.tsx`](../src/design-system/components/SettingsList.tsx) | background·foreground·muted-foreground·border-subtle |
| [`src/design-system/components/Status.tsx`](../src/design-system/components/Status.tsx) | muted + info/success/warning/danger: 상태별 의미색 |
| [`src/design-system/components/ToolWindow.tsx`](../src/design-system/components/ToolWindow.tsx) | sidebar·foreground·muted-foreground·border-subtle |
| [`src/design-system/components/Tooltip.tsx`](../src/design-system/components/Tooltip.tsx) | popover·popover-foreground·border-strong |
| [`src/design-system/components/TreeControls.tsx`](../src/design-system/components/TreeControls.tsx) | sidebar·selection·foreground·muted-foreground·ring |
| [`src/design-system/components/VirtualTreeRows.tsx`](../src/design-system/components/VirtualTreeRows.tsx) | 행 색 직접 지정 없음; TreeControls/호출자 상속 |
| [`src/design-system/components/Workbench.tsx`](../src/design-system/components/Workbench.tsx) | background·editor·foreground·border-subtle: 중앙 작업 면 |
| [`src/design-system/components/WorkspaceIdentity.tsx`](../src/design-system/components/WorkspaceIdentity.tsx) | Workspace Web 인증 팔레트 상속; Desktop core 색 직접 지정 없음 |

### Desktop 공용 위젯 (12개)

| 컴포넌트 파일 | 배정할 색 역할 |
| --- | --- |
| [`src/components/CellViewer.tsx`](../src/components/CellViewer.tsx) | popover·editor·foreground·border-subtle |
| [`src/components/ConfirmButton.tsx`](../src/components/ConfirmButton.tsx) | secondary→danger·ring: 두 단계 확인 |
| [`src/components/EngineMark.tsx`](../src/components/EngineMark.tsx) | 공식 engine asset; 배경·상태색 직접 지정 없음 |
| [`src/components/Icon.tsx`](../src/components/Icon.tsx) | currentColor 상속; 의미색은 부모 control 소유 |
| [`src/components/InfoTip.tsx`](../src/components/InfoTip.tsx) | muted-foreground·popover·ring |
| [`src/components/LazySqlViewer.tsx`](../src/components/LazySqlViewer.tsx) | editor·foreground; SQL syntax는 전용 palette |
| [`src/components/RowEditor.tsx`](../src/components/RowEditor.tsx) | card·input·foreground·ring·danger |
| [`src/components/Skeleton.tsx`](../src/components/Skeleton.tsx) | muted: 로딩 자리 표시 |
| [`src/components/SqlViewer.tsx`](../src/components/SqlViewer.tsx) | editor·foreground; SQL syntax는 전용 palette |
| [`src/components/Toast.tsx`](../src/components/Toast.tsx) | popover·foreground + 실제 상태색 |
| [`src/components/ToolbarMenu.tsx`](../src/components/ToolbarMenu.tsx) | popover·foreground·selection·ring |
| [`src/components/WorkbenchDocumentStrip.tsx`](../src/components/WorkbenchDocumentStrip.tsx) | card·foreground·selection·ring |

### Desktop 기능·화면 (125개)

| 컴포넌트 파일 | 배정할 색 역할 |
| --- | --- |
| [`src/features/actionSearch/ActionSearch.tsx`](../src/features/actionSearch/ActionSearch.tsx) | popover·foreground·selection·ring |
| [`src/features/agents/AcpAgentModelMenu.tsx`](../src/features/agents/AcpAgentModelMenu.tsx) | popover·foreground·selection·ring: Agent·model 선택 |
| [`src/features/agents/AcpChatComposer.tsx`](../src/features/agents/AcpChatComposer.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/features/agents/AcpChatHeaderActions.tsx`](../src/features/agents/AcpChatHeaderActions.tsx) | card·foreground·muted-foreground: 채팅 상단 동작 |
| [`src/features/agents/AcpChatPanel.tsx`](../src/features/agents/AcpChatPanel.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/features/agents/AcpChatTranscript.tsx`](../src/features/agents/AcpChatTranscript.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/features/agents/AcpConfigSelect.tsx`](../src/features/agents/AcpConfigSelect.tsx) | card·foreground·selection·ring: exact resource 선택 |
| [`src/features/agents/AcpScopeSelect.tsx`](../src/features/agents/AcpScopeSelect.tsx) | card·foreground·selection·ring: exact resource 선택 |
| [`src/features/agents/AcpSqlApproval.tsx`](../src/features/agents/AcpSqlApproval.tsx) | popover·foreground·warning/danger·ring: 승인·거절 |
| [`src/features/agents/AcpStructuredResult.tsx`](../src/features/agents/AcpStructuredResult.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/features/agents/AgentCliStatus.tsx`](../src/features/agents/AgentCliStatus.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/features/agents/ExternalAgentConfigurationPicker.tsx`](../src/features/agents/ExternalAgentConfigurationPicker.tsx) | card·foreground·selection·ring: exact resource 선택 |
| [`src/features/agents/ExternalAgentRequestDialogs.tsx`](../src/features/agents/ExternalAgentRequestDialogs.tsx) | popover·foreground·warning/danger·ring: 승인·거절 |
| [`src/features/agents/ExternalAgentRequestGate.tsx`](../src/features/agents/ExternalAgentRequestGate.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/features/agents/ExternalAgentRequestReview.tsx`](../src/features/agents/ExternalAgentRequestReview.tsx) | popover·foreground·warning/danger·ring: 승인·거절 |
| [`src/features/agents/selectionContext.tsx`](../src/features/agents/selectionContext.tsx) | card·foreground·selection·ring: exact resource 선택 |
| [`src/features/analysisArticles/AnalysisArticleEditor.tsx`](../src/features/analysisArticles/AnalysisArticleEditor.tsx) | background·card·foreground·muted-foreground·primary; 공개/실패는 상태색 |
| [`src/features/analysisArticles/AnalysisArticleReader.tsx`](../src/features/analysisArticles/AnalysisArticleReader.tsx) | background·card·foreground·muted-foreground·primary; 공개/실패는 상태색 |
| [`src/features/analysisArticles/AnalysisPublicationPanel.tsx`](../src/features/analysisArticles/AnalysisPublicationPanel.tsx) | background·card·foreground·muted-foreground·primary; 공개/실패는 상태색 |
| [`src/features/analysisArticles/AnalysisShareButton.tsx`](../src/features/analysisArticles/AnalysisShareButton.tsx) | background·card·foreground·muted-foreground·primary; 공개/실패는 상태색 |
| [`src/features/analysisArticles/ArticleLinkGate.tsx`](../src/features/analysisArticles/ArticleLinkGate.tsx) | background·card·foreground·muted-foreground·primary; 공개/실패는 상태색 |
| [`src/features/appShell/AppShell.tsx`](../src/features/appShell/AppShell.tsx) | background·sidebar·card·border-subtle: shell frame |
| [`src/features/appShell/ConnectionPicker.tsx`](../src/features/appShell/ConnectionPicker.tsx) | background·card·foreground·muted-foreground·border-strong·primary: 연결 카드 |
| [`src/features/appShell/IdeChrome.tsx`](../src/features/appShell/IdeChrome.tsx) | card·foreground·muted-foreground·selection·ring: title/status |
| [`src/features/appShell/ShellLayout.tsx`](../src/features/appShell/ShellLayout.tsx) | background·sidebar·card·border-subtle: shell frame |
| [`src/features/appShell/WorkbenchContent.tsx`](../src/features/appShell/WorkbenchContent.tsx) | background·editor·foreground: 선택된 중앙 문서 |
| [`src/features/appShell/WorkspaceNavigation.tsx`](../src/features/appShell/WorkspaceNavigation.tsx) | sidebar·foreground·selection·ring: Workspace/Project 탐색 |
| [`src/features/backgroundTasks/BackgroundTasksMenu.tsx`](../src/features/backgroundTasks/BackgroundTasksMenu.tsx) | card·popover·foreground·muted-foreground·info/success/warning/danger |
| [`src/features/connections/ManagedConnectionRecoveryNotice.tsx`](../src/features/connections/ManagedConnectionRecoveryNotice.tsx) | card·foreground·muted-foreground; 복구/연결 상태만 info/warning/danger |
| [`src/features/connections/ProviderTargetLabel.tsx`](../src/features/connections/ProviderTargetLabel.tsx) | card·foreground·muted-foreground; 복구/연결 상태만 info/warning/danger |
| [`src/features/cosmicScene/CosmicBackdrop.tsx`](../src/features/cosmicScene/CosmicBackdrop.tsx) | cosmic-night/soft/electric/warm: Welcome 장식만 |
| [`src/features/erd/ErdCanvas.tsx`](../src/features/erd/ErdCanvas.tsx) | editor·foreground·border-subtle·selection; 그래프 범주는 artifact 전용 |
| [`src/features/erd/ErdRelationNode.tsx`](../src/features/erd/ErdRelationNode.tsx) | editor·foreground·border-subtle·selection; 그래프 범주는 artifact 전용 |
| [`src/features/erd/ErdToolbar.tsx`](../src/features/erd/ErdToolbar.tsx) | editor·foreground·border-subtle·selection; 그래프 범주는 artifact 전용 |
| [`src/features/jobs/JobPanel.tsx`](../src/features/jobs/JobPanel.tsx) | card·popover·foreground·muted-foreground·info/success/warning/danger |
| [`src/features/jobs/JobPlanForm.tsx`](../src/features/jobs/JobPlanForm.tsx) | card·popover·foreground·muted-foreground·info/success/warning/danger |
| [`src/features/knowledge/components/EnvironmentSetupDialog.tsx`](../src/features/knowledge/components/EnvironmentSetupDialog.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/features/knowledge/components/KnowledgeDatabaseSection.tsx`](../src/features/knowledge/components/KnowledgeDatabaseSection.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/features/knowledge/components/KnowledgeSourceSections.tsx`](../src/features/knowledge/components/KnowledgeSourceSections.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/features/knowledge/components/KnowledgeWorkspaceHeader.tsx`](../src/features/knowledge/components/KnowledgeWorkspaceHeader.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/features/knowledge/components/ProjectSetupDialog.tsx`](../src/features/knowledge/components/ProjectSetupDialog.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/features/localHistory/LocalHistoryToolWindow.tsx`](../src/features/localHistory/LocalHistoryToolWindow.tsx) | sidebar·foreground·muted-foreground·selection·ring |
| [`src/features/productAnalytics/ConsentPrompt.tsx`](../src/features/productAnalytics/ConsentPrompt.tsx) | popover·foreground·muted-foreground·primary·ring |
| [`src/features/productAnalytics/WorkspaceScopeObserver.tsx`](../src/features/productAnalytics/WorkspaceScopeObserver.tsx) | 직접 색 없음: 범위 상태 관찰 |
| [`src/features/providers/ManagedAccessDialog.tsx`](../src/features/providers/ManagedAccessDialog.tsx) | popover·foreground·input·ring; 연결 진단만 semantic 색 |
| [`src/features/providers/ProviderCredentialDialog.tsx`](../src/features/providers/ProviderCredentialDialog.tsx) | popover·foreground·input·ring; 연결 진단만 semantic 색 |
| [`src/features/providers/ProviderCredentialsMenuItem.tsx`](../src/features/providers/ProviderCredentialsMenuItem.tsx) | popover·foreground·input·ring; 연결 진단만 semantic 색 |
| [`src/features/queries/ManualTransactionControls.tsx`](../src/features/queries/ManualTransactionControls.tsx) | editor·foreground·muted-foreground·ring; 쓰기/오류는 warning/danger |
| [`src/features/queries/ManualTransactionsMenu.tsx`](../src/features/queries/ManualTransactionsMenu.tsx) | editor·foreground·muted-foreground·ring; 쓰기/오류는 warning/danger |
| [`src/features/queryResults/DataGrid.tsx`](../src/features/queryResults/DataGrid.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/queryResults/DataGridColumnFilterMenu.tsx`](../src/features/queryResults/DataGridColumnFilterMenu.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/queryResults/DataGridVirtual.tsx`](../src/features/queryResults/DataGridVirtual.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/queryResults/InspectableResultGrid.tsx`](../src/features/queryResults/InspectableResultGrid.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/queryResults/ResultToolbar.tsx`](../src/features/queryResults/ResultToolbar.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/queryResults/ResultWorkbench.tsx`](../src/features/queryResults/ResultWorkbench.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/queryServices/QueryResultsPane.tsx`](../src/features/queryServices/QueryResultsPane.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/queryServices/QueryServiceResult.tsx`](../src/features/queryServices/QueryServiceResult.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/queryServices/StreamOutcome.tsx`](../src/features/queryServices/StreamOutcome.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/features/settings/agentTools/AgentPluginSection.tsx`](../src/features/settings/agentTools/AgentPluginSection.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/features/settings/agentTools/AgentSkillSection.tsx`](../src/features/settings/agentTools/AgentSkillSection.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/features/skills/SkillStartupGate.tsx`](../src/features/skills/SkillStartupGate.tsx) | popover·foreground·primary·ring |
| [`src/features/terminals/PtySurface.tsx`](../src/features/terminals/PtySurface.tsx) | editor·foreground; ANSI는 terminal 전용 palette |
| [`src/features/workspaces/DesktopLoginPage.tsx`](../src/features/workspaces/DesktopLoginPage.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/features/workspaces/components/WorkspaceAccount.tsx`](../src/features/workspaces/components/WorkspaceAccount.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/features/workspaces/components/WorkspaceConnectionDialog.tsx`](../src/features/workspaces/components/WorkspaceConnectionDialog.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/features/workspaces/components/WorkspaceSwitcher.tsx`](../src/features/workspaces/components/WorkspaceSwitcher.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Activity/index.tsx`](../src/screens/Activity/index.tsx) | card·popover·foreground·muted-foreground·info/success/warning/danger |
| [`src/screens/Connections/CatalogTree.tsx`](../src/screens/Connections/CatalogTree.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/CatalogTreeRows.tsx`](../src/screens/Connections/CatalogTreeRows.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/CatalogTreeStatus.tsx`](../src/screens/Connections/CatalogTreeStatus.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/ConnectionAdvancedTab.tsx`](../src/screens/Connections/ConnectionAdvancedTab.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionBigQueryFields.tsx`](../src/screens/Connections/ConnectionBigQueryFields.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionCatalogCompactSelector.tsx`](../src/screens/Connections/ConnectionCatalogCompactSelector.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionCatalogDetail.tsx`](../src/screens/Connections/ConnectionCatalogDetail.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionCatalogNavigation.tsx`](../src/screens/Connections/ConnectionCatalogNavigation.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionCloudflareD1Fields.tsx`](../src/screens/Connections/ConnectionCloudflareD1Fields.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionDatabaseField.tsx`](../src/screens/Connections/ConnectionDatabaseField.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionEditorDialogs.tsx`](../src/screens/Connections/ConnectionEditorDialogs.tsx) | popover·foreground·overlay·ring; 상태만 semantic 색 |
| [`src/screens/Connections/ConnectionEditorFooter.tsx`](../src/screens/Connections/ConnectionEditorFooter.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionForm.tsx`](../src/screens/Connections/ConnectionForm.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionGeneralTab.tsx`](../src/screens/Connections/ConnectionGeneralTab.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionNode.tsx`](../src/screens/Connections/ConnectionNode.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/ConnectionOptionsTab.tsx`](../src/screens/Connections/ConnectionOptionsTab.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionProfilePanel.tsx`](../src/screens/Connections/ConnectionProfilePanel.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionSchemaTab.tsx`](../src/screens/Connections/ConnectionSchemaTab.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionSecurityTab.tsx`](../src/screens/Connections/ConnectionSecurityTab.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/ConnectionSourcePicker.tsx`](../src/screens/Connections/ConnectionSourcePicker.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/DatabaseExplorer.tsx`](../src/screens/Connections/DatabaseExplorer.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/DatabaseExplorerEmptyState.tsx`](../src/screens/Connections/DatabaseExplorerEmptyState.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/DatabaseExplorerOverlays.tsx`](../src/screens/Connections/DatabaseExplorerOverlays.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/DatabaseExplorerToolbar.tsx`](../src/screens/Connections/DatabaseExplorerToolbar.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/DdlModal.tsx`](../src/screens/Connections/DdlModal.tsx) | popover·foreground·overlay·ring; 상태만 semantic 색 |
| [`src/screens/Connections/KnowledgeProjectTree.tsx`](../src/screens/Connections/KnowledgeProjectTree.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/ManagedWorkspaceConnectionField.tsx`](../src/screens/Connections/ManagedWorkspaceConnectionField.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/SchemaConnectionGroupRow.tsx`](../src/screens/Connections/SchemaConnectionGroupRow.tsx) | sidebar·foreground·muted-foreground·selection·border-subtle·ring |
| [`src/screens/Connections/index.tsx`](../src/screens/Connections/index.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Connections/schemaDiffPresentation.tsx`](../src/screens/Connections/schemaDiffPresentation.tsx) | card·foreground·muted-foreground·input·border-subtle·ring; 검증만 danger |
| [`src/screens/Documents/index.tsx`](../src/screens/Documents/index.tsx) | editor·foreground·muted-foreground·selection·ring |
| [`src/screens/Knowledge/AnalysisArticles.tsx`](../src/screens/Knowledge/AnalysisArticles.tsx) | background·card·foreground·muted-foreground·primary; 공개/실패는 상태색 |
| [`src/screens/Knowledge/index.tsx`](../src/screens/Knowledge/index.tsx) | background·card·foreground·muted-foreground·primary; 공개/실패는 상태색 |
| [`src/screens/Onboarding/index.tsx`](../src/screens/Onboarding/index.tsx) | background·foreground·primary; 장식만 cosmic-* |
| [`src/screens/Schema/index.tsx`](../src/screens/Schema/index.tsx) | background·card·foreground·muted-foreground·border-subtle |
| [`src/screens/SchemaDiff/SchemaDiffResults.tsx`](../src/screens/SchemaDiff/SchemaDiffResults.tsx) | background·card·foreground·muted-foreground; 차이 표시는 기호+상태색 |
| [`src/screens/SchemaDiff/index.tsx`](../src/screens/SchemaDiff/index.tsx) | background·card·foreground·muted-foreground; 차이 표시는 기호+상태색 |
| [`src/screens/Settings/Advanced/index.tsx`](../src/screens/Settings/Advanced/index.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Settings/AgentTools/index.tsx`](../src/screens/Settings/AgentTools/index.tsx) | card·foreground·muted-foreground·info/warning/danger: Agent 상태 |
| [`src/screens/Settings/Appearance.tsx`](../src/screens/Settings/Appearance.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Settings/Cli/AdvancedShellTerminal.tsx`](../src/screens/Settings/Cli/AdvancedShellTerminal.tsx) | editor·foreground·ring; 출력의 ANSI는 terminal 전용 palette |
| [`src/screens/Settings/Cli/index.tsx`](../src/screens/Settings/Cli/index.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Settings/Privacy/index.tsx`](../src/screens/Settings/Privacy/index.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Settings/Safety/AccessPermissions.tsx`](../src/screens/Settings/Safety/AccessPermissions.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Settings/Safety/MonitoringAccess.tsx`](../src/screens/Settings/Safety/MonitoringAccess.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Settings/Safety/index.tsx`](../src/screens/Settings/Safety/index.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Settings/Updates/index.tsx`](../src/screens/Settings/Updates/index.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Settings/index.tsx`](../src/screens/Settings/index.tsx) | background·card·foreground·muted-foreground·input·ring; 접근 상태만 semantic 색 |
| [`src/screens/Sql/SqlParameterDialog.tsx`](../src/screens/Sql/SqlParameterDialog.tsx) | editor·foreground·muted-foreground·ring; 쓰기/오류는 warning/danger |
| [`src/screens/Sql/index.tsx`](../src/screens/Sql/index.tsx) | editor·foreground·muted-foreground·ring; 쓰기/오류는 warning/danger |
| [`src/screens/Tables/MongoTableData.tsx`](../src/screens/Tables/MongoTableData.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/screens/Tables/Pager.tsx`](../src/screens/Tables/Pager.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/screens/Tables/SqlTableData.tsx`](../src/screens/Tables/SqlTableData.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/screens/Tables/TableExpressionBar.tsx`](../src/screens/Tables/TableExpressionBar.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/screens/Tables/TableSidePanel.tsx`](../src/screens/Tables/TableSidePanel.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/screens/Tables/TableStructure.tsx`](../src/screens/Tables/TableStructure.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/screens/Tables/TableToolbar.tsx`](../src/screens/Tables/TableToolbar.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |
| [`src/screens/Tables/index.tsx`](../src/screens/Tables/index.tsx) | editor·foreground·muted-foreground·border-subtle·selection·ring; 오류만 danger |

### Workspace Web (42개)

| 컴포넌트 파일 | 배정할 색 역할 |
| --- | --- |
| [`workspace-cloud/app/accept-invitation/[invitationId]/AcceptInvitation.tsx`](../workspace-cloud/app/accept-invitation/[invitationId]/AcceptInvitation.tsx) | Workspace 인증 `background`·`surface`·`text`·`accent` |
| [`workspace-cloud/app/accept-invitation/[invitationId]/page.tsx`](../workspace-cloud/app/accept-invitation/[invitationId]/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/analyses/[slug]/PublicAnalysisArticle.tsx`](../workspace-cloud/app/analyses/[slug]/PublicAnalysisArticle.tsx) | Workspace `background`·`surface`·`text`·`accent`; 공개 본문은 문서 역할 |
| [`workspace-cloud/app/analyses/[slug]/page.tsx`](../workspace-cloud/app/analyses/[slug]/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/article-invitations/[invitationId]/page.tsx`](../workspace-cloud/app/article-invitations/[invitationId]/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/auth/desktop/DesktopAccountActions.tsx`](../workspace-cloud/app/auth/desktop/DesktopAccountActions.tsx) | Workspace 인증 `background`·`surface`·`text`·`accent` |
| [`workspace-cloud/app/auth/desktop/DesktopApproval.tsx`](../workspace-cloud/app/auth/desktop/DesktopApproval.tsx) | Workspace 인증 `background`·`surface`·`text`·`accent` |
| [`workspace-cloud/app/auth/desktop/page.tsx`](../workspace-cloud/app/auth/desktop/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/auth/github/complete/page.tsx`](../workspace-cloud/app/auth/github/complete/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/auth/sign-in/SignInButton.tsx`](../workspace-cloud/app/auth/sign-in/SignInButton.tsx) | Workspace `surface`·`text`·`accent`·`ring`: 버튼/입력 |
| [`workspace-cloud/app/auth/sign-in/page.tsx`](../workspace-cloud/app/auth/sign-in/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/components/Brand.tsx`](../workspace-cloud/app/components/Brand.tsx) | Workspace 브랜드 자산 + `text`; Desktop palette 직접 사용 없음 |
| [`workspace-cloud/app/components/Console.tsx`](../workspace-cloud/app/components/Console.tsx) | Workspace `surface`·`text`·`danger`/`accent`: 안내/복구 |
| [`workspace-cloud/app/components/Controls.tsx`](../workspace-cloud/app/components/Controls.tsx) | Workspace `surface`·`text`·`accent`·`ring`: 버튼/입력 |
| [`workspace-cloud/app/components/LocaleSwitcher.tsx`](../workspace-cloud/app/components/LocaleSwitcher.tsx) | Workspace `background`·`surface`·`text`·`accent`; 위험 동작만 danger |
| [`workspace-cloud/app/components/WebAnalyticsProvider.tsx`](../workspace-cloud/app/components/WebAnalyticsProvider.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/components/WorkspaceLocale.tsx`](../workspace-cloud/app/components/WorkspaceLocale.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/error.tsx`](../workspace-cloud/app/error.tsx) | Workspace `surface`·`text`·`danger`/`accent`: 안내/복구 |
| [`workspace-cloud/app/layout.tsx`](../workspace-cloud/app/layout.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/not-found.tsx`](../workspace-cloud/app/not-found.tsx) | Workspace `surface`·`text`·`danger`/`accent`: 안내/복구 |
| [`workspace-cloud/app/open-article/[workspaceId]/[articleId]/page.tsx`](../workspace-cloud/app/open-article/[workspaceId]/[articleId]/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/page.tsx`](../workspace-cloud/app/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/app/settings/AccountManagementPanel.tsx`](../workspace-cloud/app/settings/AccountManagementPanel.tsx) | Workspace `background`·`surface`·`text`·`accent`; 위험 동작만 danger |
| [`workspace-cloud/app/settings/AccountSwitcher.tsx`](../workspace-cloud/app/settings/AccountSwitcher.tsx) | Workspace `background`·`surface`·`text`·`accent`; 위험 동작만 danger |
| [`workspace-cloud/app/settings/ActiveSessions.tsx`](../workspace-cloud/app/settings/ActiveSessions.tsx) | Workspace `background`·`surface`·`text`·`accent`; 위험 동작만 danger |
| [`workspace-cloud/app/settings/CloudAccountPanel.tsx`](../workspace-cloud/app/settings/CloudAccountPanel.tsx) | Workspace `surface`·`text`·`accent`; 공급자 상태만 semantic |
| [`workspace-cloud/app/settings/ConnectionAccessPanel.tsx`](../workspace-cloud/app/settings/ConnectionAccessPanel.tsx) | Workspace `surface`·`text`·`muted-foreground`·`accent`; 권한 경고만 semantic |
| [`workspace-cloud/app/settings/CreateWorkspaceForm.tsx`](../workspace-cloud/app/settings/CreateWorkspaceForm.tsx) | Workspace `background`·`surface`·`text`·`accent`; 위험 동작만 danger |
| [`workspace-cloud/app/settings/SettingsNavigation.tsx`](../workspace-cloud/app/settings/SettingsNavigation.tsx) | Workspace `background`·`surface`·`text`·`accent`; 위험 동작만 danger |
| [`workspace-cloud/app/settings/SharedDatabasePanel.tsx`](../workspace-cloud/app/settings/SharedDatabasePanel.tsx) | Workspace `surface`·`text`·`accent`; 공급자 상태만 semantic |
| [`workspace-cloud/app/settings/WorkspaceAccessPanel.tsx`](../workspace-cloud/app/settings/WorkspaceAccessPanel.tsx) | Workspace `surface`·`text`·`muted-foreground`·`accent`; 권한 경고만 semantic |
| [`workspace-cloud/app/settings/WorkspaceLifecyclePanel.tsx`](../workspace-cloud/app/settings/WorkspaceLifecyclePanel.tsx) | Workspace `background`·`surface`·`text`·`accent`; 위험 동작만 danger |
| [`workspace-cloud/app/settings/WorkspaceManagementPanel.tsx`](../workspace-cloud/app/settings/WorkspaceManagementPanel.tsx) | Workspace `background`·`surface`·`text`·`accent`; 위험 동작만 danger |
| [`workspace-cloud/app/settings/page.tsx`](../workspace-cloud/app/settings/page.tsx) | 직접 색 없음 또는 상위 Workspace surface 상속 |
| [`workspace-cloud/features/articleSharing/HandoffPage.tsx`](../workspace-cloud/features/articleSharing/HandoffPage.tsx) | Workspace `background`·`surface`·`text`·`accent`; 공개 본문은 문서 역할 |
| [`workspace-cloud/features/articleSharing/InvitationAcceptButton.tsx`](../workspace-cloud/features/articleSharing/InvitationAcceptButton.tsx) | Workspace `surface`·`text`·`accent`·`ring`: 버튼/입력 |
| [`workspace-cloud/features/connectionAccess/DesktopAccessReturn.tsx`](../workspace-cloud/features/connectionAccess/DesktopAccessReturn.tsx) | Workspace `surface`·`text`·`muted-foreground`·`accent`; 권한 경고만 semantic |
| [`workspace-cloud/features/connectionAccess/TeamReadAccess.tsx`](../workspace-cloud/features/connectionAccess/TeamReadAccess.tsx) | Workspace `surface`·`text`·`muted-foreground`·`accent`; 권한 경고만 semantic |
| [`workspace-cloud/features/providerAccess/GcpCloudSetup.tsx`](../workspace-cloud/features/providerAccess/GcpCloudSetup.tsx) | Workspace `surface`·`text`·`accent`; 공급자 상태만 semantic |
| [`workspace-cloud/features/providerAccess/NeonBranchManager.tsx`](../workspace-cloud/features/providerAccess/NeonBranchManager.tsx) | Workspace `surface`·`text`·`accent`; 공급자 상태만 semantic |
| [`workspace-cloud/features/providerAccess/ProviderIntegrationList.tsx`](../workspace-cloud/features/providerAccess/ProviderIntegrationList.tsx) | Workspace `surface`·`text`·`accent`; 공급자 상태만 semantic |
| [`workspace-cloud/features/providerAccess/ProviderResourcePicker.tsx`](../workspace-cloud/features/providerAccess/ProviderResourcePicker.tsx) | Workspace `surface`·`text`·`accent`; 공급자 상태만 semantic |

### 공개 사이트 (15개)

| 컴포넌트 파일 | 배정할 색 역할 |
| --- | --- |
| [`site/app/DopeDBMark.tsx`](../site/app/DopeDBMark.tsx) | site 브랜드 SVG; 직접 재색칠 없음 |
| [`site/app/GalaxyHero.tsx`](../site/app/GalaxyHero.tsx) | site `landing-night`·`landing-cream`·`landing-signal`; 장식 한정 |
| [`site/app/HomeChrome.tsx`](../site/app/HomeChrome.tsx) | site `paper`·`ink`·`muted`·`line`; 링크/CTA만 brand |
| [`site/app/HomeDemoShowcase.tsx`](../site/app/HomeDemoShowcase.tsx) | site `landing-night`·`landing-cream`·`landing-signal`; 장식 한정 |
| [`site/app/HomeScopeWalkthrough.tsx`](../site/app/HomeScopeWalkthrough.tsx) | site `landing-night`·`landing-cream`·`landing-signal`; 장식 한정 |
| [`site/app/HomeSections.tsx`](../site/app/HomeSections.tsx) | site `paper`·`ink`·`muted`·`line`; 링크/CTA만 brand |
| [`site/app/MarketingButton.tsx`](../site/app/MarketingButton.tsx) | site `paper`/`ink` 또는 `landing-night`/`cream` + `landing-signal` |
| [`site/app/PlatformDownloads.tsx`](../site/app/PlatformDownloads.tsx) | site `paper`/`ink` 또는 `landing-night`/`cream` + `landing-signal` |
| [`site/app/SitePageEffects.tsx`](../site/app/SitePageEffects.tsx) | 직접 색 없음 또는 site 상위 surface 상속 |
| [`site/app/TrackedLink.tsx`](../site/app/TrackedLink.tsx) | 직접 색 없음 또는 site 상위 surface 상속 |
| [`site/app/components/LegalDocument.tsx`](../site/app/components/LegalDocument.tsx) | site `paper`·`ink`·`muted`·`line`; 링크/CTA만 brand |
| [`site/app/layout.tsx`](../site/app/layout.tsx) | 직접 색 없음 또는 site 상위 surface 상속 |
| [`site/app/page.tsx`](../site/app/page.tsx) | 직접 색 없음 또는 site 상위 surface 상속 |
| [`site/app/privacy/page.tsx`](../site/app/privacy/page.tsx) | 직접 색 없음 또는 site 상위 surface 상속 |
| [`site/app/terms/page.tsx`](../site/app/terms/page.tsx) | 직접 색 없음 또는 site 상위 surface 상속 |
