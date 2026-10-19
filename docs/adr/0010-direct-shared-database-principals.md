# ADR 0010: Direct shared database with per-member principals

- 상태: Accepted
- 결정일: 2026-10-20
- 관련: [`PRODUCT_UI_SCOPE.md`](../PRODUCT_UI_SCOPE.md) PD-16, PD-18, PD-46, PD-49,
  [ADR 0009](0009-desktop-workspace-administration.md),
  [`GCP_SCHEMA_ACCESS_SAFETY.md`](../GCP_SCHEMA_ACCESS_SAFETY.md)

## 배경

공급자 API가 없는 PostgreSQL·MySQL 서버는 지금까지 member-local template으로만
공유할 수 있었다. 관리자가 구성원마다 DB 계정을 손으로 만들고 비밀번호를 따로
전달해야 했고, 공용 static 비밀번호 배포는 PD-18이 금지한다. 서버 쪽 envelope
암호화(Workspace KMS, `WORKSPACE_CREDENTIAL_KEY`)는 Worker 운영자가 복호화할 수
있으므로 "운영자도 읽을 수 없는" 보관에 쓸 수 없다.

## 결정

1. **신뢰 경계.** 관리자 DB 자격 증명은 그것을 입력한 관리자 기기의 OS credential
   store에만 저장한다. debug 파일 fallback이 없는 별도 vault를 쓴다. control plane은
   host·port·DB·TLS 모드·공유 범위와 구성원 password verifier만 받는다. 평문
   비밀번호, 관리자 자격 증명, 연결 URL은 서버, 감사 기록, 로그 어디에도 남지 않는다.
2. **구성원 비밀번호.** 구성원 Desktop이 강한 임의 비밀번호를 만들어 자기 OS
   credential store에 두고 PostgreSQL SCRAM-SHA-256 verifier
   (`SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>`) 또는 MySQL
   `caching_sha2_password` 인증 문자열(`$A$005$` + 20바이트 salt + sha256-crypt 5000
   rounds)만 올린다. 관리자 기기는 이 값을 `CREATE ROLE ... PASSWORD '<verifier>'`,
   `CREATE USER ... IDENTIFIED WITH caching_sha2_password AS '<auth string>'`에
   그대로 쓴다. 누구도 다른 구성원의 비밀번호를 알 수 없다.
3. **권한 동기화.** principal의 DB 권한은 기존 권한 모델이 계산한 연결별 실효 접근
   (`workspace_connection_grant`, 역할, 팀 읽기 기본값, 쓰기 허용)을 그대로 따른다.
   없음·보기는 principal 없음, 읽기는 공유 범위의 CONNECT·USAGE·SELECT, 쓰기와
   관리는 INSERT·UPDATE·DELETE(PostgreSQL은 sequence USAGE 포함)이며 DDL은 없다.
   desired 상태는 저장하지 않고 work 조회 시점에 grant·member·connection에서
   계산한다. principal 기록은 member에 FK를 걸지 않아 구성원이 삭제돼도 회수 근거가
   남는다.
4. **소유권 증명.** principal 이름은 서버가 만든 비추측 값(`dopedb_` + 임의 hex)이다.
   수정·삭제 전에 control plane receipt, DB 쪽 marker(PostgreSQL `COMMENT ON ROLE`,
   MySQL user `ATTRIBUTE`), PostgreSQL role oid 또는 MySQL `@@server_uuid`가 모두
   일치해야 한다. PostgreSQL에서 principal이 객체를 소유하거나 예상 밖 membership이
   있으면 `DROP OWNED` 없이 멈추고 구체 진단을 낸다. 이름 prefix만으로 소유를
   추정하지 않는다.
5. **만료 없음, 행위 시점 회수.** principal은 만료되지 않는다. 구성원 제거·강퇴,
   권한 하향·제거, 역할 하향으로 실효 접근이 줄어드는 경우, 팀 읽기 해제, 공유 DB
   삭제는 관리자 Desktop에서 일어난다. 그 기기의 Rust `RevocationCoordinator`가 서버
   revocation gate를 claim하고, DB 쪽 REVOKE·DROP과 해당 principal 세션 종료
   (PostgreSQL `pg_terminate_backend`, MySQL `KILL CONNECTION`)를 먼저 성공시킨 뒤
   receipt를 올린다. 서버는 receipt가 확인될 때만 grant 변경을 확정한다. 서버가 DB보다
   먼저 "권한 없음"을 주장하지 않는다.
6. **자격 증명이 없는 기기.** 행위 기기에 그 DB의 관리자 자격 증명이 없으면 행위를
   진행하지 않고 경고한다. 관리자는 자격 증명을 입력하거나(키체인 저장 선택),
   보유 기기에서 적용하도록 `회수 대기` 항목을 남긴다. 그동안 서버 grant는 유지되어
   접근이 남아 있음을 화면에 명시한다. 구성원 자가 탈퇴와 계정 삭제는 관리자 행위가
   아니므로 다음 관리자 기기 동기화에서 처리하고 대기로 표시한다.
7. **PostgreSQL 새 테이블 한계.** 기존 role의 `DEFAULT PRIVILEGES`를 바꾸지 않는다.
   그래서 공유 범위에 새로 생긴 테이블은 관리자 기기의 주기 재부여(새 principal에
   대한 GRANT 추가) 뒤에 보인다. MySQL은 `db.*` 권한이라 해당하지 않는다.
   `pg_read_all_data` 같은 전역 역할은 공유 범위를 지킬 수 없어 쓰지 않는다.
8. **wire 호환.** 독립 배포된 이전 Desktop이 깨지지 않도록 `credentialMode`는
   `member_local`을 유지하고 additive `provisioning` 필드로 구분한다. D1 CHECK 제약을
   바꾸는 테이블 재생성을 피하려고 `provisioning_mode` 컬럼과
   `workspace_direct_endpoint`(쓰기 상한 포함), `workspace_direct_principal`,
   `workspace_direct_revocation` 테이블을 추가한다.
9. **권한 편집 UI 단일화.** 구성원별 공유 DB 권한은 `워크스페이스 관리 → 구성원`에서만
   편집한다. `DB 접근 권한` section의 구성원별 grant 편집은 삭제하고 DB 단위 설정만
   남긴다. 이 결정은 직접 연결뿐 아니라 모든 공유 DB에 적용된다.
10. **새 feature slice.** Rust `features/direct_access`가 verifier 생성, preflight, plan,
    worker, revocation coordinator를 소유한다. `providers/provisioning`의
    `ProvisioningDriver`는 공급자 API 전제의 durable operation 모델이라 재사용하지 않는다.

## 범위 밖

MariaDB(인증 plugin과 user attribute 차이), SQLite·기타 엔진, 공용 static 비밀번호,
자동 DDL 권한, schema lease, 서버가 비밀번호를 생성하는 방식(평문이 서버를 지남),
만료 기반 회수 완화.

## 결과와 위험

- 관리자 기기가 꺼져 있으면 새 구성원의 principal 생성과 자가 탈퇴 회수가 늦어진다.
  화면은 대기 상태와 마지막 동기화 시각을 보여 준다.
- 관리자 기기나 관리자 자격 증명을 잃으면 서버에서 복구할 수 없다. 관리자는 DB
  관리자 비밀번호를 바꾸고 다른 기기에서 다시 입력한다.
- 새 principal은 PUBLIC 권한을 상속한다. PostgreSQL 14 이하의 `public` schema
  CREATE 같은 경우 preflight가 경고하며, DDL 차단은 Desktop 정책에도 의존한다.
- TLS `require`는 경고와 함께 허용한다. 서버 신원을 검증하지 않으므로 관리자
  자격 증명이 오가는 구간이 중간자에 노출될 수 있음을 경고 문구에 적는다.

## 검증

Docker PostgreSQL 16·MySQL 8.4 로컬 스크립트가 provision·권한 변경·회수·실패한
provision 뒤에 기존 role, membership, ACL, default privileges, 소유권 스냅샷이
새 principal 항목을 빼고 변하지 않았는지 비교한다. control plane harness와 Rust
domain 계약 테스트가 verifier 형식, desired 계산, 소유권 증명 거부, 회수 순서를
검사한다.

`node scripts/test-direct-provisioning.mjs`가 그 스크립트다. Docker만 필요하며
(`colima` 등) 무작위 loopback 포트와 생성한 비밀번호로 두 컨테이너를 띄우고
끝나면 `docker rm -f`로 지운다. 기능 플래그 `direct-access-e2e`의 example
(`src-tauri/examples/direct_access_e2e.rs`, 프로덕션 빌드에는 컴파일되지 않음)가
실제 planner·verifier·소유권 증명·`SqlxTargetDatabase`를 구동하고, 스크립트는 기존
애플리케이션 seed(PUBLIC ACL, default privileges, CREATEROLE/CREATE USER 관리자)
위에서 preflight, 읽기→쓰기→읽기 변경과 PostgreSQL 재부여, 비밀번호 회전, 열린
세션 종료를 동반한 회수, 마커·oid·membership·소유 객체 거부, 실패한 provision을
검사하고 PASS/FAIL 표를 낸다. 알려진 동작 차이 세 가지는 다음과 같다.

- MySQL 관리자에게 `PROCESS`와 `CONNECTION_ADMIN`(또는 `SUPER`)이 없으면 회수 뒤에도
  구성원의 열린 연결이 로그인 시 캐시된 DB 권한으로 남는다. 계정은 잠그고 삭제하므로
  새 로그인은 막히지만 즉시 끊기려면 두 권한이 필요하다.
- MySQL에서 다른 계정의 grant 목록은 `mysql` 스키마 SELECT가 있어야 읽힌다. 읽을 수
  없으면 membership 검사는 건너뛰고 마커와 서버 신원으로만 소유를 증명한다.
- PostgreSQL CREATEROLE 관리자는 만든 role에 ADMIN OPTION만 가지므로 세션 종료 동안만
  principal의 membership을 빌렸다가 되돌린다.
