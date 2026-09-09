# GCP PostgreSQL 스키마 설정과 기존 서버 접근

Cloud SQL 연결·복구는 애플리케이션 소유권 마이그레이션이 아니다. 설정 SQL은
이미 격리된 DopeDB 스키마 owner의 권한만 구성한다.

## 자동 설정의 경계

- 모든 대상 DB에서 먼저 읽기 전용 사전 검사를 한다. 하나라도 충돌하면 어느
  DB에도 스키마 정책을 설치하지 않는다. 임시 설정 계정과 Data API의 기존
  정리 경로는 실패 시에도 유지한다.
- `public`의 비확장 객체에 다른 owner가 있으면 중단한다. 테이블·시퀀스·뷰·
  materialized view·함수·타입을 `ALTER … OWNER TO`로 자동 인수하지 않는다.
- 기존 `PUBLIC`의 DB `CREATE`/`TEMPORARY`, schema `CREATE`, 관리형 owner의
  기존 함수 `EXECUTE`를 회수하지 않는다. 이 권한이 스키마 격리 정책과 충돌하면
  서버 접근을 바꾸는 대신 설정을 중단한다.
- 실제 정책 transaction 안에서도 사전 검사를 반복한다. 이미 검토된 owner에
  설정한 서버 역할의 객체 GRANT와 기본 권한은 복구를 반복해도 유지한다.
- Desktop의 정확한 owner·membership·PUBLIC 실행 권한 검사는 유지한다.
  충돌하는 기존 DB는 연결·복구 완료로 보고하지 않는다. 이 변경은 기존 DB의
  DDL 지원을 자동 마이그레이션으로 해결하지 않는다.

기존 owner를 바꾸면 단순한 DML 권한뿐 아니라 DDL 권한, RLS owner 예외,
`SECURITY DEFINER` 함수와 뷰의 실행 권한도 달라질 수 있다. 따라서 기존 역할을
추측해 일괄 GRANT하거나 스키마 owner의 member로 만드는 방식은 사용하지 않는다.

## 이미 영향을 받은 DB의 복구

관리자는 먼저 정확한 provider project·instance·database·접속 계정을 확인한다.
기존 소유권은 현재 catalog만으로 원래 owner를 복원할 수 없으므로 변경 기록과
애플리케이션 migration 역할을 별도로 확인해야 한다.

서버 데이터 접근 복구는 다음 범위를 따로 검토한다.

1. 해당 서버 역할의 기존 테이블 DML, 시퀀스 사용, 실제 사용하는 함수 실행 권한.
2. **실제 객체 생성 역할**의 `public` 기본 권한: 테이블 DML, 시퀀스 사용,
   필요한 함수 실행. 서버 역할 자체의 기본 권한만 설정해도 다른 역할이 만드는
   객체에는 적용되지 않는다.
3. 기존 RLS, 함수·뷰 실행 문맥, migration의 ALTER/DROP, readonly 역할 및 CDC 등
   다른 소비자. DML GRANT 성공을 이들의 복구 완료로 간주하지 않는다.
4. transaction 안에서 필요한 객체에만 변경하고, 서버 자격 증명으로 사후 검증한다.
   향후 객체의 권한은 격리 DB에서 동일 생성 역할과 서버 역할로 검증한다.

원래 owner로 돌려야 하는 경우에는 Desktop의 owner 정책까지 포함한 별도 검토가
필요하다. 서버를 스키마 owner의 member로 만들거나 runtime 검증을 완화하지 않는다.

## 회귀 검증

`node scripts/test-gcp-schema-policy.mjs`는 실제 production SQL 생성기를 사용해
로컬 PostgreSQL cluster를 만들고 종료·삭제한다. PostgreSQL 16 이상과 Node 24가
필요하며, 바이너리가 PATH에 없으면 `PG_BIN`으로 bin 디렉터리를 지정한다.

- 거부된 설정 전후의 객체 owner·ACL·기본 권한·RLS가 동일한지 비교한다.
- 기존 서버의 DDL과 SECURITY DEFINER 함수 호출이 유지되는지 확인한다.
- 기존 PUBLIC 접근을 설정이 회수하지 않는지 확인한다.
- 사전 검토된 schema owner의 반복 설정 후에도 기존 및 새 객체의 실제 서버
  INSERT/UPDATE/SELECT/DELETE, sequence와 함수 접근이 작동하는지 확인한다.
- 관련 없는 역할에 새 권한이나 schema-owner membership이 생기지 않는지 확인한다.

Workspace 계약 테스트는 뒤쪽 DB의 충돌이 앞쪽 DB의 정책 설치보다 먼저 검출되는지
검증한다. 이 테스트는 클라우드 계정이나 실제 DB를 사용하지 않는다.

PostgreSQL의 [기본 권한](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html),
[행 보안](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html) 계약을 따른다.
