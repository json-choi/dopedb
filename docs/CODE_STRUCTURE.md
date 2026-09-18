# AI와 사람이 함께 탐색하기 쉬운 코드 구조

이 문서는 파일 줄 수가 아니라 **응집도, 책임 경계, 탐색 왕복 비용**으로 코드
구조를 판단하는 저장소 기준이다. 목표는 파일을 작게 만드는 것이 아니라 한 번의
검색으로 개념의 진입점, 상태 소유자, 효과 경계, 검증 계약을 재구성할 수 있게 하는
것이다.

## 기본 결정

- 300줄은 실패 기준이 아니라 응집도 검토가 시작되는 지점이다.
- 수작업 제품 코드가 800줄을 넘으면 분리 또는 유지 근거를 적극적으로 검토한다.
- 생성 코드, 선언적 schema/catalog, migration, fixture, 긴 계약 테스트는 서로 다른
  임계값으로 관찰한다.
- 줄 수를 맞추기 위한 `helpers`, `utils`, `part1`, `part2` 파일은 만들지 않는다.
- 기존 파일을 나눴다는 이유만으로 완료로 보지 않는다. 분리 후 공개 진입점과 상태
  writer가 더 명확하고, 한 작업을 이해하기 위한 파일 왕복이 줄어야 한다.
- 반대로 여러 작은 파일이 하나의 변경 이유와 한 소비자만 가지며 서로 계속
  import한다면 같은 책임 경계로 다시 합칠 수 있다.

## 분리 판단

다음 중 하나 이상이 명확할 때 책임 이름으로 분리한다.

1. 독립적으로 변경되는 이유가 둘 이상이다.
2. presentation, state/application, transport, persistence, policy가 한 파일에서
   각각 독립된 흐름을 가진다.
3. 변경 가능한 상태의 writer 또는 비동기 lifecycle이 둘 이상이다.
4. 독립적으로 이름 붙이고 입력·출력 계약을 검증할 수 있는 단위가 있다.
5. 파일의 주 산출물을 찾기 전에 긴 구현 세부나 정적 catalogue를 지나야 한다.

권장 형태는 기능별 composition root와 명시적인 하위 책임이다.

```text
feature/
  FeaturePanel.tsx          # 조합과 공개 진입점
  useFeatureController.ts   # 상태와 command lifecycle
  FeatureForm.tsx           # presentation leaf
  domain.ts                 # 순수 계약과 정책
  tauriAdapter.ts           # IPC 경계
```

모든 기능이 위 파일을 전부 가져야 하는 것은 아니다. 한 책임이 짧고 독립성이 없다면
진입점 안에 그대로 둔다.

## DopeDB 저장소 경계

같은 이름의 책임은 플랫폼이 달라도 같은 의존 방향을 따른다. 디렉터리는 파일을
분산시키는 분류함이 아니라 **상태와 효과의 소유권**을 드러내는 경계다.

### Desktop React

- `src/screens/`는 route/tool-window 조합 leaf다. 기능 상태, TanStack Query 계약,
  Tauri command lifecycle을 새로 소유하지 않는다.
- `src/features/<domain>/`은 controller, query key/options, domain policy, adapter를
  소유한다. 화면 여러 곳에서 쓰인다는 이유로 `src/lib/`로 올리지 않는다.
- `src/components/`와 `src/design-system/`은 제품 기능 adapter나 feature state를
  import하지 않는 표현 계층이다.
- 한 화면이 여러 기능을 조합하면 화면 전용 controller를 억지로 `lib`에 두지 않고,
  가장 좁은 조합 기능(예: `features/settings/agentTools`)을 이름 붙인다.

### Workspace Cloud

- `workspace-cloud/features/<domain>/`은 use case와 정책의 공개 진입점이다.
- `workspace-cloud/lib/`에는 인증, HTTP, DB, 암호화처럼 실제로 여러 기능이 공유하는
  기반만 둔다. 특정 provider나 Knowledge/Analysis 흐름 하나만 소유하면 해당 feature로
  이동한다.
- route는 입력 검증, 권한 확인, feature command 호출, 응답 변환만 조합한다. provider
  API lifecycle이나 persistence transaction을 route에서 구현하지 않는다.

### Rust Desktop와 CLI

- `features/<domain>/application`은 use case 순서를, `domain`은 순수 계약과 정책을,
  `ports`는 외부 요구 계약을, `adapters`는 DB/HTTP/process 구현을 소유한다.
- `commands`와 `services`는 조합 경계다. SQL 실행, credential 정책, process lifecycle의
  세부 구현을 다시 소유하지 않는다.
- `connection`, `executor`, `store`, `broker` 같은 platform 디렉터리는 여러 feature가
  의존하는 실제 platform capability일 때 유지한다. 특정 feature만 소비하면 feature
  내부로 내린다.
- CLI도 같은 domain/application/adapter 방향을 따르며, Desktop 구현 파일을 단순히
  복제해 별도 정책 writer를 만들지 않는다.

## 완료 계약

저장소 전체 구조 작업은 다음을 모두 만족해야 완료다.

1. audit의 모든 high-risk 모듈을 직접 검토하고, 혼합 책임은 이름 있는 경계로
   분리한다.
2. 분리하지 않는 800줄 이상 수작업 모듈은 한 state writer, 한 effect lifecycle,
   또는 선언적 catalogue라는 유지 근거가 있어야 한다.
3. baseline에서 해소된 항목을 제거하고 새 high-risk 또는 fragment cluster가 0인지
   `pnpm check:code-structure`로 확인한다.
4. TS/TSX, Rust, Cloud, CLI 각각의 build/test/lint를 변경 범위에 맞게 실행한다.
5. Graphify를 갱신한 뒤 공개 진입점과 의존 방향을 다시 질의해 실제 탐색 경로가
   짧아졌는지 확인한다.

## 재결합 판단

다음 조건이 함께 나타나면 과도하게 흩어진 구조인지 검토한다.

- 작은 sibling 파일 여러 개가 거의 같은 파일에서만 소비된다.
- 파일 사이 내부 import가 많고 외부 소비자는 하나 또는 둘뿐이다.
- 각 파일이 독립된 public contract, state owner, adapter boundary를 갖지 않는다.
- 변경 하나가 항상 같은 파일 묶음을 함께 수정하게 만든다.
- 파일 이름이 책임보다 구현 순서나 포괄적 보조 역할을 나타낸다.

`domain`, `ports`, `types`, `errors`, `contracts`처럼 의존 방향이나 공개 계약을
고정하는 작은 파일은 단순히 짧다는 이유로 합치지 않는다. 재결합 후에도 dependency
cycle이 없어야 하고, 더 넓은 범용 `utils`가 생겨서는 안 된다.

## 실행 하네스

전체 스캔은 다음 명령으로 실행한다.

```bash
pnpm audit:code-structure
pnpm audit:code-structure -- --all
pnpm check:code-structure
```

`audit`은 저장소의 TS, TSX, JS, Rust, Python, shell, CSS를 전수 스캔하고 다음을
분리해 보고한다.

- category별 줄 수 임계값
- top-level declaration과 import fan-out
- presentation/state/transport/persistence/policy/process 책임 신호
- 강하게 결합된 작은 sibling module 군집

결과는 **검토 후보**다. scanner 점수만으로 파일을 이동하지 않는다.
`check`는
[`docs/architecture/code-structure-baseline.json`](architecture/code-structure-baseline.json)의
현재 high-confidence hotspot과 fragment cluster를 ratchet으로 사용한다. 새 hotspot,
기존 위험 증가, 이미 개선된 항목을 계속 baseline에 남기는 일을 실패시킨다.

baseline은 다음 경우에만 갱신한다.

1. audit 결과와 실제 책임 경계를 사람이 함께 검토했다.
2. 새 hotspot을 허용하기 위해서가 아니라 기존 hotspot이 줄거나 정당한 분류가
   교정되었다.
3. 변경 전후 `pnpm check:code-structure`와 해당 build/test가 통과한다.

`--print-baseline`은 검토용 후보를 stdout에 출력한다. 결과를 자동으로 덮어쓰지
않는 이유는 구조 회귀를 수치 갱신으로 숨기지 않기 위해서다.

## 역할 주석

파일을 열었을 때 첫 줄이 책임을 알려주면 탐색 왕복이 줄어든다. 45줄이 넘는
TS/TSX 파일은 import 앞에 그 파일이 소유한 상태, 입출력, 책임 경계를 1~3줄로
적는다. 파일명을 반복하거나 "이 파일은 X 컴포넌트를 담는다" 수준의 문장은
탐색에 아무것도 보태지 않으므로 쓰지 않는다.

`pnpm check:role-comments`는 **형식 누락만** 탐지한다. 첫 줄이 어떤 주석이든
있으면 통과하며, 그 주석이 실제 책임을 정확히 설명하는지는 자동화하지 않고
코드 리뷰가 소유한다. 문구를 점수화하는 scanner는 이 규칙이 막으려는 boilerplate를
오히려 통과시키기 때문이다.

Rust는 다른 규칙이다. 모든 모듈이 줄 수와 무관하게 파일 상단에 `//!` 모듈
설명을 둔다. 이 검사기는 Rust를 읽지 않는다.

검사에서 빠지는 경우는 아래가 전부다.

| id | 처리 | 범위 |
| --- | --- | --- |
| `size` | 제외 | 45줄 이하 |
| `declaration` | 제외 | `*.d.ts` |
| `test` | 제외 | `*.test.*`, `*.spec.*`, `*.harness.*`, `__tests__/` |
| `generated` | 제외 | `gen/`·`generated/` 경로 또는 `@generated` marker |
| `directive` | 선행 허용 | `"use client"` 같은 directive prologue 뒤의 주석도 통과 |

예외를 넓혀 누락을 숨기지 못하도록 검사기가 스스로를 검사한다. 예외 id 목록은
고정되어 있어 항목을 추가하면 이 표와 함께 고치기 전까지 실패하고, 규칙이
`src`의 수작업 파일 중 60% 미만에만 닿으면 실패하며, `generated` 예외에 기대는
파일이 늘어도 실패한다. `node scripts/check-role-comments.mjs --self-test`는
누락 탐지·정상 통과·각 예외를 메모리 fixture로 확인한다.
`pnpm build`가 self-test와 저장소 검사를 모두 실행하므로 CI build에서도 강제된다.

`src`는 누락 0을 유지한다. `workspace-cloud`와 `site`는 아직 남은 수를 상한으로
고정해 늘어나지 못하게만 하며, 파일을 채우면 상한을 같은 변경에서 내린다.

## 변경 검증

구조 변경은 동작 변경과 같은 수준으로 검증한다.

- TypeScript/TSX: `pnpm lint:hooks`, `pnpm build`, 관련 smoke test
- Rust: `cargo fmt --all -- --check`, 관련 package test 또는 `pnpm test:rust`
- UI projection: 기존 화면의 command, 접근성 이름, focus, responsive 상태 수동 확인
- 모든 코드 변경: `pnpm check:code-structure`, `pnpm check:role-comments`,
  `graphify update .`

파일 수 감소나 평균 줄 수 감소는 완료 증거가 아니다. 공개 API, dependency 방향,
single-writer 상태, 테스트 결과가 유지되고 탐색 경로가 짧아졌을 때 완료다.
