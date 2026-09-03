# ADR 0001: Operation Runtime 상태와 exact 승인

- 상태: 승인
- 날짜: 2026-07-24
- 현재 제품 경계: `docs/PRODUCT_POSITIONING.md`, `docs/PRODUCT_UI_SCOPE.md`

## 결정

UI, Local Broker, Agent CLI, Plugin은 DB를 직접 실행하지 않는다. 모든 실행은
하나의 Operation Runtime을 통과한다. 저장되는 첫 상태는 `planned`이며 frontend의
편집 중 draft는 저장하지 않는다.

| 현재 상태 | 허용되는 다음 상태 |
| --- | --- |
| `planned` | `pending_approval`, `ready`, `cancelled`, `expired` |
| `pending_approval` | `approved`, `rejected`, `cancelled`, `expired` |
| `ready` | `executing`, `cancelled`, `expired` |
| `approved` | `executing`, `cancelled`, `expired` |
| `executing` | `succeeded`, `failed`, `cancelled`, `outcome_unknown` |
| terminal state | 없음 |

정본 검사는 `src-tauri/src/operations/state_machine.rs`가 수행한다. adapter가 원하는
상태를 직접 저장하지 않는다.

## Exact approval

승인은 다음 조합에 고정한다.

```text
workspace + account scope + connection + connection revision
+ actor + terminal session + operation kind
+ payload schema version + canonical payload SHA-256
+ policy revision/snapshot + expiry
```

- 승인 API는 operation id와 사용자가 본 payload hash만 받는다.
- 실행 API는 SQL, connection, `approved: bool`을 다시 받지 않는다.
- Runtime은 저장된 immutable payload를 읽고 실행 직전에 현재 권한과 정책을 다시
  검사한다.
- 사용자가 SQL 편집기에서 작성한 payload는 Run 동작을 exact 승인 의사로 사용해
  같은 화면에서 다시 SQL을 복제하거나 확인 문구를 입력시키지 않는다. 이 경우도
  Runtime의 immutable payload hash와 현재 policy 재검사를 생략하지 않는다.
- Agent, Job, background 작업이 제안한 mutation은 작성 주체가 사람이 아니므로
  별도의 단일 승인·거절 동작을 유지한다. 위험 문구 재입력은 승인 권한이 아니며
  사용하지 않는다.
- Agent, CLI, Plugin은 승인할 수 없다.
- compare-and-swap으로 `ready|approved → executing`을 원자적으로 claim한다.

## Crash와 취소

target DB commit과 local receipt는 하나의 transaction이 아니다. `executing`인 mutation을
앱 시작 시 발견하면 자동 재시도하지 않고 `outcome_unknown`으로 전환한다.

- target rollback/중단이 확인됨: `cancelled`
- 실행 전에 실패함: `failed`
- commit 여부를 확인할 수 없음: `outcome_unknown`

`outcome_unknown`은 terminal state이며 사용자가 target 상태를 확인한 뒤 별도 reconcile
operation을 만든다.

## 결과

- frontend boolean만으로 쓰기를 승인하는 경로는 제거되었으며 다시 만들지 않는다.
- 기존 `audit_log` chain 형식은 바꾸지 않는다. Operation lifecycle은 별도 hash-chained
  `operation_events` ledger에 기록한다.
- 상태 추가나 전이 변경은 이 ADR, protocol type, state-machine test를 함께 변경해야 한다.
