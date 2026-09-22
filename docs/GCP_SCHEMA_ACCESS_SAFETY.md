# 관리형 연결과 기존 애플리케이션 접근 보존

연결·재연결·가져오기·복구·자격 증명 발급/회수·연결 해제는 기존 서버의 접근 권한을
마이그레이션하는 작업이 아니다. 기존 사용자, membership, 비밀번호, PUBLIC/공유 role
ACL, 객체 소유권, 애플리케이션 기본 권한은 보존한다. 연결 승인으로 이 경계를
넘지 않으며, 안전하게 진행할 수 없으면 구체적인 원인으로 중단한다.

## GCP 자동 구성

PostgreSQL 14 이상에서 현재 정책 세대에 고정된 DopeDB 전용 read/write 서비스 계정을
생성한다. 이전 정책 세대의 계정과 신뢰 항목은 수정하거나 삭제하지 않는다.
새 IAM DB 사용자 생성 시 `pg_read_all_data`, 쓰기 계정에는 추가로
`pg_write_all_data`를 지정한다. 이 역할은 앞으로 생성되는 스키마와 테이블에도
적용되므로 애플리케이션의 owner/default ACL을 수정할 필요가 없다. RLS를 우회하지
않으며 DB CONNECT가 제한된 DB에는 별도의 관리자 검토가 필요하다.

기존 전용 계정은 신뢰 정책 및 DB 역할이 정확히 일치하는지만 읽어 검증한다.
다른 역할이 있거나 필요한 역할이 없으면 PUT/REVOKE/권한 정규화 없이 중단한다.
사용자가 로그인한 기존 IAM DB 사용자를 임시 관리자로 승격하거나 그 역할을
회수하지 않는다. Data API 활성화와 권한 설정 SQL 경로도 사용하지 않는다.

일반 연결·복구는 schema principal을 새로 구성하지 않는다. 별도 스키마 설정에서
관리자가 DB와 기존 마이그레이션 owner 역할을 지정하고 위임을 승인하면, 그 대상에
고정된 새 IAM 로그인만 만든다. Cloud SQL users.insert의 databaseRoles로 owner
역할을 새 로그인에 부여하며 기존 role membership·소유권·ACL은 재작성하지 않는다.
반복 복구는 저장된 위임을 유지하며 다른 owner를 선택하면 다른 principal을 만든다.

Desktop은 모든 물리 접속에서 SET ROLE로 승인된 owner를 선택하고 권한을 검증한다.
객체는 계속 기존 owner가 소유하며 새 객체에도 그 owner의 기존 기본 권한이 적용된다.
앱이 owner를 상속하는 기존 membership은 허용하되, 새 로그인에 대한 inbound
membership, ADMIN OPTION, 관리자/다른 역할 상속은 거부한다. 기존 정책과 같이
public 밖 접근, DB CREATE/TEMP, grant option, 다른 객체 owner, PUBLIC 함수 실행과
함수 기본 EXECUTE 권한은 차단한다. 이 검사를 만족하지 못하는 DB는 기존 ACL을
자동 수정하지 않고 실패한 검사 이름을 표시한다. 이 경로는 모든 임의 DB의 자동
권한 마이그레이션을 의미하지 않는다. 이전 schema credential도 같은 엄격한 정책을
사용하며 위임 정보가 없으면 로그인 자신이 owner여야 한다.

새 lease 계약 access-v6는 schemaOwner를 GCP PostgreSQL schema lease에만 허용한다.
access-v5의 읽기/데이터 변경 및 기존 schema lease는 유지하지만 새 위임 schema
요청은 자격 증명 발급 전에 426으로 차단하여 Desktop 업데이트를 요구한다. 스키마 관리 권한을
확보하기 위해 기존 객체를 인수하거나 PUBLIC 권한을 회수하지 않는다. 기존
PostgreSQL/MySQL 중 안전한 자동 구성이 없는 엔진은 외부 변경 전에 중단하고
member-local 자격 증명 연결을 안내한다.

이전 버전이 남긴 복구 journal은 관리자 검토를 위한 증거로 보존한다. 재연결로
기존 사용자 권한을 추정해 복원하거나 사용자를 삭제하지 않는다.

## 다른 공급자에도 적용되는 경계

Neon preflight에서 PUBLIC 접근을 바꿔야 하면 실행 가능한 변경안이 아니라 blocker로
반환한다. 스키마 자격 증명 발급은 이미 준비된 owner를 검증하며 기존 객체 소유권이나
기존 사용자 membership을 자동 변경하지 않는다. 데이터 lease는 새 DopeDB 임시 role의
직접 GRANT만 구성하고, 기존 생성 역할의 기본 권한은 발급/회수 모두에서 바꾸지 않는다.
따라서 해당 lease가 발급된 뒤 만들어진 객체는 다음 lease에서 다시 확인해야 한다.
복제한 브랜치의 기존 role도 이름만 보고 비밀번호를 지우거나 세션을 종료하지 않는다.
이전 자격 증명 흔적이 있으면 관리자가 별도 확인할 때까지 관리형 접근을 차단한다.

임시 lease가 직접 만든 객체의 정리와 명시적으로 요청한 DDL은 연결 과정의 기존
애플리케이션 객체 인수와 구별한다. prefix만으로 소유권을 추정하지 않는다.

## 이미 영향을 받은 DB

실제 서버 계정의 변경 이력과 원래 객체 생성 역할을 별도로 확인해야 한다. 현재
catalog만 보고 원래 owner나 기본 ACL을 추정해 복원하지 않는다. 기존 테이블,
향후 스키마/테이블, sequence, 함수 실행, RLS, migration DDL, 다른 소비자까지
검토한 명시적인 관리자 작업으로만 복구한다.

## 검증

`pnpm --dir workspace-cloud test:contracts`는 기존 역할/신뢰 충돌에서 mutation이
발생하지 않는지, 새 DB 사용자만 생성 시 필요한 역할을 받는지, 반복 연결이 기존
역할을 재작성하지 않는지, 복구 journal로 사용자 변경을 시작하지 않는지 확인한다.

`PG_BIN=/path/to/postgresql/bin node scripts/test-gcp-schema-policy.mjs`는 실제 역할
선택 함수를 사용해 격리 PostgreSQL cluster에서 기존 owner·RLS·ACL·기본 권한·
membership 보존, 기존 및 새 스키마의 서버 읽기/쓰기, 관리형 read/write 권한 구분을
검증한다. 실제 Cloud SQL API와 사용자 OAuth→Desktop 연결 성공은 별도 운영 검증이다.

`PG_BIN`은 서버 프로그램(`initdb`, `pg_ctl`, `psql`)이 포함된 PostgreSQL 설치의
bindir을 가리켜야 한다. conda/anaconda의 `postgresql` 패키지처럼 `pg_config`와
`psql`만 있고 서버 바이너리가 없는 libpq 전용 client 배포판은 사용할 수 없으며,
스크립트는 이를 실행 전에 감지해 중단한다. 서버가 포함된 설치에서
`PG_BIN="$(pg_config --bindir)" node scripts/test-gcp-schema-policy.mjs`로 실행한다.
최소 버전은 PostgreSQL 14다. 이 스크립트가 부여하는 `pg_read_all_data`·
`pg_write_all_data`가 PostgreSQL 14부터 추가된 predefined role이라 `gcpConnectionDatabaseRoles`가
이미 이 버전 미만을 거부하며, 스크립트도 실행 전에 같은 기준으로 서버 버전을 확인한다.

근거: [Cloud SQL IAM 사용자 역할 지정](https://docs.cloud.google.com/sql/docs/postgres/add-manage-iam-users),
[PostgreSQL predefined roles](https://www.postgresql.org/docs/current/predefined-roles.html).

## 데이터 접근과 스키마 접근의 표시

연결 목록은 비밀값이 아닌 `schemaAccessAvailable`을 반환한다. GCP에서는 활성
integration의 DB에 고정된 `cloudsql.schema:<encoded database>` scope (이전 전용
계정은 `cloudsql.schema`), PostgreSQL 엔진, 쓰기 가능한 managed
resource가 함께 있어야 true다. Desktop은 누락된 값과 이전 로컬 캐시를 false로
처리하며, 값이 회수되면 기존 기기의 DDL opt-in도 해제한다. 이 값은 설정 여부의
표시이며 매 발급 시 수행하는 IAM·DB owner 검증을 대신하지 않는다.

데이터 전용 연결에서 DDL을 요청하면 별도 검증된 schema credential이 필요하다는
구체적인 제한을 반환한다. 이 상황을 연결 장애로 분류하거나 재연결로 스키마 권한을
만들 수 있다고 안내하지 않는다. 읽기와 허용된 데이터 변경은 그대로 사용할 수 있다.
과거 schema 계정이 객체를 소유한다는 사실만으로 그 계정을 다시 사용하지 않는다.
기존 서버가 상속하는 owner는 관리자가 새 로그인에 명시적으로 위임할 수 있지만,
다른 객체 owner나 안전하지 않은 기본 권한은 별도 DB 관리자 검토가 필요하다.
