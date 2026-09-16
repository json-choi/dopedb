# 결정 근거 0003: provider-import 여정의 자동 검증 경로

- 상태: **소유자 결정 대기.** 이 문서는 근거만 제공하고 결정하지 않는다.
- 관련 이슈: #199. **[#216](0001-postgresql-provider-import-harness.md) 결정에 종속**이므로
  아래 계획은 전부 조건부다.
- 작성일: 2026-09-17
- 작업 경계: CI 워크플로를 **바꾸지 않았다.** 깨진 PostgreSQL 여정을 필수 체크에
  연결하지 않았고, 기존 필수 체크를 제거하거나 실패를 숨기지 않았다. 모든 실행은
  이번에 새로 만든 임시 격리 클러스터에서만 했다.

---

## 1. 지금 CI가 실제로 검증하는 것과 하지 않는 것

`ci.yml`의 `provider-postgres` job은 다음 5단계를 돈다. [측정]

| 단계 | 명령 | 무엇을 검증하나 |
| --- | --- | --- |
| 1 | `build:cloudflare` + `build:identity` + `wrangler deploy --dry-run` | Worker 빌드 |
| 2 | `node scripts/check-d1-runtime.mjs` | 네이티브 D1 런타임 |
| 3 | `bash scripts/test-provider-import-d1.sh` | 운영 D1 migration 진입점(신규 적용·정확한 재생·변조 영수증 거부·미지 DB 거부) **및 이어서** `vitest run --config vitest.contracts.config.ts`(계약 harness 9 case) |
| 4 | `PG_BIN="$(pg_config --bindir)" node scripts/test-gcp-schema-policy.mjs` | Cloud SQL 설정이 기존 애플리케이션 접근을 보존하는지 (자체 `initdb` 격리 클러스터) |
| 5 | `pnpm --dir workspace-cloud test:postgres-harness-guard` | **가드 자체만** |

### 1.1 가드 통과는 여정 통과가 아니다

5단계의 실제 출력이다. [측정]

```
$ corepack pnpm --dir workspace-cloud test:postgres-harness-guard
✔ canonical target ignores credentials and Neon pooler alias
✔ guard accepts a dedicated confirmed database
✔ guard rejects missing opt-in or short sentinel
✔ guard rejects every alias of the application database
✔ guard rejects non-PostgreSQL and incomplete URLs
ℹ tests 5  ℹ pass 5  ℹ fail 0
```

이 5건은 **"harness를 잘못된 DB에 겨누면 거부하는가"**를 검증한다. import 여정
자체는 한 줄도 실행하지 않는다. `.github/workflows/*.yml` 어디에도
`test:postgres-import` 호출이 없다. [측정]

**보고 문구 주의:** `provider-postgres` job이 초록이어도 "provider-import 여정이
통과했다"고 쓰면 사실과 다르다. 통과한 것은 (a) D1 migration 진입점, (b) D1 계약
harness 9건, (c) Cloud SQL 정책 검증, (d) PostgreSQL harness **안전 가드** 5건이다.

### 1.2 여정을 강제 실행하면 어떻게 되는가

정상 격리 환경을 직접 만들어 돌린 결과다. [측정]

```
$ node workspace-cloud/scripts/run-provider-import-postgres-harness.mjs
 × imports once, replays exactly, and rejects stale authority without leaking credentials
 Error: Personal Knowledge scope projection was incomplete
 Test Files  1 failed (1)   Tests  1 failed (1)   EXIT=1
```

14개 시나리오 그룹 중 실제로 통과하는 것은 3개뿐이다. 상세는
[0001](0001-postgresql-provider-import-harness.md) §3.

**따라서 지금 이 명령을 CI에 연결하면 필수 체크가 빨간불이 된다.** #216 결정
전에는 연결하지 않는다.

---

## 2. 서버 버전 하한 두 개를 구분한다

두 값은 서로 다른 이유에서 나오며 섞으면 안 된다. [측정]

| 대상 | 하한 | 이유 | 현재 CI |
| --- | --- | --- | --- |
| `scripts/test-gcp-schema-policy.mjs` (GCP 정책 검증) | **PostgreSQL 14** | `pg_read_all_data`/`pg_write_all_data`가 PostgreSQL 14부터 추가된 predefined role이다 | `provider-postgres` job에서 매번 실행 |
| `lib/provider-import-postgres.harness.ts` (legacy harness) | **PostgreSQL 15** | `drizzle/0000_mvp_baseline.sql`이 `ON DELETE SET NULL (column, ...)` 구문을 쓰는데 14가 문법 오류로 거부한다 | 실행되지 않음 |

`scripts/test-all.sh`도 이 구분을 주석으로 명시하고 `postgres_version_floor="14"`를
GCP 단계 기준으로만 쓴다. legacy harness가 CI로 돌아온다면 **그 단계의 클러스터는
별도로 15+여야 하며, 그 migration에서 나오는 문법 오류는 회귀가 아니라 서버 버전
하한 위반으로 읽어야 한다.** [측정: `scripts/test-all.sh:408-418` 주석과 동일]

이번 조사에서 `0000`/`0001`을 PostgreSQL **15.15**에 적용했고, 식별자 절단 NOTICE
43건만 내고 통과했다. [측정] 따라서 그 migration에서 NOTICE 외의 출력이 나오면
실제 회귀다.

---

## 3. #216 결정별 조건부 계획

### 계획 X — #216이 **존치**(전면 이식, 옵션 A)로 결정된 경우

1. 이식이 끝나고 14개 그룹이 격리 환경에서 **전부 통과한 뒤에만** CI에 연결한다.
   이식 중간 상태를 필수 체크에 넣지 않는다.
2. 이식 결과가 D1을 대상으로 한다면 **PostgreSQL 러너가 아니라 D1 러너**에 붙인다.
   구체적으로는 `vitest.contracts.config.ts` 또는 `vitest.provider-harness.config.ts`
   중 실제 대상에 맞는 쪽이며, `scripts/test-provider-import-d1.sh` 안에서 이미
   도는 계약 harness 단계에 흡수하는 것이 가장 싸다(별도 job·클러스터 불필요).
3. PostgreSQL 러너가 남는 부분(예: credential key rotation)만 §4의 격리 클러스터
   단계로 남기고, 그 단계의 하한을 **15**로 명시한다.
4. 실행 주기: D1 쪽으로 흡수된 부분은 기존 `provider-postgres` job 안이므로
   **PR마다** 돈다. 추가 주기 논의가 필요 없다.

### 계획 Y — #216이 **선별 이식**(옵션 B)으로 결정된 경우 — 가장 가능성이 높은 경로

1. [0001](0001-postgresql-provider-import-harness.md) §4.1의 4건(그룹 01·08·14,
   06의 권한 세션 헤더)을 **기존 D1/contract harness의 case로 흡수**한다. 새 진입점을
   만들지 않으면 `tests/critical-test-budget.json`의 `harness` 섹션에서 case 수만
   갱신하면 되고, 파일 목록 변경이 없다.
2. 흡수된 case는 `vitest.contracts.config.ts`를 타므로 **`scripts/test-provider-import-d1.sh`
   경유로 이미 PR마다 돈다. 새 CI job도, 새 schedule도, 새 클러스터도 필요 없다.**
3. PostgreSQL 러너가 남는 경우는 §4.2의 credential rotation 하나뿐이다. 이것이
   남는다면 §4의 단계를 **`provider-postgres` job 안에 추가**한다(같은 job에서
   `test-gcp-schema-policy.mjs`가 이미 클러스터를 띄우므로 러너 비용이 사실상
   추가되지 않는다). 다만 그 클러스터는 하한 **15**여야 한다.
4. 남는 PostgreSQL 단계가 없다면 `test:postgres-harness-guard`도 함께 정리한다.
   지킬 대상이 없는 가드를 필수 체크로 남기지 않는다.

### 계획 Z — #216이 **폐기**(옵션 C)로 결정된 경우

1. suite 삭제 **전에** §4.1의 대체 assertion 흡수를 먼저 끝낸다. 그러지 않으면
   검증 공백이 그대로 남는다.
2. 삭제 시 같은 변경에서 함께 정리할 항목: `vitest.provider-harness.config.ts`,
   `scripts/run-provider-import-postgres-harness.mjs`,
   `scripts/provider-import-postgres-harness-guard.mjs`(776줄),
   `scripts/provider-import-postgres-harness-guard.node.mjs`(170줄),
   `package.json`의 `test:postgres-import`·`test:postgres-harness-guard`,
   `ci.yml`의 5단계, `tests/critical-test-budget.json`의 `harness` 항목 1개.
3. `tests/critical-test-budget.json`의 harness 선언은 **14 → 13**이 된다. 상한이
   아니라 정확한 일치값이므로 같은 변경에서 갱신해야 checker가 통과한다. [측정:
   checker는 선언값과 실제 case 수가 다르면 실패]
4. 이 경우 provider-import 여정의 자동 검증은 **D1 쪽**(`d1-workspace-scenarios.harness.ts`의
   `importProviderReceipt` 경로)만 남는다. 그 사실을 `docs/CLOUDFLARE_OPERATIONS.md`
   검증 목록에 반영한다.

---

## 4. 유지해야 할 guard (어떤 계획을 택하든)

PostgreSQL 단계가 조금이라도 남는다면 아래 다섯 가지는 유지한다. 현재 구현 상태를
함께 적는다. [측정]

| guard | 현재 구현 | 비고 |
| --- | --- | --- |
| **독립 임시 DB** | `validateHarnessEnvironment`가 `PROVIDER_IMPORT_TEST_DATABASE_URL`을 11개 기본 애플리케이션 URL 환경변수(`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL*`, `NEON_DATABASE_URL*` 등)와 **논리 대상(host/port/database) 기준**으로 비교해 겹치면 거부. 자격 증명과 `-pooler` 호스트 별칭은 무시하고 정규화한다 | 실증: `DATABASE_URL`을 같은 논리 대상으로 설정하면 exit 2 |
| **실행별 sentinel** | `PROVIDER_IMPORT_TEST_DATABASE_SENTINEL` 길이 16–256 요구(가드) + 런타임에 `provider_harness.isolated_database_sentinel`에 그 marker 행이 실제로 있어야 진행(`openProviderImportPostgresHarness`) | job마다 새로 생성해 애플리케이션 DB와 겹칠 수 없게 한다 |
| **localhost 바인딩** | **가드가 강제하지 않는다.** 프로비저닝 쪽 책임(`-c listen_addresses=127.0.0.1 -c unix_socket_directories=''`) | CI 단계를 만들 때 이 옵션을 단계 스크립트에 고정해야 한다 |
| **앱/운영 DB 거부** | 위 "독립 임시 DB"와 동일 경로 + `postgres:`/`postgresql:` 프로토콜만 허용, host·user·database가 모두 있어야 함 | |
| **자신이 만든 자원만 정리** | `fixture.cleanup()`은 자신이 만든 조직 3건·사용자 3건만 `DELETE` 하고 `sql.end()` 한다. 스키마나 데이터베이스를 drop 하지 않는다 | 클러스터 수명은 호출자(CI 단계 또는 로컬 운영자)가 소유한다 |
| (추가) **소스 ratchet** | 러너가 vitest 실행 전에 `validateHarnessSourceTree`를 먼저 돌려 파일별·전체 줄 수 상한과 지원 파일 목록 정확 일치를 검사한다. 실패 시 exit 2 | 상한을 올리지 않는다 |

### 4.1 거부 경로 실증

세 가지 거부를 모두 직접 확인했다. [측정]

```
$ (환경변수 없음)                          → Refusing PostgreSQL harness: ... EXIT=2
$ SENTINEL="short"                         → Refusing PostgreSQL harness: ... EXIT=2
$ DATABASE_URL=<harness와 같은 논리 대상>  → Refusing PostgreSQL harness: ... EXIT=2
```

셋 다 동일 메시지(`independently provisioned test database verification failed.`)와
exit 2다. 메시지가 어떤 조건이 걸렸는지 구분하지 않는 것은 의도된 것으로 보이지만,
CI 로그만 보고 원인을 알기 어렵다는 점은 단계를 만들 때 고려할 값이다.

---

## 5. 실행 주기 — coverage와 비용 근거

**schedule 추가 자체를 목표로 삼지 않는다.** 아래는 결정에 필요한 비용 측정값이다.
로컬 macOS(arm64) 기준이며 CI ubuntu 러너와는 다르다. [측정]

| 작업 | 실측 시간 |
| --- | --- |
| `initdb` + `pg_ctl start` (콜드 클러스터) | 0.76 s |
| DB 생성 + `drizzle/0000`+`0001` 적용 + sentinel 삽입 | 0.51 s |
| 가드 + vitest 실행 (그룹 04에서 실패해 조기 종료) | 3.05 s |

비교 기준: `provider-postgres` job은 이미 `test-gcp-schema-policy.mjs`에서 자체
`initdb` 클러스터를 띄운다. 즉 **격리 클러스터를 띄우는 비용은 이 job에서 이미
지불되고 있다.** 추가 비용은 같은 클러스터에 DB 하나를 더 만들거나(≈0.5 s) 두 번째
클러스터를 띄우는 것(≈1.3 s)이다.

**따라서 비용은 주기를 제한할 근거가 되지 못한다.** 주기 결정의 실제 변수는 다음 둘이다.

1. **Coverage 근거:** 남는 PostgreSQL 단계가 §4.2의 credential rotation 하나뿐이라면,
   그 모듈은 운영자 전용이고 HTTP route가 없어 PR마다 회귀할 가능성이 낮다. 이 경우
   `main` push 또는 주 1회로 제한하는 것이 합리적이다.
2. **필수 체크 안정성:** 격리 클러스터를 띄우는 단계는 러너 환경에 의존한다.
   `provider-postgres`는 이미 필수 체크이므로 불안정한 단계를 추가하면 무관한 PR이
   막힌다. PR마다 돌릴 단계는 §3의 계획 Y처럼 **D1 쪽으로 흡수된 case**여야 한다.

권고: **PR마다 도는 것은 D1로 흡수된 case로 하고, PostgreSQL 러너가 필요한 잔여
단계만 `main` push로 제한한다.** 별도 schedule은 잔여 단계가 실제로 남았을 때만
검토한다.

---

## 6. 검증 계획 (결정 후 수행할 항목)

| # | 검증 | 기대 결과 |
| --- | --- | --- |
| 1 | 정상 격리 환경에서 대상 여정 전체 실행 | 실행된 그룹 전부 통과. 로그에 **실행된 그룹과 미실행 그룹을 구분해 남긴다** |
| 2 | `PROVIDER_IMPORT_TEST_DATABASE_URL` 누락 | exit 2, 여정 미실행 |
| 3 | `PROVIDER_IMPORT_TEST_DATABASE_ISOLATED` 누락 | exit 2, 여정 미실행 |
| 4 | sentinel 누락 또는 16자 미만 | exit 2, 여정 미실행 |
| 5 | sentinel 값이 DB의 `provider_harness.isolated_database_sentinel`에 없음 | 런타임에 `Dedicated PostgreSQL harness sentinel was not confirmed`로 중단 |
| 6 | 애플리케이션 URL과 같은 논리 대상 | exit 2, 여정 미실행 |
| 7 | `corepack pnpm check:test-budget` | harness 선언값이 실제 case 수와 일치 |
| 8 | 단계 종료 후 클러스터 정리 | 단계가 만든 자원만 제거. 기존 DB·role·ACL 무변경 |

2·4·6은 이번 조사에서 이미 실증했다(§4.1). 1·3·5·7·8은 결정 후 수행 대상이다.

> **주의:** 현재 상태에서 검증 1은 통과할 수 없다. 14개 그룹 중 3개만 통과한다
> ([0001](0001-postgresql-provider-import-harness.md) §3). 검증 1을 통과시키는 것이
> #216 결정의 결과물이지 이 문서의 작업이 아니다.

---

## 7. 로컬 재현 절차 (이번에 실제로 사용해 검증한 순서)

PostgreSQL **15 이상**의 서버 설치(`initdb` 포함)가 필요하다. macOS Homebrew
기준으로 `/opt/homebrew/opt/postgresql@15/bin`이다. `pg_config --bindir`가 가리키는
곳이 libpq 전용 client이거나 14 이하일 수 있으므로 **직접 확인한다.**

```sh
PGBIN=/opt/homebrew/opt/postgresql@15/bin      # initdb 포함, 15 이상인지 확인
"$PGBIN/initdb" --version                       # 예: initdb (PostgreSQL) 15.15

C="$(mktemp -d)"
"$PGBIN/initdb" -D "$C/data" -U harness_owner -A trust --no-locale --encoding=UTF8
"$PGBIN/pg_ctl" -D "$C/data" -l "$C/log" -w \
  -o "-p 55480 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start

PSQL=("$PGBIN/psql" -h 127.0.0.1 -p 55480 -U harness_owner -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "CREATE DATABASE provider_import_harness;"
"${PSQL[@]}" -d provider_import_harness -f workspace-cloud/drizzle/0000_mvp_baseline.sql
"${PSQL[@]}" -d provider_import_harness -f workspace-cloud/drizzle/0001_article_sharing.sql
# 위 두 파일은 15에서 식별자 절단 NOTICE만 내고 통과해야 한다. 그 외 출력은 회귀다.

SENTINEL="harness-sentinel-$(date +%s)-$RANDOM$RANDOM"   # 16자 이상
"${PSQL[@]}" -d provider_import_harness \
  -c "CREATE SCHEMA provider_harness;" \
  -c "CREATE TABLE provider_harness.isolated_database_sentinel (marker text primary key);" \
  -c "INSERT INTO provider_harness.isolated_database_sentinel VALUES ('$SENTINEL');"

cd workspace-cloud
PROVIDER_IMPORT_TEST_DATABASE_URL="postgresql://harness_owner@127.0.0.1:55480/provider_import_harness" \
PROVIDER_IMPORT_TEST_DATABASE_ISOLATED=1 \
PROVIDER_IMPORT_TEST_DATABASE_SENTINEL="$SENTINEL" \
  node scripts/run-provider-import-postgres-harness.mjs

# 정리: 클러스터 전체를 지운다. harness 자체는 자기가 만든 행만 지운다.
"$PGBIN/pg_ctl" -D "$C/data" -m immediate stop && rm -rf "$C"
```

`unix_socket_directories`를 비우지 않으면 임시 디렉터리 경로가 socket 경로 103바이트
제한을 넘어 서버가 기동하지 않는다. `--check-guard-only` 인자를 주면 가드만 돌고
vitest는 실행되지 않는다.

`DATABASE_URL`이나 `POSTGRES_URL*` 같은 환경변수가 셸에 남아 있으면 가드가 거부할
수 있다. 거부되면 그 환경변수를 지우고 다시 실행한다.

---

## 8. 소유자가 고를 수 있는 선택지

| | 선택지 | 내용 | 전제 |
| --- | --- | --- | --- |
| P | **#216 결정까지 현행 유지** | CI를 바꾸지 않는다. 가드 5건만 계속 돈다 | 없음 |
| Q | **계획 Y를 미리 승인** | #216이 선별 이식으로 결정되면 흡수된 case가 기존 `provider-postgres` job 경유로 PR마다 돌고, 새 job·schedule을 만들지 않는다 | #216 옵션 B |
| R | **잔여 PostgreSQL 단계를 `main` push 한정으로 추가** | credential rotation 등 PostgreSQL 러너가 필요한 부분만 `main` push에서 15+ 격리 클러스터로 실행 | #216에서 그 자산 존치가 확정 |
| S | **주 1회 schedule 추가** | 위 잔여 단계를 schedule로 분리 | 잔여 단계가 실제로 남고, `main` push 빈도가 낮다고 판단될 때 |

### 권고 (근거 포함, 결정 아님)

- **P를 유지하다가 #216 결정 직후 Q를 적용하는 순서를 권고한다.** 근거: (1) §5에서
  측정했듯 격리 클러스터 비용은 이미 지불되고 있어 비용이 주기 제한의 근거가 되지
  않으므로, 굳이 새 job이나 schedule을 만들 이유가 없다. (2) [0001](0001-postgresql-provider-import-harness.md)의
  선별 이식 대상 4건은 모두 기존 D1/contract harness case로 흡수 가능하고, 그
  경로는 이미 필수 체크에서 PR마다 돈다. (3) 새 필수 단계를 늘릴수록 무관한 PR이
  러너 환경 문제로 막힐 위험이 커진다.
- **S(schedule)는 지금 근거가 없다.** 잔여 PostgreSQL 단계가 실제로 남는지가
  #216에서 먼저 확정돼야 한다.

### 소유자가 결정해야 할 정확한 질문

**#216 결정 이후 provider-import 여정을 어디에 붙일 것인가 — D1로 흡수된 case를
기존 `provider-postgres` 필수 job 경유로 PR마다 돌리는 것(Q)으로 충분한가, 아니면
PostgreSQL 러너가 필요한 잔여 단계를 `main` push 한정(R) 또는 주 1회 schedule(S)로
따로 둘 것인가?**
