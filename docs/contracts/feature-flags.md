# Desktop feature activation

Desktop에는 공통 platform rollout flag 레지스트리가 없다. CLI, Local Broker,
SQL 문서, Catalog, Jobs, ACP plugin의 사용 가능 여부는 각 기능의 구현,
설치 상태와 권한 검사로 결정한다. 제품 범위는
[`PRODUCT_UI_SCOPE.md`](../PRODUCT_UI_SCOPE.md)가 소유한다.

Workspace의 환경 설정은
[`workspace_feature_enabled`](../../src-tauri/src/features/workspaces/domain.rs)가
정의한다. `DOPEDB_WORKSPACES_ENABLED`는 기본 활성화이며, 공백을 제거하고
소문자로 변환한 값이 `0`, `false`, `off`이면 비활성화한다.
이 설정은 Desktop 프로세스 환경에서 읽으며 request field나 Agent/Plugin이
변경할 수 없다. 활성화는 계정 인증, workspace 역할, exact resource grant를
대신하지 않는다.

로컬 저장소는 단일 MVP 기준선만 지원한다. 과거 개발 스키마나 Catalog wire를
되살리는 호환 경로는 제공하지 않는다.
