# Durable Job Engine contract

정본 도메인과 use case는 `src-tauri/src/features/jobs/`에 있고, 복구·파일 capability·
계획·실행 lifecycle은 `application/` 아래 독립 모듈이다. 플랫폼 계약은 `ports.rs`,
SQLite·파일·권한·catalog·Operation·worker 구현은 `adapters/`에 있다. SQLite ledger는
단일 `JobRepository` 아래 capability·record·transition·recovery·event·mapping 모듈로
분리되며, 이 경계 밖에서는 Job 상태 SQL을 쓸 수 없다. worker의 진입점은 실행 순서만
소유하고 export·import·resume 검증·statement 생성·파일 게시 구현을 각각의 내부
모듈에 위임한다. 포맷 어댑터도 writer·typed value·import reader·inspection/audit·
안전한 파일 I/O를 분리하며, 각 구현 파일은 공통 feature 크기 제한을 따른다.
`mod.rs`만 이 구현들을 조립한다. renderer는 로컬 경로와 데이터베이스 자격증명을 받지
않으며, SQL-family 연결의 relation 단위 import/export만 이 계약을 사용한다. MongoDB처럼
document-family인 연결은 typed document adapter가 준비되기 전까지 실패 폐쇄한다.

## 권한과 계획

- native file picker는 workspace/account/connection에 묶인 opaque capability만 반환한다.
- 선택한 input은 즉시 앱 전용 `0700` 디렉터리의 무작위 `0600` 파일로 복사하면서
  SHA-256을 계산한다. 미리보기·승인·실행·재개는 원본 경로가 아니라 이 고정
  스냅샷만 사용한다. terminal Job 또는 만료된 미사용 capability는 이를 폐기하며,
  시작 시 활성 capability와 대조해 cascade 삭제나 이전 삭제 실패로 생긴 고아
  스냅샷도 안전한 UUID 파일명에 한해 회수한다.
- capability는 한 Job에 한 번만 귀속되고 30일 뒤 만료된다.
- Job plan은 canonical SHA-256으로 고정되고 정확히 하나의 `operations` 행을 참조한다.
- export는 read 권한으로 시작할 수 있다.
- export의 `per_batch_current` consistency는 장시간 transaction snapshot을 유지하지
  않는다. 각 batch는 그 시점의 현재 데이터를 읽으므로 실행·재개 중 원본 행이 바뀌면
  결과에도 반영될 수 있으며, 재개는 point-in-time snapshot 복원이 아니다.
- import는 현재 RBAC write 권한과 connection write policy를 모두 다시 확인한 뒤,
  hash-pinned exact Operation 승인을 받아야 실행된다.
- renderer가 보낸 path, SQL grant, 임의 approval boolean은 실행 권한이 아니다.

## 수명주기

```text
queued → running → succeeded | failed
                   ↘ pause_requested → paused → running
                   ↘ cancel_requested → cancelled
```

`pause_requested`는 SQLite의 별도 durable flag다. worker가 현재 트랜잭션을 끝내고
진행률과 fingerprint checkpoint를 기록한 뒤에만 `paused`가 된다. 앱 재시작 시:

- 정상적인 pause 경계에서 checkpoint를 남긴 resumable Job만 새 runtime에 재귀속할
  수 있다. 실제 파일 hash, catalog fingerprint, partial output fingerprint와 저장된
  진행률은 새 실행 grant를 발급하기 전에 검증하고 worker 진입 시 한 번 더 검증한다.
- 실행 중 중단된 import는 마지막 commit이 불명확할 수 있으므로 `outcome_unknown`으로
  실패하고 자동 재시도하지 않는다.
- non-resumable export는 partial artifact를 유지하고 실패한다.
- queued plan은 payload hash와 기존 승인을 바꾸지 않고 새 process runtime에 귀속한다.

Job event는 append-only이며 started/resumed/progress/pause/cancel/terminal 전이를
순서대로 보존한다.

## 포맷과 재개

| 포맷 | Export | Import | 재개 |
| --- | --- | --- | --- |
| CSV/TSV | streaming | streaming | committed row/byte checkpoint |
| NDJSON | streaming | streaming | committed row/byte checkpoint |
| JSON array | bounded document | bounded document | source hash + committed row |
| INSERT SQL | streaming | bounded audited script | export만 재개 |
| XLSX | constant-memory write | bounded workbook | 재개 안 함 |
| gzip 변형 | streaming compression | streaming decompression | 재개 안 함 |

SQL import는 DDL이나 engine별 implicit commit을 포함할 수 있다. 따라서 한 문장씩
실행·기록하고 pause/resume을 허용하지 않는다. 실행 중 cancel/timeout 또는 commit
acknowledgement 손실은 `outcome_unknown`이며 사용자가 target을 확인하기 전에는
재시도할 수 없다.

## 메모리·파일 안전성

- export의 decoded batch는 16 MiB, 한 CSV/NDJSON record는 8 MiB로 제한한다.
- JSON/SQL/XLSX document input은 압축 해제 후 512 MiB로 제한한다.
- XLSX ZIP은 entry 수, 안전한 enclosed path, declared expanded size를 사전 검사한다.
- source hash와 parsing은 동일한 `O_NOFOLLOW`/reparse-point 방어 file handle을 쓴다.
- output은 canonical parent 아래 같은 filesystem의 UUID partial에 쓰고 flush/fsync한
  뒤 원자 교체한다. parent 교체, symlink, directory target은 실패 폐쇄한다.
- 오류 artifact에는 64 KiB 이하의 bounded row와 1,000자 이하의 redacted error만
  기록한다. 큰 row는 짧은 preview·원본 byte 수·SHA-256으로 대체하고, SQL 본문 대신
  statement SHA-256만 기록한다. 앱 전용 오류 디렉터리와 파일은 Unix에서 각각
  `0700`·`0600`으로 고정한다.
- decimal은 문자열 정밀도를 보존하며 date/boolean/binary는 Catalog type family에 맞는
  engine literal로 변환한다.

## UI 계약

Table 화면의 우측 context panel에서 포맷과 파일을 고르고, 최대 5개 sample row를
미리 본 뒤 자동 name mapping 또는 명시적 source→target mapping을 선택한다. 필수
target column, NULL 표현, error policy와 error limit은 실행 전에 검증한다. 최근 Job은
실시간 진행률, 일시정지/재개/취소, exact import 승인, retained output/error artifact
열기를 같은 패널에서 제공한다.

`job:changed`는 connection, Job ID, kind, state, 처리 행·바이트 수를 전달한다.
import가 `succeeded`, `paused`, `cancelled`, `failed`로 정리되면 해당 연결의
열린 table page와 total count를 함께 다시 읽고 닫힌 page의 cache도 무효화한다.
실패나 중단 전에 완료된 batch가 있을 수 있으므로 성공 때만 갱신하지 않는다.
진행률 event와 export는 table read를 다시 실행하지 않는다. 갱신하는 동안 기존
행을 유지하며, 다른 연결의 query cache는 건드리지 않는다.
