# ADR 0002: Local Broker protocol

- 상태: 승인
- 날짜: 2026-07-24
- 관련 계획: Phase 3

## 결정

`dopedb` CLI는 app SQLite, credential store, provider SDK, DB driver를 열지 않는다.
실행 중인 DopeDB Desktop Runtime과 사용자 로컬 IPC로만 통신한다.

- macOS/Linux: 사용자 전용 runtime directory의 Unix domain socket
- Windows: random runtime id를 포함하고 현재 사용자 SID만 허용하는 named pipe
- loopback HTTP/TCP: 사용하지 않음
- control message: 4-byte big-endian 길이 + UTF-8 JSON
- Terminal bytes, result stream, import/export bytes: control channel과 분리

공유 정본은 database/Tauri 의존성이 없는 `dopedb-protocol` crate다.

## Discovery

Desktop은 현재 사용자만 읽을 수 있는 `runtime.json`을 atomic replace로 기록한다.

```json
{
  "schemaVersion": 1,
  "runtimeId": "uuid",
  "pid": 1234,
  "appVersion": "<app-version>",
  "protocolMin": 1,
  "protocolMax": 1,
  "endpoint": "platform-specific endpoint",
  "startedAt": "RFC3339"
}
```

파일에는 reusable token, DB 정보, workspace 정보가 없다. PID와 runtime id가 stale이면
CLI는 파일을 신뢰하지 않고 `runtime_unavailable`로 종료한다.

## Envelope와 version

- `protocolVersion`: framing/envelope 의미
- `commandSchemaVersion`: command arguments/result 의미
- `requestId`: 응답 correlation용 UUID
- `authentication`: terminal session id와 선택적 ephemeral bearer capability
- `command`: v1의 closed command enum
- `arguments`: Phase 0 envelope에서는 구조 한도를 적용한 JSON value

지원 범위가 겹치면 가장 높은 protocol version을 선택한다. 겹치지 않으면
`protocol_mismatch`로 실패하고 app/CLI 버전 정보를 설명한다.

Broker를 활성화하기 전에는 지원하는 각 command의 arguments/result를
deny-unknown typed payload로 다시 decode해야 한다. Phase 0의 closed enum은 명령
이름과 envelope만 고정하며, 아직 연결되지 않은 command의 payload 완료를 의미하지
않는다.

## 한도

| 항목 | v1 한도 |
| --- | ---: |
| request frame | 1 MiB |
| response frame | 8 MiB |
| JSON depth | 32 |
| one collection's items | 10,000 |
| total JSON values (root 포함) | 10,000 |
| string | 256 KiB |

semantic query row/cell/byte cap은 이보다 더 작을 수 있다. 한도를 넘긴 요청은 읽기나
실행 전에 거절한다. secret은 stdout/stderr/Debug/log/error details에 넣지 않는다.
wire error message는 code별 고정된 안전 문구만 사용하고 raw DB/provider 오류는 내부
redacted telemetry에만 남긴다.

## 호환성

- field 제거, 이름 변경, 의미 변경은 protocol major 없이 하지 않는다.
- v1 envelope/DTO는 unknown field를 거절한다. optional field나 command를 추가할
  때도 `commandSchemaVersion`을 올리고 호환 범위를 명시한다.
- Phase 0은 envelope와 대표 query/status/error fixture를 고정한다.
- 실제 broker에서 command를 활성화하기 전 해당 command의
  request/success/error golden fixture를 모두 추가한다.
- CLI human renderer와 JSON serializer는 분리한다.

## ACP process-bound authentication

일반 Terminal 요청은 terminal session id와 ephemeral bearer를 함께 보낸다. ACP
Agent의 stdio MCP 설정에는 bearer나 다른 credential을 넣지 않는다. 공개
`dopedb` CLI도 ACP 실행 경로에 넣지 않는다. 대신 정확한 app-only Agent bridge의
launcher mode가 내부 `agent.session.register` 명령으로 자신의 OS PID와 process
start marker를 bearer 인증해 한 번 등록한다. 등록 payload는 `claude`/`codex` closed
enum, Desktop이 선택한 launcher 호출 absolute path, canonical resolved target,
target SHA-256만 받는다. 호출 path는 Volta 같은 shim의 `npx` dispatch를 보존하고,
resolved target과 digest는 symlink 교체를 거부한다. npm
package와 version은 command schema가 소유하는 고정 mapping이며 caller가 package나
추가 argument를 보낼 수 없다. Desktop은 session 발급 때 같은 descriptor를 Broker에
먼저 고정하고 bridge는 launcher를 등록 전과 실행 직전에 다시 hash 검증한다.

ACP bootstrap bearer는 일반 Terminal bearer와 달리 등록 전용이다. 다른 command를
인증할 수 없으며 정확한 descriptor와 peer PID/start marker가 일치하는 첫 등록에서
Broker가 token allocation을 원자적으로 zeroize하고 process-bound 상태로 바꾼다.
bridge는 시작 직후 환경의 bearer를 zeroizing allocation으로 옮기고 원래 환경 값을
덮어쓴 뒤 제거하며, token을 포함한 wire frame도 전송 후 zeroize한다. Unix는 bearer가
제거된 환경으로 bridge를 공식 adapter로 `exec`한다. Windows는 ancestry root를
유지하려고 child 종료까지 기다리지만 등록 완료 뒤 환경·일반 heap에는 유효 bearer가
없고 adapter child에도 전달하지 않는다.

이후 같은 bridge의 typed MCP mode는 public CLI parser나 subprocess 없이
`BrokerClient`로 protocol `CommandSpec`을 직접 보내며 terminal session id만
인증 metadata로 사용한다. Broker는 owner-local IPC가
보고한 peer PID와 start marker가 살아 있는지 확인하고, 등록된 adapter root와
동일하거나 실제 descendant인 경우에만 session capability를 적용한다. 등록되지 않은
process, 재등록, unrelated process, PID 재사용, 만료·취소·authority 변경 session은 같은
`authentication_denied` 경계에서 거부한다. process identity는 discovery나 SQLite에
저장하지 않고 해당 Desktop runtime의 메모리에만 둔다.

## External official Agent process-bound authentication

Desktop 밖의 AI 사용은 별도 상시 MCP server나 bearer 배포가 아니라 공개 CLI의
`dopedb agent init/start`로 연다. `agent init`은 canonical working directory와
provider closed enum만 unauthenticated owner-local Broker에 보내고, Desktop에서
고른 한 Project의 connection/source UUID와 선택적인 단일 write connection UUID만
`.dopedb/agent.json`에 저장한다. 이 파일에는 connection URL, credential, provider
token, Broker endpoint, session id나 capability가 없다.

`agent start`는 config 전체와 canonical working directory를 다시 보내고 Desktop이
현재 resource 이름·revision·읽기/쓰기 범위를 보여준 뒤 명시적으로 승인한다.
Broker는 hosted authority를 다시 동기화하고 각 resource를 현재 revision으로
narrowing한 뒤 요청한 public CLI peer PID/start marker에 직접 `AgentProcess`
authority를 묶는다. 응답에는 session id와 expiry만 있고 bearer는 생성하지 않는다.

public CLI는 사용자의 공식 `codex` 또는 `claude`를 child로 시작하면서 현재 CLI
자신의 `agent mcp`를 ephemeral stdio server로 주입한다. child tree에는 runtime file,
session id, `DOPEDB_AGENT_PROCESS_BOUND=1`만 전달하고 상속된
`DOPEDB_SESSION_TOKEN`은 제거한다. Broker는 요청 CLI와 동일하거나 실제 descendant인
peer에만 exact Project resource capability를 적용한다. provider가 종료되면 parent
CLI가 process-bound revoke를 보내며, parent가 비정상 종료되어도 ancestry 검증이
fail closed하고 runtime TTL·Desktop shutdown이 잔여 record를 정리한다.

이 경로는 공식 AI CLI의 기존 로컬 로그인만 사용한다. DopeDB는 provider token을
읽거나 `api.anthropic.com`/OpenAI backend를 직접 호출하지 않으며 config를 일반 MCP
설정으로 설치하지 않는다.

## Bounded Agent tools and cancellation

Agent의 catalog 검색은 `catalog.show` 응답을 bridge로 옮긴 뒤 필터링하지 않는다.
Desktop runtime이 canonical snapshot을 검색하고 최대 50개의 compact object
reference와 일치 field, 160자 이하의 comment 미리보기, planner 행 수 추정치만
`catalog.search`로 반환한다. 관련도가 같으면 행 수 추정치가 큰 relation을 먼저 둔다.
따라서 relation/column 수가 많아도 검색 응답이 Broker frame 한도를 넘지 않는다.

Agent tool 결과는 이후 모든 turn에서 다시 읽히므로 bridge는 대화 크기에 맞춘
projection을 반환한다. `query_read`는 Broker가 표시한 경우에만 plan 진단을 싣고
최대 `previewRows`개 행만 대화에 넣는다. 한 호출에 최대 5개의 독립 read를 묶을 수
있지만 각 read는 자기 plan, single-use run, timeout, receipt를 유지하고 첫 실패에서
batch를 멈춘다. `table_describe`는 최대 10개 relation을 한 번에 기술한다.

stdio MCP는 database tool을 한 번에 하나만 실행하되 stdin reader를 분리해 실행
중에도 `notifications/cancelled`를 수신한다. 아직 대기 중인 tool은 queue에서
제거하고, 실행 중인 tool future는 중단한다. `query_read`가 이미 plan을 발급받은
경우에는 동일 operation id로 `query.cancel`을 Broker에 보내 실제 executor까지
취소를 전파한다. 취소된 JSON-RPC request에는 adapter가 response handler를 이미
폐기했으므로 별도 response를 쓰지 않는다.
