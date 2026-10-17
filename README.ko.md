<p align="right">
  <a href="./README.md">English</a> · <strong>한국어</strong>
</p>

<p align="center">
  <a href="https://dopedb.dev/ko">
    <img src="./assets/brand/dopedb-icon.svg" width="96" height="96" alt="DopeDB 로고" />
  </a>
</p>

<h1 align="center">DopeDB</h1>

<h3 align="center">Codex에게 prod DB를 맡기기 전에, 경계부터 정하세요.</h3>

<p align="center">
  <strong>DB 접근은 함께, 인증정보는 각자 보관하세요.</strong><br />
  Codex와 Claude가 내가 고른 정확한 권한 안에서만 일하고,<br />
  모든 DB 쓰기는 사람의 승인을 기다리는 오픈소스 데이터베이스 워크스페이스입니다.
</p>

<p align="center">
  <a href="https://dopedb.dev/ko"><strong>웹사이트</strong></a> ·
  <a href="https://github.com/json-choi/dopedb/releases/latest"><strong>Alpha 다운로드</strong></a> ·
  <a href="./docs/PROJECT.md"><strong>문서</strong></a> ·
  <a href="./CONTRIBUTING.md"><strong>기여하기</strong></a>
</p>

<p align="center">
  <a href="https://github.com/json-choi/dopedb/actions/workflows/ci.yml"><img alt="CI 상태" src="https://img.shields.io/github/actions/workflow/status/json-choi/dopedb/ci.yml?branch=main&amp;style=flat-square&amp;label=CI&amp;labelColor=151a16&amp;color=ccf36b" /></a>
  <a href="https://github.com/json-choi/dopedb/releases/latest"><img alt="최신 정식 릴리스" src="https://img.shields.io/github/v/release/json-choi/dopedb?style=flat-square&amp;label=release&amp;labelColor=151a16&amp;color=ccf36b" /></a>
  <a href="./LICENSE"><img alt="MIT 라이선스" src="https://img.shields.io/github/license/json-choi/dopedb?style=flat-square&amp;labelColor=151a16&amp;color=ccf36b" /></a>
  <img alt="프로젝트 상태: alpha" src="https://img.shields.io/badge/status-alpha-ccf36b?style=flat-square&amp;labelColor=151a16" />
</p>

<p align="center">
  <a href="./assets/readme/dopedb-0.5.6-tour.mp4">
    <img src="./assets/readme/dopedb-0.5.6-tour.webp" width="100%" alt="DopeDB 0.5.6 가이드 데모: 기본 Demo SQLite를 열고 주문 테이블을 본 뒤, 해당 DB에 고정된 Claude session에 매출 분석을 요청하는 화면" />
  </a>
</p>

<p align="center"><sub>DopeDB 0.5.6 실제 화면 녹화(길이만 편집) · 기본 Demo SQLite 가이드 데모 · 영어 UI · <a href="./assets/readme/dopedb-0.5.6-tour.mp4">MP4로 보기</a></sub></p>

## 어려운 건 SQL이 아닙니다

팀원이나 Agent가 정확한 권한으로 올바른 데이터베이스에 닿게 하는 일이 어렵습니다.
공용 비밀번호를 메신저에 붙여넣거나, 저장된 모든 연결을 제한 없는 도구 서버에 열지
않고서요.

DopeDB는 공유 정체성과 정책은 워크스페이스에 두고, 인증정보·DB traffic·승인·중단·
복구·감사는 Desktop 경계에 남깁니다.

| 공용 비밀번호 없이 | 모든 열쇠를 쥔 Agent 없이 | 몰래 일어나는 쓰기 없이 |
| --- | --- | --- |
| 워크스페이스는 비밀값 없는 연결 정의만 공유합니다. 구성원은 OS에 저장한 개인 인증정보를 쓰거나, 최소 권한의 단기 인증정보를 메모리에서만 사용합니다. | Codex나 Claude는 한 Project에서 명시적으로 선택한 DB·BigQuery·소스만 사용하며, DB 하나까지만 쓰기 대상으로 지정할 수 있습니다. | 읽기가 기본입니다. 데이터·스키마 변경은 연결마다 직접 켜야 하고, 모든 변경은 정확한 승인을 거칩니다. 취소, 수동 트랜잭션 롤백, 해시 체인 감사 기록이 함께 남습니다. |

## 실제 화면으로 보기

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="./assets/readme/dopedb-0.5.6-agent-session.png" alt="Demo SQLite에 고정된 Claude session이 답하기 전에 DB 구조와 데이터를 먼저 확인하는 화면" />
      <p><strong>Agent는 실제 스키마부터 확인합니다.</strong><br />선택한 Demo SQLite에 고정된 공식 Claude session이 답하기 전에 구조와 데이터를 먼저 읽습니다.</p>
    </td>
    <td width="50%" valign="top">
      <img src="./assets/readme/dopedb-0.5.6-data-grid.png" alt="DopeDB 데이터 그리드에 표시된 Demo SQLite의 orders 테이블" />
      <p><strong>결과는 내 기기에 남습니다.</strong><br />쿼리와 결과 행은 호스팅 DB 프록시가 아니라 내 Desktop을 거칩니다.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./assets/readme/dopedb-0.5.6-safety-guardrails.png" alt="읽기만 켜져 있고 데이터·스키마 변경은 꺼진 연결별 안전 설정 화면" />
      <p><strong>연결마다 정하는 안전장치.</strong><br />필요한 곳에서만 데이터·스키마 변경을 켭니다. 워크스페이스 권한과 DB 인증정보가 여전히 바깥 한계를 정합니다.</p>
    </td>
    <td width="50%" valign="top">
      <img src="./assets/readme/dopedb-0.5.6-write-reconfirm.png" alt="선택한 DB의 revision이 바뀌어 Agent 시작 전에 다시 확인을 요구하는 화면" />
      <p><strong>권한 범위가 바뀌면 Agent는 기다립니다.</strong><br />선택한 DB의 revision이 바뀌면 다음 Agent session을 시작하기 전에 다시 확인을 요청합니다.</p>
    </td>
  </tr>
</table>

<sub>위 화면은 영어 UI로 촬영했습니다. 앱은 한국어와 영어를 모두 지원합니다.</sub>

## 계정도 DB도 없이 바로 체험하기

1. macOS나 Windows용 [Alpha를 다운로드](#alpha-다운로드)합니다. 개인 워크스페이스는
   로그인이 필요 없습니다.
2. 처음 실행하면 사용할 Agent를 고릅니다. DopeDB는 공식 CLI의 로컬 로그인 상태만
   확인하며 자격 증명 파일을 열거나 토큰을 저장하지 않습니다.
3. 시작 화면에서 **가이드 데모로 둘러보기**를 누르면 샘플 주문이 담긴 로컬 Demo
   SQLite가 만들어집니다. 샘플 주문 보기, Agent에게 매출 분석 요청, 정확한 쓰기
   승인 연습까지 실제 제품 흐름 세 가지를 따라가 보세요.

<table>
  <tr>
    <td width="50%"><img src="./assets/readme/dopedb-0.5.6-agent-setup-ko.png" alt="Claude와 Codex 중 사용할 Agent를 고르는 DopeDB 첫 실행 화면" /></td>
    <td width="50%"><img src="./assets/readme/dopedb-0.5.6-welcome-ko.png" alt="이 컴퓨터에서 DB 찾기, 새 연결, 가이드 데모 둘러보기를 제공하는 DopeDB 시작 화면" /></td>
  </tr>
</table>

## 한눈에 보는 권한 경계

```mermaid
flowchart LR
    W["팀 워크스페이스<br/>연결 정체성 · 정책 · grant"]

    subgraph L["구성원의 기기"]
        C["구성원 인증정보<br/>OS 저장소 또는 단기 lease"]
        D["DopeDB Desktop<br/>승인 · 중단 · 복구 · 감사"]
        A["Codex 또는 Claude<br/>하나의 고정된 ACP session"]
        C --> D
        A <-->|session-local typed bridge| D
    end

    DB[(데이터베이스)]
    W -->|비밀값 없는 구성| D
    D -->|로컬 DB traffic| DB
```

DB 실행과 결과 행은 구성원의 기기에 남습니다. Analysis Article을 공유하면 정제된
HTML과 읽기 전용 저장 쿼리 하나의 정의가 업로드됩니다. 외부 독자는 변경 불가능한
HTML 공개본만 볼 수 있고 쿼리를 실행할 수 없습니다. 로그인한 구성원은 Desktop에서
자신의 권한으로 직접 다시 실행합니다.

## Alpha에서 지금 사용할 수 있는 것

| 영역 | 현재 제공 범위 |
| --- | --- |
| Workspace | 개인·팀 워크스페이스, 기기 로그인, 초대, 구성원과 역할 관리 |
| 공유 접근 | 비밀값 없는 연결 템플릿과 구성원별 로컬 인증정보 연결 |
| 관리형 접근 | PlanetScale, Neon, GCP Cloud SQL의 구성원별 만료되는 단기 인증정보 |
| 데이터베이스 | PostgreSQL, MySQL/MariaDB, SQLite, MongoDB와 공식 `bq` CLI를 통한 읽기 전용 Google BigQuery, 스키마 탐색 |
| Agent | 한 Project의 선택한 리소스에 고정된 공식 Codex·Claude ACP 세션과 Desktop에서 승인한 외부 공식 CLI 세션 |
| Article과 초대 | 정제된 HTML과 읽기 전용 저장 쿼리 하나를 공유하며, 수신자 지정 초대를 수락하면 워크스페이스 참여와 읽기 권한 등록을 함께 처리 |
| 안전 | 기본 읽기 전용, 변경 불가능한 쓰기 제안, 정확한 SQL 승인, 실행 중단, 지원 트랜잭션 되돌리기, 결과 보존과 감사 기록 |
| 앱 사용성 | Agent 답변 실시간 스트리밍, 도구 권한 승인 모드, 시스템(기본값)·라이트·다크 테마 선택. DB 쓰기에는 별도 승인이 계속 필요 |
| 로컬 도구 | 수신 포트가 없는 버전 고정 `dopedb` CLI Broker, 비밀값 없는 `.dopedb/agent.json` 구성, 설정 → 명령줄에서 여는 연결 고정 고급 Shell |
| 언어 | 웹사이트, Desktop, GitHub README의 한국어와 영어 |

Article 초대는 지정된 수신자의 로그인이 필요합니다. 앱 설치와 개인 로컬 인증정보
입력은 수신자가 직접 진행합니다. 앱에서 시작한 웹 권한 저장이나 관리형 연결 복구가
완료되면 앱으로 돌아오며, 브라우저가 자동 열기를 막으면 수동 복귀 링크를 사용할 수 있습니다.

## 의도적으로 좁힌 범위

DopeDB는 범용 desktop database client, text-to-SQL 제품, 상시 실행 범용 MCP
server가 아닙니다. 앱은 AI provider token을 읽거나 갱신하지 않고 AI provider API를
직접 호출하지 않습니다. Agent traffic은 공식 CLI binary와 사용자의 기존 로컬 로그인을
통해서만 이동합니다.

제품은 하나의 DB 접근 경로를 안전하게 공유하고 하나의 Agent grant를 관찰·승인·중단·
복구할 수 있게 만드는 데 집중합니다. 공개 claim 경계와 아직 남은 roadmap 범위는
[제품 방향 정본](./docs/PRODUCT_POSITIONING.md)에서 확인할 수 있습니다.

## 공식 AI CLI에서 사용하기

CLI와 승인된 Agent 세션에서의 스키마 비교는 [CLI 스키마 Diff 안내](docs/contracts/cli-schema-diff.md)를 참고하세요.

Desktop 설정에서 앱과 버전이 같은 `dopedb` 명령을 설치하고, Project 루트에서
한 번 실행합니다.

```sh
dopedb agent init --provider codex # Claude는 --provider claude
```

Desktop 승인 화면에서 DB, BigQuery 리소스, 소스 저장소와 선택적인 쓰기 대상 DB
하나를 고릅니다. 생성되는 `.dopedb/agent.json`에는 식별자만 들어갑니다.
DB 비밀번호나 AI 공급자 인증정보 없이 검토하고 저장소에 커밋할 수 있습니다.
[영문 README의 구성 예시](./README.md#use-dopedb-from-an-official-ai-cli)도 참고하세요.

```sh
dopedb agent start
```

공식 CLI에 추가 인수를 전달하려면 `--` 뒤에 붙입니다.
시작할 때마다 Desktop에서 현재 리소스 범위를 확인합니다. 권한은 실행한 CLI의
프로세스에만 연결되며 CLI가 종료되면 회수됩니다. 범위를 바꾸려면 기존 구성 파일을
명시적으로 제거하고 `agent init`의 Desktop 검토를 다시 진행합니다.

## Alpha 다운로드

| 플랫폼 | 다운로드 |
| --- | --- |
| macOS · Apple Silicon | [`.dmg` 다운로드](https://github.com/json-choi/dopedb/releases/latest/download/DopeDB-macos-arm64.dmg) |
| macOS · Intel | [`.dmg` 다운로드](https://github.com/json-choi/dopedb/releases/latest/download/DopeDB-macos-x64.dmg) |
| Windows · x64 | [설치 파일 다운로드](https://github.com/json-choi/dopedb/releases/latest/download/DopeDB-windows-x64-setup.exe) |

DopeDB는 현재 alpha입니다. 중요한 데이터베이스에 사용하기 전에
[최신 릴리스](https://github.com/json-choi/dopedb/releases/latest)를 확인하세요.

현재 macOS 정식 배포본은 Developer ID 서명과 Apple 공증을 거칩니다.
Windows 설치 파일은 아직 코드 서명 전이어서 SmartScreen 경고가 표시될 수 있습니다.
위의 공식 릴리스 링크에서 다운로드하세요.

## 소스에서 실행하기

필요한 도구: Rust stable 1.94 이상, Node.js 24, pnpm 11.25.0, macOS 빌드용
Xcode Command Line Tools.

```sh
pnpm install
pnpm tauri dev
```

개발 앱은 별도의 `DopeDB Dev` 이름과 `dev.dopedb.desktop.dev` identifier를
사용하므로 설치된 운영판이나 운영판의 Local Broker runtime을 가로채지 않습니다.

주요 검증 명령:

```sh
pnpm build
pnpm test
pnpm test:rust
pnpm site:build
```

[프로젝트 가이드](./docs/PROJECT.md)에서 아키텍처, sidecar, Agent session, 안전 동작,
릴리스 경계를 자세히 확인할 수 있습니다.

## 프로젝트 둘러보기

| 시작점 | 내용 |
| --- | --- |
| [프로젝트 가이드](./docs/PROJECT.md) | 아키텍처, 개발, Agent session, 안전, 배포 |
| [제품 포지셔닝](./docs/PRODUCT_POSITIONING.md) | 사용자, 약속, 차별점, 공개 claim 경계 |
| [Workspace roadmap](./docs/WORKSPACE_ROADMAP.md) | 구현된 기반과 alpha에 남은 작업 |
| [UI 범위](./docs/PRODUCT_UI_SCOPE.md) | 기능과 interaction의 정본 결정 |
| [기여 가이드](./CONTRIBUTING.md) | 협업, 검증, branch, pull request |

## 기여하기

기여와 근거가 있는 피드백을 환영합니다. 코드를 변경하기 전에
[CONTRIBUTING.md](./CONTRIBUTING.md)를 읽고, 새로운 제품 surface를 제안하기 전에
[제품 방향](./docs/PRODUCT_POSITIONING.md)을 확인해 주세요.

## 라이선스

DopeDB는 [MIT License](./LICENSE)로 제공됩니다.
