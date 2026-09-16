# 결정 근거 0002: `*.harness.*`를 208 critical 예산에 편입할지

- 상태: **소유자 결정 대기.** 이 문서는 근거만 제공하고 결정하지 않는다.
- 관련 이슈: #198 (PostgreSQL 여정 실행 문제는 #199·#216 범위, §5 참조)
- 작성일: 2026-09-17
- 작업 경계: `tests/critical-test-budget.json`의 **상한을 올리지 않았고 분류를
  바꾸지 않았다.** `scripts/check-critical-test-budget.mjs`의 discovery 패턴도
  바꾸지 않았다. 결정 전까지 현행 추적을 그대로 유지한다.

이슈 본문의 과거 기록(critical 104/208, harness 진입점 5·helper 16·선언 case 14)은
현재 사실로 재사용하지 않고 아래 수치를 직접 측정했다. 결과적으로 같은 값이지만,
**같다는 것 자체가 이번 실행의 측정 결과**다.

---

## 1. 이미 반영된 것 — 다시 구현하지 않는다

PR #219 / commit `1976baf6`에서 harness 진입점·helper 목록과 case 수의 별도 추적이
반영되었다. 현재 체크인 상태 [측정]:

- `tests/critical-test-budget.json`에 `policy.harnessRule`,
  `policy.harnessOpenDecision`, 그리고 21개 파일을 모두 담은 `harness` 섹션이 있다.
- `scripts/check-critical-test-budget.mjs`가 `.harness` 접미사를 **별도 discovery**로
  잡아 manifest와 대조한다. 역할(`entry-point`/`helper`), `runner` 설정 파일의
  `include` 포함 여부, helper의 `importedBy` 실제 import 여부, `each/only/skip`
  숨은 확장까지 검사한다.
- `tests/AGENTS.md`와 `CONTRIBUTING.md`가 "208 예산 밖의 계약 harness"라고 이미
  명시한다. `tests/AGENTS.md`는 "Folding these cases into `frontendCap`/`totalCap`
  … has **not** decided (issue #198, option 2)"라고 미결 상태까지 기록한다.

**따라서 남은 것은 discovery/manifest 작업이 아니라 정책 결정 하나뿐이다.**

---

## 2. 선언 수 / 실제 실행 여부 / 상한 — 셋을 따로 측정

### 2.1 선언된 수 (manifest + checker 정적 카운트)

```
$ corepack pnpm check:test-budget
critical test budget ok: frontend 42/80, Rust 62/128, total 104/208
harness 14/14 (budget 외 계약 검증, 208에 포함되지 않음): 5 entry points, 16 helper modules
```

[측정, 2026-09-17]

| 구분 | 선언 수 | 파일 수 |
| --- | --- | --- |
| frontend (`.test`/`.spec`/`.node-test` 접미사) | 42 | 8 |
| Rust (`#[test]` 형태 속성) | 62 | 13 |
| **208 예산 합계** | **104** | 21 |
| harness (`.harness` 접미사) | 14 | 21 (진입점 5 + helper 16) |

checker는 파일 **집합**도 검사한다. 디스크의 실제 목록과 manifest 키가 정확히
일치해야 통과하므로, 위 수치는 "manifest가 주장하는 값"이 아니라 "각 discovery
규칙이 저장소 전체를 훑어 얻은 값"이다.

### 2.2 실제 실행 여부 (직접 실행해 확인)

| 진입점 | 선언 | 실행 명령 | CI 연결 | 이번 실행 결과 [측정] |
| --- | --- | --- | --- | --- |
| `workspace-cloud/lib/control-plane-contracts.harness.ts` | 8 | `pnpm --dir workspace-cloud test:contracts` | **연결됨.** `ci.yml` `provider-postgres` job → `bash scripts/test-provider-import-d1.sh` → `workspace-cloud/scripts/test-d1-migrations.mjs` 마지막 줄이 `vitest run --config vitest.contracts.config.ts`를 호출한다 | 아래 두 파일 합산 **9 passed / 9** |
| `workspace-cloud/lib/d1-storage.harness.ts` | 1 | 위와 동일 config | 위와 동일 | (합산에 포함) |
| `product-analytics-cloudflare/src/index.harness.ts` | 1 | `pnpm --dir product-analytics-cloudflare test` | **연결됨.** `ci.yml` `analytics-cloudflare` job | **1 passed / 1** |
| `workspace-scheduler-cloudflare/src/index.harness.ts` | 3 | `pnpm --dir workspace-scheduler-cloudflare test` | **연결됨.** `ci.yml` `scheduler-cloudflare` job | **3 passed / 3** |
| `workspace-cloud/lib/provider-import-postgres.harness.ts` | 1 | `pnpm --dir workspace-cloud test:postgres-import` | **연결 안 됨.** `ci.yml`에 이 명령이 없다. 대신 `test:postgres-harness-guard`(가드만)가 있다 | **CI 미실행.** 격리 PostgreSQL 15에서 강제 실행하면 **실패** ([0001](0001-postgresql-provider-import-harness.md) §3) |

실제 출력:

```
$ corepack pnpm --dir workspace-cloud test:contracts
 Test Files  2 passed (2)
      Tests  9 passed (9)

$ corepack pnpm --dir product-analytics-cloudflare test
 Test Files  1 passed (1)
      Tests  1 passed (1)

$ corepack pnpm --dir workspace-scheduler-cloudflare test
 Test Files  1 passed (1)
      Tests  3 passed (3)

$ corepack pnpm test
critical test budget ok: frontend 42/80, Rust 62/128, total 104/208
harness 14/14 (budget 외 계약 검증, 208에 포함되지 않음): 5 entry points, 16 helper modules
 Test Files  8 passed (8)
      Tests  42 passed (42)
```

**정리:** 선언 14건 중 **13건이 CI에서 실제로 실행되어 통과한다.** 나머지 1건은
CI에 연결되지 않았고, 강제로 실행하면 실패한다.

Rust 62건은 이번 조사에서 실행하지 않았다(문서 전용 변경이라 `pnpm test:rust`
범위 밖). 다만 manifest의 Rust 파일별 수치와 `ci.yml` `rust-smoke`의 4개 `cargo
test` 명령을 대조하면 62건 전부가 CI 대상이다. [추정 — 파일·명령 대조에 의한
산술이며, 이번에 실행해 확인한 값은 아니다]

- `cargo test --package dopedb --lib` → 49 (`src-tauri/**` 10개 파일)
- `cargo test --package dopedb-protocol --test golden` → 8
- `cargo test --package dopedb-cli --test terminal_session_e2e` → 1
- `cargo test --package release-updater-verify` → 4

### 2.3 상한

| 상한 | 값 | 현재 사용 | 여유 |
| --- | --- | --- | --- |
| `totalCap` | 208 | 104 | 104 |
| `frontendCap` | 80 | 42 | 38 |
| `frontendFileCap` | 16 | 8 | 8 |
| `rustCap` | 128 | 62 | 66 |
| `rustFileCap` | 26 | 13 | 13 |
| harness | **상한 없음.** manifest 선언값과 실제 case 수의 **정확한 일치**만 강제 | 14 | 해당 없음 |

`check-critical-test-budget.mjs`는 다섯 상한을 **스크립트에 하드코딩**해 두고
manifest의 `policy` 값이 그것과 조금이라도 다르면 실패한다. 즉 manifest만 고쳐서
상한을 올릴 수 없고 스크립트도 함께 고쳐야 한다. 이는 의도된 이중 잠금이다. [측정]

---

## 3. 선언 수 14가 실제 검증량과 어떻게 다른가

이 점이 결정에 직접 영향을 주므로 따로 적는다. checker가 세는 것은 **선언된
`it()`/`test()` 호출 수**다. 그런데 큰 harness 두 개는 루트 `it()` **하나**가 수많은
시나리오 그룹으로 팬아웃하는 구조다. [측정]

| 파일 | 선언 case | 실제 팬아웃 |
| --- | --- | --- |
| `lib/d1-storage.harness.ts` | 1 | `verifyD1WorkspaceMutations` → permission, operation(→switch), lifecycle, backup, managed-lease, integration, versioning, route, analysis(→run, runner) 등 **helper 11개** |
| `lib/provider-import-postgres.harness.ts` | 1 | 시나리오 그룹 **14개** |
| `lib/control-plane-contracts.harness.ts` | 8 | helper 3개(`gcp-cloud-bootstrap`, `workload-identity`, `site-analytics`)로 팬아웃 |

따라서 "harness 14건"은 검증 **표면**이 아니라 **진입점 개수에 가까운 값**이다.
이 14를 104에 더해 118로 만들면 예산 숫자의 의미가 파일마다 달라진다. 반대로 지금처럼
따로 두면 208이라는 공개 숫자는 "접미사 discovery로 잡히는 자동 테스트"의 상한이라는
좁고 일관된 의미를 유지한다.

helper 16개가 `tests: 0`으로 기록된 것도 같은 맥락이다. helper는 case를 선언하지
않지만 실제 assertion의 대부분을 담고 있다. checker는 helper가 정말 import 되는지까지
검사해 죽은 harness 코드를 막지만, 그 안의 assertion 개수는 세지 않는다.

---

## 4. 문서 정합성 현황

이슈 본문은 "`tests/AGENTS.md`와 `CONTRIBUTING.md`는 208개 하드 예산이라고
설명하지만 실제 자동 테스트 총량은 118개"라는 어긋남을 지적했다. **그 어긋남은
이미 해소되어 있다.** [측정]

- `tests/AGENTS.md`: "The 208/80/128 caps count only suffix-discovered frontend tests
  and Rust `#[test]` functions … tracked but not charged against the 208 budget."
  현재 scope까지 "5 entry points carrying 14 cases, plus 16 helper modules"로 명시.
- `CONTRIBUTING.md:102-105`: "`*.harness.*` 계약 harness는 전용 vitest 설정으로
  실행되어 208개 예산에 포함되지 않지만 manifest의 `harness` 섹션이 파일 목록과
  정확한 case 수를 강제한다."
- 루트 `AGENTS.md`·`CLAUDE.md`도 같은 문장을 담고 있다.

즉 **선택지 1(별도 추적 명시)은 문서·checker·manifest 모두에서 이미 구현된 상태**이며,
남은 것은 이 상태를 확정할지 아니면 선택지 2로 뒤집을지다.

---

## 5. #199·#216과의 경계

이 문서는 **예산 정책만** 다룬다. 다음은 이 결정의 범위가 아니다.

- `provider-import-postgres.harness.ts`가 CI에서 실행되지 않는 문제 → #199
- 그 harness의 14개 시나리오가 D1 이전 뒤 실패하는 문제 → #216
  ([0001](0001-postgresql-provider-import-harness.md))

두 문제는 예산 편입 여부와 독립이다. 예산에 넣든 안 넣든 그 case는 지금 CI에서
돌지 않고, 돌리면 실패한다. **"harness를 예산에 넣으면 실행 문제도 해결된다"는
연결은 성립하지 않는다.**

---

## 6. 소유자가 고를 수 있는 선택지

### 선택지 1 — 별도 추적 정책을 확정한다 (현행 유지)

**하는 일:** `policy.harnessOpenDecision` 항목을 "결정됨"으로 바꾸고, `tests/AGENTS.md`의
미결 문단을 확정 문장으로 정리한다. 상한·분류·checker는 그대로 둔다.

| 결과 | 비용 |
| --- | --- |
| 208이 "접미사 discovery 자동 테스트"의 상한이라는 좁고 일관된 의미를 유지한다 | manifest 1개 필드 + 문서 2곳 문장 정리 |
| harness는 상한 없이 "정확한 일치"로만 강제되므로, 계약 harness case가 늘어날 때 예산 협상이 필요 없다 | **harness case 수에 상한이 없다**는 점이 남는다. 지금은 14건이라 문제가 아니지만, 예산 밖 영역이 소리 없이 커질 수 있다 |
| 진입점/helper 역할 검사, runner include 검사, 죽은 helper 검사가 그대로 유지된다 | "208개 예산"이라는 공개 문장을 읽는 사람이 harness 섹션까지 봐야 전체 상을 얻는다 |

### 선택지 2 — harness case를 critical 예산에 편입한다

**하는 일:** checker의 frontend discovery에 `.harness`를 포함시키고 manifest의
`harness` 섹션을 `frontend`로 합친다.

| 결과 | 비용 |
| --- | --- |
| "저장소 전체 자동 테스트 총량"이라는 하나의 숫자가 생긴다 (104 + 14 = 118) | **frontend 42 + 14 = 56 / 80, 파일 8 + 21 = 29 / 16.** `frontendFileCap` 16을 **13개 초과한다.** 상한을 올리지 않고는 편입이 성립하지 않는다 |
| 예산 밖 영역이 사라진다 | `frontendFileCap`을 올리는 것은 RULES와 `tests/AGENTS.md`가 금지한 "명시적 사용자 요청 없는 상한 변경"에 해당한다. **이 문서는 그 안을 제시하지 않는다** |
| — | helper 16개는 case 0건이라 파일 수만 소비한다. 편입하면 파일 상한이 "실제 테스트 파일 수"가 아니라 "모듈 분할 방식"에 좌우된다 |
| — | 역할(`entry-point`/`helper`)·`runner`·`importedBy` 검사는 harness 전용 구조다. `frontend`로 합치면 그 검사를 유지하기 위한 별도 필드가 다시 필요해진다 |

**측정으로 확인된 제약:** 선택지 2는 파일 상한 때문에 **상한 변경 없이는 구현
불가능**하다. [측정: 실제 harness 파일 21개 + frontend 8개 = 29 > 16]

### 권고 (근거 포함, 결정 아님)

- **선택지 1(별도 추적 확정)을 권고한다.** 근거는 셋이다. (1) 선택지 2는 파일
  상한을 13개 초과해 상한 변경 없이는 성립하지 않는데, 상한 변경은 이 이슈가
  요청한 범위가 아니다. (2) checker가 세는 "case"의 의미가 harness와 frontend에서
  다르다(§3). 서로 다른 단위를 한 숫자로 합치면 208이라는 제약의 신호가 약해진다.
  (3) 별도 추적은 이미 구현·문서화되어 있고 `check:test-budget`이 매 실행에서
  두 줄로 분리 보고한다. 확정에 드는 비용이 가장 작다.
- **다만 선택지 1을 택하더라도 남는 빈틈이 하나 있다:** harness에는 상한이 없다.
  원한다면 "harness 진입점 수" 또는 "harness case 수"에 별도 상한을 두는 보완안을
  같은 결정에서 정할 수 있다. 이는 208 상한을 건드리지 않는다.

### 소유자가 결정해야 할 정확한 질문

**`*.harness.*` 계약 harness를 지금처럼 208 예산 밖에서 별도 추적하는 정책을
확정할 것인가(선택지 1), 아니면 208 예산에 편입할 것인가(선택지 2) — 후자는
`frontendFileCap` 16을 13개 초과하므로 상한 변경을 함께 승인해야만 성립한다는
점을 포함해서.**
