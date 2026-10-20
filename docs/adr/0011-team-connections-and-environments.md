# ADR 0011: 팀 연결 모델과 환경 고정 목록

- 상태: Accepted
- 결정일: 2026-10-20
- 관련: [`PRODUCT_UI_SCOPE.md`](../PRODUCT_UI_SCOPE.md) PD-16, PD-18, PD-46, PD-49,
  PD-50, PD-51,
  [ADR 0009](0009-desktop-workspace-administration.md),
  [ADR 0010](0010-direct-shared-database-principals.md)

## 배경

- 환경 개념이 둘로 갈라져 있었다. 2026-08-11(c8d4431e)부터 Project 환경(이름 +
  위험 등급)과 연결 자체의 환경 라벨이 따로 존재했다. 변경 작업의 PROD 확인은
  연결 profile의 `env`만 읽었으므로 운영 환경에 묶인 DB도 연결 라벨이 비어 있으면
  확인을 건너뛸 수 있었다. 자유 입력 이름과 위험 등급은 서로 어긋날 수 있었다.
- 팀 workspace에 연결을 올리는 길이 여럿이었다. 연결 편집기, `공유 DB 추가`(카탈로그
  메뉴·클라우드 안내·워크스페이스 관리), 공유 데이터베이스 목록, `워크스페이스로
  복사`, 별도 `팀 읽기` switch가 같은 목적을 다른 화면에서 각각 소유했고, member-local
  방식의 공유 연결은 읽기 전용으로 강제되었다. 사용자는 "공유 DB"와 "내 연결"의
  차이를 이해해야 했다.

## 결정

1. **환경은 고정 목록의 값 하나다.** `개발`(development), `스테이징`(staging),
   `운영`(production), `테스트`(test) 중 고른 값이 곧 환경 이름이다. Project당 종류별
   환경은 하나다. 자유 입력 이름, 별도 위험 등급(riskClass), `custom`은 없다.
2. **유효 환경.** 연결의 유효 환경은 묶인 Project 환경들의 종류와 연결 자체 표시
   중 `운영 > 스테이징 > 테스트 > 개발` 순으로 가장 민감한 값이다. 연결 자체 표시는
   연결 편집기의 선택 사항 환경 select(같은 4개 값)이며, 개발 환경에만 묶였더라도
   운영으로 표시한 연결은 운영으로 남는다.
3. **운영 안전은 유효 환경에서만 파생한다.** 변경 작업의 PROD 확인, 운영 주의
   표시, 저장 스냅샷 게시 차단은 유효 환경만 본다. `운영` 환경 생성(새 Project의 첫
   환경 포함)은 명시적 확인을 받는다. provider 가져오기는 별도 `운영인가` 질문 대신
   같은 환경 select를 묻는다.
4. **팀 workspace의 모든 연결은 팀 연결이다.** 별도 `공유 DB` 개념과 관리 흐름은 없다.
   입구는 연결 편집기(`새 연결`·데이터 소스 선택기) 하나이며, 저장이 secret-free
   workspace 연결과 만든 사람의 로컬 자격 증명 binding을 함께 만든다. editor 이상
   역할이 만들 수 있다.
5. **기본 접근과 이후 변경.** 새 팀 연결의 기본 접근은 analyst 이상 팀 전체 읽기다.
   별도 `팀 읽기` switch는 제거하고 이후 구성원별 변경은 `워크스페이스 관리 → 구성원`
   에서만 한다.
6. **자격 증명 방식은 연결 속성이다.** 각 구성원이 자기 계정을 binding하는
   member-local, 공급자 계정(`공급자`에서 연결)의 단기 managed 자격 증명, 구성원별
   DopeDB 계정 자동 생성(ADR 0010의 direct mode) 중 연결 편집기에서 고른다. ADR 0010의
   신뢰 경계·소유권 증명·회수 규칙은 그대로이며 진입점만 별도 추가 흐름에서 이 속성으로
   바뀐다.
7. **쓰기는 방식과 무관하다.** 쓰기 가능 여부는 구성원 권한과 쓰기 승인을 따른다.
   member-local 팀 연결도 더 이상 읽기 전용으로 강제하지 않는다.
8. **제거되는 개념.** `공유 DB 추가`(카탈로그 메뉴, 클라우드 안내, 워크스페이스
   관리), 별도 공유 데이터베이스 목록(Explorer가 유일한 연결 목록), `워크스페이스로
   복사`, `팀 읽기` switch. `공급자`는 공급자 계정 연결·재승인과 managed 연결 복구만
   남긴다.
9. **환경 배치는 editor 이상이다.** Project 환경에 연결을 묶거나 푸는 일(환경 binding)은 `write` 권한(editor 이상)이 하므로 연결을 만든 구성원이 직접 배치한다. Project·환경 자체의 생성과 구성원 권한 관리는 계속 admin 이상이다.
10. **불변 조건.** 장기 비밀값은 공유 레코드를 따라가지 않는다. 기존 DB principal,
   role membership, 권한은 바꾸지 않는다. 개인 workspace는 변하지 않는다.

## 이전

- **환경 정규화.** 기존 환경은 environment id를 유지한 채 가장 가까운 종류로
  바꾼다. 운영 flag 또는 `production` 등급이면 `운영`, `staging`·`test`는 그대로,
  `custom`과 자유 이름은 `개발`로 이전한다. 같은 Project에서 종류가 겹치면 **id가
  가장 낮은 행**이 그 종류를 소유하고(Desktop SQLite와 D1이 같은 규칙이라 캐시와
  서버가 어긋나지 않는다) 나머지의 source, binding, head, grant, mapping proposal,
  graph revision, Article은 소유 행으로 옮기며 소유 행의 revision을 찍는다. 빈
  행은 삭제하고 binding은 잃지 않는다. graph revision은 불변이므로 그 update guard를
  이 재지정 동안만 해제한다.
  - Desktop: 테이블을 외래 키를 끈 채 `kind` 스키마로 재작성하고
    `foreign_key_check` 뒤 커밋한다. 연결 라벨은 `prod→production`, `dev→development`,
    그 밖의 값(`custom`)은 없음으로 바꾼다. 이미 이전된 저장소는 읽기만 한다.
  - D1: 테이블 재작성 없이 `kind` 열 추가, 값 이전, 위 병합, `(project_id, kind)`
    unique index와 값 제한 trigger를 쓴다. 바뀐 이름·등급은 감사 기록에 남긴다.
    이전 Desktop을 위해 `name`·`production`·`risk_class` 열은 종류에서 파생해
    유지한다(열 삭제에는 재작성이 필요하다).
- **팀 로컬 승격.** 업데이트 시 팀 workspace의 기존 팀 로컬(`나만`) 연결은 자동으로
  팀 연결로 승격한다. SQLite 파일 연결은 기기 전용이므로 제외하고 로컬에 남기며 UI는
  SQLite 파일은 공유할 수 없다고 알린다. 승격은 연결 편집기의 저장과 같은 코드
  (`publish_connection`)이다.
  - **id 보존.** Desktop이 로컬 연결의 id를 `POST /connections` 본문의 선택 필드 `id`로
    보내고 서버가 그 id로 만든다(전역 유일, 충돌은 409, 같은 생성자의 재시도는 만들어 둔
    연결을 그대로 돌려줘 멱등). 로컬 행은 같은 id로 제자리에서 팀 연결(`remote_id`·
    `synced`)이 되므로 SQL 문서, 기록, Safety, Project 환경 binding, 카탈로그 캐시처럼
    연결 id를 가진 참조는 하나도 옮기거나 복사하지 않는다. 템플릿과 만든 사람의
    credential binding(같은 OS 자격 증명 항목을 가리킨다)은 한 로컬 transaction에서
    함께 반영하고, 실패하면 방금 만든 서버 연결을 삭제한다. 자격 증명은 Keychain에서
    읽거나 복제하지 않는다.
  - **누가·언제.** 연결을 만든 계정의 기기만 자기 행을 승격하고(`account_user_id`가 같은
    행), 멤버십 동기화(시작, 로그인, 창 포커스 갱신, workspace 전환)마다 편집자 이상인
    팀 workspace에서 실행한다. 실패는 연결 단위로 다시 시도한다(네트워크·세션 문제는
    1분 뒤, 서버나 기기가 거절한 연결은 10분 뒤). 결과는 승격 `promoted`, 역할 부족
    `role_denied`, 도달 불가 `unreachable`, 거절 `refused`, 대기 `deferred`의 닫힌 개수로만
    기록하고 연결 이름이나 서버 문구를 남기지 않는다.
- **서버 CHECK는 바꾸지 않는다.** `workspace_connection_member_local_read_only`
  CHECK는 "member-local 템플릿은 쓰기 권한을 위임하지 않는다"는 지금도 참인 불변식이다.
  SQLite는 CHECK를 제자리에서 바꿀 수 없고, 부모 테이블을 다시 만들면(D1은 외래 키를
  항상 강제하므로) `DROP TABLE`의 암묵적 DELETE가 `ON DELETE CASCADE`로 grant,
  principal, revocation, 접근 제외 기록을 지운다(`defer_foreign_keys`는 제약 검사만 미룰
  뿐 cascade는 막지 못한다). 그래서 쓰기를 템플릿 열이 아니라 이미 있는 권한 모델에서
  끌어낸다: member-local 팀 연결의 쓰기는 연결 grant(`use` 이상)와 편집자 이상 역할이
  정하고, 기기 Safety 승인이 문장마다 다시 막는다. 템플릿은 계속 `allowWrites: false`다.
  이 방식은 테이블 재작성이 없으므로 grant, principal, revocation, version을 건드리지
  않는다. D1 migration `0013`은 팀 읽기 trigger 세 개를 관리형·직접 제한 없이 다시
  만들 뿐이다(기본 팀 읽기를 모든 자격 증명 방식에 적용). harness가 migration 전후
  자식 행 개수가 같음을 확인한다.
- **쓰기 판정.** 서버는 응답에 추가 필드 `memberWrite`를 싣는다: member-local(직접 DB
  포함) 연결에서 구성원의 연결 grant와 역할이 쓰기를 허용하고, 직접 DB는 endpoint
  ceiling까지 허용할 때 true. BigQuery, MongoDB, Cloudflare D1은 항상 false다.
  `POST /connections/{id}` 쓰기 preflight도 같은 규칙으로 member-local 쓰기를 허용한다
  (스키마 변경은 관리형 전용). Desktop은 `memberWrite`를 구성원 권한의 상한으로 읽어
  Safety 승인과 함께 적용하고 쓰기 승인·Safety 게이트는 그대로다.
- **권한.** 팀 연결 생성은 편집자 이상(서버 `POST /connections`와 Desktop
  `canAddWorkspaceConnections`, 편집기 저장 전 역할 확인). 직접 DB 등록은 이번 단계에서
  관리자·소유자 전용으로 둔다. 수정·삭제는 기존 grant 모델의 `manage`를 따른다: 만든
  사람과 생성 시점의 모든 관리자·소유자가 명시적 `manage` grant를 받아 연결을 수정·삭제하고
  구성원 접근을 바꿀 수 있다. 이후 관리자가 되는 구성원은 기존 manager가 grant를 올려
  준다. 쓰기 정책(managed `allowWrites`) 변경은 계속 관리자·소유자 전용이다.
- **기본 접근.** 생성과 같은 transaction에서 `team_read_enabled = 1`로 올려 analyst
  이상 `read`, viewer `view` 팀 grant를 만든다(이후 합류하는 구성원에게도 적용). 기존
  연결의 정책은 바꾸지 않는다.

## 호환성

팀 읽기 switch는 UI에서 사라지지만 서버의 `teamReadEnabled` 토글 경로
(`POST .../grants`)는 0.7.0 Desktop을 위해 유지하고, 이제 자격 증명 방식과 무관하게
동작한다. 새 응답 필드 `memberWrite`와 생성 본문의 선택 필드 `id`는 추가 필드라 이전
Desktop은 무시한다. 이전 Desktop은 member-local 연결에서 `allowWrites: true`를 받으면
컬렉션 전체를 거부하므로, 서버는 직접 DB 밖의 member-local 응답에서 `allowWrites`를
계속 false로 보내고 쓰기 허용은 `memberWrite`로만 전한다. 이전 서버를 만난 새
Desktop은 `memberWrite`가 없으면 member-local 연결을 읽기 전용으로 본다.

control plane은 전환 기간 동안 이전 Desktop을 위해 `{name, riskClass}`를 종류로
매핑해 받고(이름은 무시, `custom`은 개발) 응답에 `kind`와 함께 종류에서 파생한
`name`·`riskClass`를 돌려준다. 새 Desktop은 `{kind}`만 보내고 `kind`만 읽는다.
provider 가져오기 요청의 `environment`는 선택 필드이며 없으면 연결 라벨이 비어 있다.
control plane으로 가는 연결 `env`/`environment` 라벨은 D1과 응답에서 이전 토큰(`prod`,
`dev`, `staging`, `test`)을 유지한다. 서버는 두 형태를 모두 받아 이전 토큰으로 저장하고,
Desktop은 경계에서 종류와 토큰을 변환한다(`wire_token`/`parse`). 0.7.0 Desktop은
`env == "prod"`만 확인하므로 새 Desktop이 쓴 운영 라벨에도 PROD 확인을 요구한다.
로컬 SQLite는 종류를 저장한다. 관리 API는 지원 중인 Desktop 버전의 요청·응답 계약을 하위
호환으로 유지한다(PRODUCT_UI_SCOPE). 제거 시점은 지원 중인 Desktop이 모두 새 필드를
쓰게 된 뒤 별도 결정으로 정한다.

## 결과와 위험

- 자동 승격은 이전에 나만 보던 연결의 메타데이터(이름, host, DB 등 secret-free 값)를
  팀에 노출한다. 비밀값은 올라가지 않으며, 기본 접근이 팀 전체 읽기이므로 승격 직후
  구성원 권한을 검토하도록 업데이트 안내에 명시한다.
- PROD 확인이 유효 환경을 기준으로 바뀌므로 운영 환경에 묶인 DB에서 확인 요청이
  이전보다 많아진다. 이는 누락 버그의 수정이다.
- 환경 정규화는 되돌릴 수 없는 이름 손실을 포함한다(자유 이름, custom). 이전 전에
  기존 값을 감사 기록에 남길 수 있는지는 구현에서 확인한다.
- member-local 팀 연결의 쓰기 허용은 구성원 본인 DB 계정의 권한이 최종 상한이다.
  workspace는 쓰기를 위임하지 않고 승인·Safety 경계만 적용한다.

## 검증

- 유효 환경 계산(복수 binding 최대 민감도, 미binding select)과 PROD 확인 회귀
  테스트(운영 binding인데 연결 라벨이 비어 있는 경우 포함).
- 환경 정규화와 팀 로컬 승격 migration을 격리 D1 harness로 검증하고, SQLite 파일
  연결이 승격되지 않음을 확인한다.
- 이전 Desktop의 riskClass 요청·응답 왕복 호환.
- 팀 연결 생성 뒤 기존 서버의 기존·새 스키마 읽기 회귀와 기존 principal 불변 확인.
