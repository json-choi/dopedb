# Local Codex issue review

DopeDB의 이슈 자동 검토는 제품 서버에서 정적 키워드를 판정하는 기능이 아니다.
사용자 Mac에 있는 실제 `main` 코드와 최신 Graphify 그래프를 로컬 Codex가 읽고,
그 근거로 GitHub 이슈에 관리 댓글을 남기는 저장소 유지보수 도구다.

```text
GitHub Issues ──60초 pull──> local LaunchAgent
                              │
                              ├─ Graphify update + scoped query
                              ├─ local codex exec (read-only, tool-disabled)
                              └─ validated comment ──gh──> GitHub Issue
```

## 왜 Cloud webhook이 아닌가

GitHub webhook은 인터넷에서 접근 가능한 수신 서버가 필요하지만 사용자의 Mac은
항상 켜져 있는 공개 서버가 아니다. 이 공개 저장소에 Mac을 Actions self-hosted
runner로 연결하는 것도 외부 기여자의 입력과 workflow가 로컬 자격 증명에 닿을 수
있어 허용하지 않는다.

대신 로컬 worker가 GitHub Issues API를 60초마다 읽는다. 이슈와 댓글 자체가
durable queue이므로 별도 DB, GitHub App private key, webhook secret, Workspace cron이
필요 없다. Mac이 꺼져 있으면 아무 작업도 하지 않다가 다시 켜졌을 때 변경된
이슈를 처리한다. 60초보다 짧은 지연이 실제로 필요해질 때만 webhook은 이슈 번호를
보관하는 비권한 mailbox로 추가하며, 판정과 Codex 로그인은 계속 로컬에 둔다.

## 실행 경계

- immutable GitHub author ID가 `77596321` (`json-choi`) 또는 `231148561`
  (`jaesong-blip`)인 이슈만 후속 Agent 구현 후보가 된다.
- 다른 작성자의 이슈는 외부 제안이다. 로컬 Codex는 실제 코드와 제품 정본을
  대조해 댓글을 달 수 있지만 구현하거나 닫거나 실행 대기열에 넣지 않는다.
- 외부 제안을 채택하려면 위 두 계정 중 하나가 원본을 참조하는 새 이슈를 만든다.
  assignee, milestone, project priority, transfer, label은 작성자 경계를 바꾸지 않는다.
- 이 worker도 어느 이슈도 자동 구현하지 않는다. 점검과 단일 관리 댓글 갱신만
  수행한다.

## 한 이슈를 검토하는 과정

1. `main`이 clean이고 `origin/main`과 같은 commit인지 확인한다. 다르면 댓글을
   만들지 않고 다음 실행으로 미룬다.
2. 새 이슈 또는 제목·본문·사람 댓글이 바뀐 이슈만 선택한다. worker 자신의 marker
   댓글은 입력 digest에서 제외하므로 댓글 루프가 생기지 않는다.
3. `graphify update .`를 한 번 실행한다.
4. 첫 번째 `codex exec`가 Graphify의 실제 vocabulary에서 최대 12개 검색어만
   고른다. 임의의 검색어나 shell 문자열을 만들 수 없다.
5. `graphify query`가 관련 node와 source location을 좁힌다. worker는 Git이 추적하는
   저장소 내부 일반 파일만 읽어 line-numbered evidence를 만든다.
6. 두 번째 `codex exec`가 이슈, Graphify 결과, 코드 evidence,
   `AGENTS.md`, `docs/PRODUCT_POSITIONING.md`, 기능 범위 결정 표를 대조한다.
7. JSON Schema와 로컬 validator가 verdict, 길이, evidence ID를 검증한다.
8. worker가 안전한 Markdown으로 렌더링하고 `json-choi` 계정의 marker 댓글 하나를
   생성하거나 갱신한다.

## 불신 입력 방어

이슈 제목·본문·댓글은 모두 명령이 아닌 불신 데이터다.

- Codex는 사용자의 공식 로컬 로그인만 사용한다. worker는 인증 파일 내용을
  해석하지 않으며 API-key 환경 변수를 child에 전달하지 않는다.
- `--ignore-user-config`, `--ephemeral`, read-only sandbox를 사용하고
  `sandbox_permissions=[]`, restricted network, disabled web search를 명시해 managed
  또는 사용자 설정이 네트워크 도구나 승인 prefix를 되살리지 못하게 한다.
- 호출마다 권한 `0700`의 임시 `HOME`, `GH_CONFIG_DIR`, XDG 디렉터리를 발급해
  GitHub CLI 설정과 다른 사용자 파일을 child에서 분리한다. 원래 `CODEX_HOME`의
  regular file인 `auth.json`만 권한 `0600`으로 임시 `CODEX_HOME`에 복제한다.
  config, history, memory 등 다른 로컬 상태는 전달하지 않으며 호출이 끝나면 임시
  홈 전체를 삭제한다.
- shell, unified exec, code-mode host, MCP/app, browser, computer use, hooks, skill,
  multi-agent 기능을 명시적으로 비활성화한다.
- Codex child process에는 allowlist 환경 변수만 전달한다. `GH_TOKEN`,
  `GITHUB_TOKEN`, provider key, database URL 등은 전달하지 않는다.
- GitHub 쓰기 권한은 Codex 프로세스가 아니라 바깥 worker가 기존
  `pnpm gh:owner` 경계로 행사한다.
- Codex가 작성한 임의 Markdown을 그대로 게시하지 않는다. 허용된 JSON 필드를
  길이 제한·mention 중립화 후 worker가 렌더링한다.
- Codex가 인용할 수 있는 근거는 worker가 발급한 `E1`, `E2` 같은 ID뿐이다.

완전한 OS 격리가 필요한 경우에는 별도 macOS 사용자 계정에서 실행한다. Codex의
모델 생성 명령 도구는 꺼져 있지만, 로그인과 GitHub CLI가 유지보수 계정의 로컬
상태를 사용하기 때문이다.

## 설치

사전 조건은 다음과 같다.

- 현재 checkout이 `main`이고 `origin/main`과 동기화돼 있다.
- `gh`의 기본 활성 계정이 `jaesong-blip`이고 `json-choi`도 로그인돼 있다.
- `codex login status`가 성공한다.
- `graphify-out/graph.json`이 존재한다. 없다면 먼저 이 저장소에서 `/graphify`를
  실행해 그래프를 만든다.

처음 설치할 때 현재 열린 이슈들을 baseline으로 저장하므로 과거 이슈에 갑자기
댓글을 달지 않는다.

```bash
pnpm issue:review:install
pnpm issue:review:status
```

macOS LaunchAgent는 60초마다 one-shot worker를 실행한다. 상태와 로그에는 토큰이
저장되지 않는다.

- 상태: `~/Library/Application Support/DopeDB/issue-review/state.json`
- 로그: `~/Library/Application Support/DopeDB/issue-review/worker.log`
- 오류: `~/Library/Application Support/DopeDB/issue-review/worker.error.log`

## 수동 실행과 제거

특정 이슈의 댓글 초안을 GitHub에 쓰지 않고 확인한다.

```bash
pnpm issue:review:one -- 123 --dry-run
```

특정 이슈를 실제로 검토하거나 최근 이슈를 명시적으로 backfill한다.

```bash
pnpm issue:review:one -- 123
pnpm issue:review:backfill -- 5
```

자동 실행을 제거한다. plist는 복구할 수 있도록 상태 디렉터리로 이동한다.

```bash
pnpm issue:review:uninstall
```

## 실패와 재시도

- local `main`이 dirty/out-of-date이면 댓글 없이 미룬다.
- Graphify, Codex, GitHub 중 하나라도 실패하면 그 이슈의 완료 상태를 기록하지
  않으므로 다음 주기에 다시 시도한다.
- 한 실행은 최대 5개 이슈만 처리해 Codex 사용량과 실패 범위를 제한한다.
- worker가 쓴 댓글 때문에 `updated_at`이 바뀌어도 marker 댓글을 제외한 입력
  digest가 같으면 Codex를 다시 호출하지 않는다.
- 댓글·라벨·assignee는 구현 권한의 정본이 아니다. 실제 Agent도 작업 전 numeric
  author ID를 다시 확인한다.
