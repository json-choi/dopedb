# `*.harness.*` 계약 harness의 208 예산 편입 여부 (소유자 결정 대기)

`tests/critical-test-budget.json`의 `policy.harnessOpenDecision`이 이 질문을 미결로
기록하고 있다. 이 문서는 그 결정에 필요한 현재 수치만 담는다. 결정을 내리지 않으며
선택지의 결과를 계산해 둔다.

측정 시점: `main` `8d1bc4fb` (앱 0.4.41). 아래 수치는 모두
`node scripts/check-critical-test-budget.mjs`와 manifest를 직접 읽어 얻었다.

## 현재 상태

| 항목 | 값 | 상한 |
|---|---:|---:|
| frontend case | 42 | `frontendCap` 80 |
| frontend 파일 | 8 | `frontendFileCap` 16 |
| Rust case | 62 | `rustCap` 128 |
| Rust 파일 | — | `rustFileCap` 26 |
| **208 예산 합계** | **104** | `totalCap` 208 |
| harness case (예산 밖) | 14 | 별도 추적 |
| harness 파일 (예산 밖) | 20 | 별도 추적 |

harness 20개는 entry point 4개와 helper 16개다. helper는 선언 case가 0이며 다른
harness 파일이 import한다.

## 선택지 1 — 별도 추적을 확정한다 (현행 유지)

`harness` 절이 파일 목록과 정확한 case 수를 계속 강제하고, 208은 critical 예산만
가리킨다. manifest에서 `harnessOpenDecision`을 지우고 `tests/AGENTS.md`의 서술을
확정형으로 바꾸면 끝난다. 코드 변경은 없다.

이 선택지의 비용은 "208"이라는 공개 규칙이 저장소의 **자동 테스트 총량이 아니라는**
점을 문서가 계속 설명해야 한다는 것이다.

## 선택지 2 — harness를 208 예산에 편입한다

편입하면 세 상한 중 **파일 수 상한 하나만 깨진다.**

| 검사 | 편입 후 | 상한 | 결과 |
|---|---:|---:|---|
| frontend case | 42 + 14 = 56 | 80 | 통과 |
| **frontend 파일** | **8 + 20 = 28** | **16** | **12개 초과** |
| 전체 case | 104 + 14 = 118 | 208 | 통과 |

즉 case 예산에는 여유가 있고 **`frontendFileCap` 16이 유일한 걸림돌이다.** 이 선택지는
그 상한 변경 승인을 반드시 동반해야 성립한다. 상한을 올리지 않고 편입하려면 harness
파일 12개를 없애야 하는데, helper 16개는 entry point가 import하는 assertion 모듈이라
단순 삭제 대상이 아니다.

## 소유자가 결정해야 할 정확한 질문

**`*.harness.*`를 지금처럼 208 예산 밖에서 별도 추적하는 정책을 확정할 것인가
(선택지 1), 아니면 208 예산에 편입할 것인가(선택지 2) — 후자는 `frontendFileCap`
16을 12개 초과하므로 상한 변경을 함께 승인해야만 성립한다는 점을 포함해서.**

## 이 문서가 다루지 않는 것

- 원 제안 #216(PostgreSQL provider-import harness 이식/폐기)과 #199(그 여정의 CI 연결)는
  D1 시나리오 harness로 이식이 완료되어 더 이상 미결이 아니다.
  `workspace-cloud/lib/d1-*-scenarios.harness.ts`가 그 결과다.
- 어떤 상한도 이 문서로 바꾸지 않았다. 결정 전까지 현행 추적을 유지한다.
