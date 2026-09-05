# ADR 0003: Terminal session과 capability

- 상태: 승인
- 날짜: 2026-07-24
- 최종 갱신: 2026-08-29
- 관련 계획: Phase 3~5

## 결정

일반 shell DB 명령은 DopeDB가 만든 인앱 Terminal session에서만 허용한다. session은
생성 시 workspace와 connection에 pin하며 Workbench connection이 바뀌어도
retarget하지 않는다. Desktop 밖의 공식 Codex/Claude는 별도 `dopedb agent
init/start` 흐름에서만 한 Project의 명시적인 resource set에 pin한다.

Runtime은 session마다 다음을 memory에만 보관한다.

- terminal session id
- runtime id
- account/workspace scope
- pinned connection id와 revision
- actor/Agent profile
- capability set
- 256-bit random opaque token
- expiry와 rotation

PTY child에는 필요한 값만 환경으로 전달한다.

```text
DOPEDB_RUNTIME_FILE
DOPEDB_TERMINAL_SESSION_ID
DOPEDB_CONNECTION_SCOPE
DOPEDB_SESSION_TOKEN
```

token은 DB credential이 아니다. argv, shell profile, runtime discovery, CLI JSON, audit,
terminal replay에 기록하지 않는다.

ACP Agent는 이 PTY token 수명 모델을 그대로 상속하지 않는다. Desktop이 app-only
bridge에 넣는 capability는 `agent.session.register` 한 번에만 쓸 수 있는 bootstrap
bearer다. Broker는 발급 시 `claude`/`codex` adapter enum과 launcher 호출 path,
canonical resolved target/target SHA-256을 고정하고, 정확한 peer PID/start marker가
그 descriptor로 등록되면
bearer를 즉시 zeroize해 process-bound authority로 교체한다. bridge는 등록 요청 전에
상속 환경을 덮어쓰고 제거하며 공식 adapter와 MCP 후손에는 session id만 전달한다.
따라서 Windows bridge가 process ancestry root로 계속 살아 있어도 재사용 가능한
bearer는 남지 않는다.

Desktop ACP launcher는 부모 프로세스의 환경을 그대로 복제하지 않는다. OS의
사용자 홈·실행 경로·임시 경로·locale·proxy/CA 설정과 정확한 DopeDB session의
식별자만 허용 목록으로 전달한다. 이전 터미널의 Agent hook 상태와 무관한 자격
정보는 공식 adapter에 전달하지 않으며, 공식 CLI의 로컬 로그인은 사용자 홈에서
그 CLI가 계속 소유한다.

외부 공식 Agent도 bearer를 받지 않는다. `.dopedb/agent.json`은 provider,
Project/resource UUID, 선택적인 단일 write target만 가진 secret-free config다.
`dopedb agent start` 때 Desktop이 그 exact set을 현재 revision과 권한으로 다시
보여주고 승인하면 Broker가 요청 CLI의 PID/start marker에 runtime-only authority를
직접 묶는다. CLI가 시작한 공식 provider와 session-scoped `agent mcp` descendant는
다음 값만 상속한다.

```text
DOPEDB_RUNTIME_FILE
DOPEDB_TERMINAL_SESSION_ID
DOPEDB_AGENT_PROCESS_BOUND=1
```

기존 `DOPEDB_SESSION_TOKEN`은 provider child에서 명시적으로 제거한다. session id
단독으로는 capability가 아니며 Broker가 owner-local peer ancestry와 exact resource
revision을 함께 확인한다.

## Revocation

다음 사건에서 DB command보다 먼저 즉시 revoke한다.

- Terminal 종료/restart
- workspace/account 전환
- membership/grant revoke
- connection update/delete
- provider lease rotation/expiry
- 외부 공식 Agent child 종료
- app 종료

이미 만들어진 plan은 runtime, owner session, workspace/account, connection revision을 모두
확인하므로 다른 Terminal에서 사용할 수 없다.

## 경계

이 capability는 같은 OS user 권한으로 실행되는 악성 process를 완전히 막는 sandbox라고
주장하지 않는다. 목적은 Agent 오작동, scope 혼선, 다른 Terminal의 plan 재사용을
차단하는 것이다.

외부 임의 shell에는 DB capability를 주지 않는다. 지원 범위는 Desktop이 config의
exact Project resource set을 매번 보여주고 승인한 뒤, `dopedb agent start`가 직접
실행한 공식 Codex/Claude process tree뿐이다. 저장된 범용 MCP endpoint나 재사용 가능한
token을 제공하지 않는다.
