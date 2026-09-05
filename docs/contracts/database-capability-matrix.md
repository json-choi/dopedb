# Database capability matrix

`supported`는 바로 실행한다는 뜻이 아니다. 모든 mutation은 해당 typed operation의
검증, preview, exact Operation Proposal, 승인, 실행 순서를 거친다. DDL은 DDL IR을
검증한다. `blocked`는 raw SQL fallback을
만들지 않고 fail closed한다는 뜻이다.

| Capability | PostgreSQL | MySQL/MariaDB | SQLite | MongoDB | Google BigQuery |
| --- | --- | --- | --- | --- | --- |
| Catalog namespace | supported | supported | synthetic `main`/attached | database/collection | project/dataset/table |
| SQL plan/run | supported | supported | supported | blocked | read-only through official `bq` CLI |
| Typed document read | blocked | blocked | blocked | supported | blocked |
| DB-enforced read-only | transaction/session | transaction/session | query-only/read-only connection | typed stage allowlist + server role | server dry-run `SELECT` gate + no write adapter |
| Billing/impact preview | query plan | query plan | query plan | blocked | server dry-run bytes + maximum bytes billed |
| Create/drop table | direct DDL | direct DDL | direct DDL | blocked in relational DDL IR | blocked |
| Rename table | direct DDL | direct DDL | direct DDL | blocked | blocked |
| Add column | direct DDL | direct DDL | capability/version checked | blocked | blocked |
| Alter/drop column | direct DDL | direct DDL | rebuild planner when required | blocked | blocked |
| PK/FK/unique/check | direct DDL | engine capability checked | rebuild planner | blocked | blocked |
| Expression/partial index | supported | capability checked | capability checked | blocked | blocked |
| Transactional DDL | engine/version dependent | implicit commit caveat | transaction where supported | blocked | blocked |
| Table row editor | stable key required | stable key required | stable key required | separate document editor later | blocked; result inspection only |
| Streaming export | supported through Jobs | supported through Jobs | supported through Jobs | planned typed document export | current bounded result only; bulk job blocked |
| Streaming import | supported through Jobs | supported through Jobs | supported through Jobs | planned typed document import | blocked |

## DDL renderer 원칙

- identifier quoting은 engine adapter가 담당한다.
- PostgreSQL/MySQL/SQLite renderer가 지원하지 않는 IR은 error를 반환한다.
- SQLite rebuild는 새 table 생성, data copy, constraint/index 복원, rename의 전체 preview를
  만든다.
- MySQL implicit commit 가능성을 preview와 approval에 표시한다.
- MongoDB schema/index mutation은 relational DDL IR에 억지로 넣지 않고 별도 typed
  operation이 설계되기 전까지 차단한다.
- BigQuery는 DDL IR, manual transaction, row editor, import를 노출하지 않는다. 모든
  query는 로컬 공식 `bq` CLI에서 server dry-run을 통과하고 연결별 과금 바이트 상한을
  만족한 `SELECT`일 때만 실행한다.
