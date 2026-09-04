# Packaged release performance baseline

Issue #124의 제품 성능 판정은 개발 서버나 Rust debug binary가 아니라 별도 app
identity로 빌드한 최적화된 `DopeDB Benchmark` bundle에서만 수행한다. 이 하네스는
사용자의 DopeDB data directory, keychain, CLI login, provider 계정 또는 실제 DB를
열지 않는다.

## 기준 실행

macOS와 Windows에서 다음 명령을 각각 실행한다.

```bash
pnpm install --frozen-lockfile
pnpm benchmark:packaged-release
```

기본값은 startup의 각 cold/warm 상태를 5회, 각 workload를 3회 측정하며 fixture마다
1회의 warm-up을 먼저 버린다. 로컬 진단 중에는 다음처럼 횟수를 줄일 수 있지만 이
결과는 baseline이나 회귀 판정에 사용하지 않는다.

```bash
pnpm benchmark:packaged-release -- --samples 1 --workload-samples 1
```

한 workload의 실행 오류를 좁힐 때만 `--only query-result`처럼 닫힌 scenario 이름을
지정할 수 있다. 선택 실행 artifact는 `methodology.diagnosticSelection`이 채워지며
전체 baseline으로 취급하지 않는다. `--output`을 따로 지정하지 않은 선택 실행은
tracked baseline을 덮어쓰지 않고 gitignored
`src-tauri/benchmarks/packaged-release-<scenario>-diagnostic.json`에 기록된다.

수동 GitHub workflow도 `scenario=all`만 전체 baseline으로 취급한다. 특정 회귀만
재검증할 때는 같은 패키지·계측 경계를 유지한 채 하나의 scenario를 골라 diagnostic
artifact를 만들 수 있다.

기본 artifact는
`src-tauri/benchmarks/packaged-release-summary.json`에 생성된다. 플랫폼별 파일을
직접 만들려면 repository 내부 경로만 지정할 수 있다.

```bash
pnpm benchmark:packaged-release -- --output src-tauri/benchmarks/packaged-release-macos-arm64.json
```

하네스는 macOS에서 `.app`, Windows에서 NSIS release bundle을 만든 뒤 최적화된
실행 파일을 직접 시작한다. `--skip-build`는 같은 source와 bundle을 반복 진단할
때만 사용한다. commit 기준 artifact에는 사용하지 않는다.

## 고정 fixture와 측정 구간

| 시나리오 | 시작 상태와 규모 | 측정 동작 |
| --- | --- | --- |
| Startup | 0/5/20 SQLite 연결, 중단된 ACP/job/operation이 없는 fixture와 20개 연결 recovery fixture | 새 fixture clone의 cold open, 같은 clone의 warm reopen, process start → Store → window → first shell commit → post-paint recovery |
| SQL editor | 정확히 10 KiB/100 KiB/1 MiB 문서 | 입력, cursor 이동, format, run → 두 번째 animation frame |
| Explorer/Search | 20 connections, 50 databases, 5,000 objects | renderer process당 실제 첫/두 번째 expand 1회, Action Search → 두 번째 frame; 반복 collapse GC는 first-use 수치에서 제외 |
| Query result | 256행 first batch, 50,000행 grid, production disk store의 1,000,000행 | first batch, scroll, page-store, 진행 중 CSV export 취소와 partial 정리, 전체 CSV export |
| Table first row | 실제 connection profile이 가리키는 36-column production SQLite table의 기본 100행 + look-ahead page | 빈 grid에서 첫 process cold page와 이어지는 warm page를 각각 `run_sql_read_page_stream`으로 실행 → 첫 grid paint p50/p95와 operation/pool/backend/IPC/commit 단계 |
| Agent | 10분 timestamp 범위의 10,000 ACP event | stream projection과 64-event SQLite batch persistence, manual scroll, permission pending, reconnect |
| Agent tools | 격리된 clean HOME, Codex·Claude Code 두 Skill target | exact inventory fingerprint로 동시 설치, manager 재생성 뒤 revision·digest 재검사, 동시 제거 |
| Long-lived data | history 10,000, audit 100,000, 1 MiB revision 50개, 로컬 Analysis Article 복구 결과 8개 | production SQLite의 bounded page/detail 경로 |
| Interactions | 1,000-node ERD, 50,000행 grid, Services pane, 긴 Workbench document | drag, column resize, Services/main resize → 두 번째 frame, resize 뒤 grid/document scroll과 마지막 action focus 보존 |
| Idle | workload 화면을 10초간 그대로 유지 | IPC 호출 수를 분당 값으로 정규화 |

Cold는 현재 MVP schema로 sealed한 fixture를 새 process가 처음 여는 상태다. Warm은 그
process가 정상 종료한 같은 clone을 새 process가 다시 여는 상태다. 두 상태 모두
OS file cache 자체를 강제로 비우지는 않으므로 hardware와 OS가 다른 artifact끼리
절대 수치를 직접 비교하지 않는다.

## 기록되는 지표

- startup stage와 first-shell p50/p95
- action → 두 번째 paint p50/p95
- table page의 operation claim → pool connect start/ready → backend execute/first row → IPC batch → React commit
- React commit 수/시간, frame gap과 50 ms 초과 frame 수
- IPC 호출/시간/payload, SQLite transaction, retained result/cache bytes
- process tree RSS와 WebView가 제공할 때만 JS heap
- Long Tasks API가 제공될 때만 long-task 수/최대 시간

WebKit처럼 Long Tasks API 또는 heap API를 제공하지 않는 환경은 `0`으로 합격시키지
않고 `unsupported`로 기록한다. 이때 frame-gap budget은 계속 판정하지만 해당
artifact의 전체 상태는 `incomplete`다.

Global frame gap에는 OS가 native page-store/export 중 정지시킨 WebView frame도
그대로 남긴다. dropped-frame 예산은 입력, format, first batch, scroll, Agent
projection, drag와 resize처럼 paint를 요구하는 action 구간 및 startup에만 적용한다.
비시각 native 작업 중 frame이 없던 시간을 UI main-thread stall로 바꾸어 주장하지
않는다.

예산의 정본은
`src-tauri/benchmarks/packaged-release-budgets.json`이다. 공통 직접 상호작용은
p95 100 ms, main-thread long task는 50 ms, startup first shell은 p95 2.5초,
idle IPC는 분당 30회, process-tree RSS와 WebView heap은 각각 512 MiB가 상한이다.
formatter, 100만 행 page-store/export, 10,000 event projection처럼 의도적으로
긴 동작은 같은 파일의 action별 명시 예산을 사용한다.

## Artifact와 회귀 판정

Artifact에는 commit, app version, dirty 여부, OS/release/architecture/CPU,
Node와 WebView engine/version, fixture 정의, 개별 numeric sample, 집계와 예산 판정이
포함된다. 기준 artifact는 다음 조건을 모두 만족해야 한다.

1. clean commit에서 기본 sample 수로 실행한다.
2. macOS와 Windows artifact를 모두 보관한다.
3. 비교 전후의 OS, architecture, hardware class와 WebView major version를 맞춘다.
4. `failed` 예산과 누락된 action은 회귀로 처리한다. `unsupported`는 합격이 아니라
   별도 계측이 필요한 상태다.
5. 세부 성능 이슈의 before/after artifact를 같은 명령과 fixture로 만들고 링크한다.

`.github/workflows/packaged-performance.yml`은 GitHub Actions의 **Run workflow**로
원할 때만 수동 실행한다. push, pull request, schedule, release 또는 다른 workflow의
호출로는 시작하지 않으며 필수 CI·릴리스 체크가 아니다. 수동 실행하면 macOS arm64와
Windows x64 artifact를 각각 생성해 workflow artifact로 30일 보관한다. 이 workflow는
서명·배포·updater 채널을 건드리지 않는다.

## 개인정보 경계

결과 JSON은 닫힌 stage/action 이름, 숫자, 버전만 허용한다. SQL 본문, result row,
파일 경로, credential, provider token, Agent prompt/transcript, workspace secret과
원시 stdout/stderr는 artifact에 넣지 않는다. fixture는 OS temp 아래
`dopedb-packaged-benchmark-*` root에서만 열 수 있고, feature build는 그 밖의
경로를 fail-closed로 거부한다. 측정 종료 뒤 runner가 자신이 만든 temp root만
삭제한다.
