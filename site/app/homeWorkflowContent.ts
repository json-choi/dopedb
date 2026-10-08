// Bilingual workflow descriptions own the public scenario copy, not execution receipts.
import type { Lang } from "./homeContent";

type Workflow = {
  readonly id: string;
  readonly task: string;
  readonly problem: string;
  readonly title: string;
  readonly steps: readonly [string, string, string];
  readonly benefit: string;
  readonly prerequisite: string;
};

type WorkflowCopy = {
  readonly label: string;
  readonly title: string;
  readonly introduction: string;
  readonly result: string;
  readonly requires: string;
  readonly notice: string;
  readonly evidenceLink: string;
  readonly items: readonly Workflow[];
};

export const workflowCopy: Readonly<Record<Lang, WorkflowCopy>> = {
  en: {
    label: "TEAM WORKFLOWS / ALPHA",
    title: "Connect a teammate. Find the cause. Share the analysis.",
    introduction: "From the first database read to an explanation your team can revisit. Three workflows to evaluate with your own access.",
    result: "What you gain",
    requires: "Before you start",
    notice: "Workflow descriptions, not recorded runs. Packaged two-member validation and actual workflow captures are still pending.",
    evidenceLink: "See the validation plan",
    items: [
      {
        id: "team-access",
        task: "ONBOARD A TEAMMATE",
        problem: "Another teammate joins. Another provider login, connection setup, and password handoff?",
        title: "Share the connection. Give each member their own access.",
        steps: ["An administrator registers a supported managed database and sets team access.", "The teammate signs in to DopeDB and opens the shared connection in Desktop.", "Desktop obtains an expiring member-specific credential for a local read."],
        benefit: "The teammate uses the shared access path without receiving the administrator’s provider key or a shared DB password.",
        prerequisite: "DopeDB sign-in and a database use grant are required. Supported managed providers include Neon, PlanetScale, and GCP Cloud SQL. Member-local and BigQuery connections still need each member’s own authentication.",
      },
      {
        id: "code-and-data",
        task: "INVESTIGATE A MISSING ORDER",
        problem: "An order is missing from a report. You keep switching between application code and database queries.",
        title: "Ask one question with the code and database selected.",
        steps: ["In one Project, explicitly select a GitHub source revision and the database.", "Ask Codex or Claude to investigate why the sample order is missing from the report.", "Review the source-file and query evidence behind the explanation."],
        benefit: "Follow the cause back to code and real database context, rather than guessing from an isolated query.",
        prerequisite: "Your official local Agent CLI must be installed and signed in. The session can only reach selected resources. Reads stay scoped to each database; selecting resources does not create automatic cross-database joins.",
      },
      {
        id: "share-analysis",
        task: "SHARE AN ORDER-CONVERSION ANALYSIS",
        problem: "Funnel definitions, findings, and SQL are scattered across chat messages. Teammates cannot easily check the same analysis.",
        title: "Keep the explanation and one query in an Article.",
        steps: ["Ask the Agent to explain the order-conversion stages and findings in an Analysis Article.", "Share the internal link with workspace teammates who have access to its database.", "An authorized teammate opens the same Article and manually reruns its saved read-only query in Desktop."],
        benefit: "Your team reads the same sanitized HTML and exact query definition. Each member’s rerun result rows remain local.",
        prerequisite: "Reading requires workspace membership and the database grant; rerunning also requires use permission and individual DB access. The funnel is the Article’s subject, not a builder. Rerunning does not automatically refresh the Article’s HTML or charts.",
      },
    ],
  },
  ko: {
    label: "팀의 작업 흐름 / ALPHA",
    title: "팀원을 연결하고, 원인을 찾고, 분석을 공유하세요.",
    introduction: "첫 DB 조회부터 팀이 다시 확인할 수 있는 설명까지. 각자의 접근 권한으로 검토할 세 가지 작업 흐름입니다.",
    result: "얻는 결과",
    requires: "시작에 필요한 것",
    notice: "실행 기록이 아닌 작업 흐름 설명입니다. 패키지 앱의 두 구성원 검증과 실제 시나리오 캡처는 아직 진행 전입니다.",
    evidenceLink: "검증 계획 보기",
    items: [
      {
        id: "team-access",
        task: "새 팀원의 첫 DB 접근",
        problem: "팀원이 늘 때마다 프로바이더 로그인과 접속 설정을 반복하고, 비밀번호를 따로 전달하고 있나요?",
        title: "연결은 함께 쓰고, 접근 권한은 각자 받으세요.",
        steps: ["관리자가 지원되는 관리형 DB를 등록하고 팀 접근을 설정합니다.", "팀원이 DopeDB에 로그인하고 Desktop에서 공유 연결을 엽니다.", "Desktop이 만료되는 구성원별 인증정보를 받아 로컬에서 조회합니다."],
        benefit: "팀원에게 관리자의 프로바이더 키나 공용 DB 비밀번호를 전달하지 않고 같은 접근 경로를 제공합니다.",
        prerequisite: "DopeDB 로그인과 DB 사용 권한이 필요합니다. Neon, PlanetScale, GCP Cloud SQL 등 지원 관리형 프로바이더에 해당합니다. 개인 로컬 연결과 BigQuery는 각 구성원의 인증이 필요합니다.",
      },
      {
        id: "code-and-data",
        task: "보고서에서 빠진 주문 조사",
        problem: "주문 하나가 보고서에 없습니다. 원인을 찾으려 코드와 DB 쿼리를 번갈아 확인하고 있나요?",
        title: "코드와 DB를 직접 고르고, 한 질문으로 조사하세요.",
        steps: ["한 프로젝트에서 GitHub 소스 리비전과 DB를 명시적으로 선택합니다.", "Codex나 Claude에게 샘플 주문이 보고서에서 빠진 이유를 조사해 달라고 요청합니다.", "설명을 뒷받침하는 소스 파일과 쿼리 근거를 검토합니다."],
        benefit: "쿼리 하나만 보고 추측하는 대신, 실제 코드와 DB 맥락을 함께 확인하며 원인을 좁힙니다.",
        prerequisite: "공식 로컬 Agent CLI 설치와 로그인이 필요합니다. 세션은 선택한 리소스에만 접근합니다. 조회는 DB별로 실행하며, 리소스 선택이 자동 교차 DB 조인을 만들지는 않습니다.",
      },
      {
        id: "share-analysis",
        task: "주문 전환 퍼널 분석 공유",
        problem: "퍼널 정의와 발견 내용, SQL이 대화에 흩어져 있습니다. 팀원이 같은 분석을 확인하기 어렵나요?",
        title: "설명과 쿼리 하나를 아티클로 함께 남기세요.",
        steps: ["Agent에게 주문 전환 단계와 발견 내용을 Analysis Article로 정리해 달라고 요청합니다.", "해당 DB에 접근할 수 있는 워크스페이스 팀원에게 내부 링크를 공유합니다.", "권한 있는 팀원이 같은 아티클을 열고 Desktop에서 저장된 읽기 전용 쿼리를 수동 재조회합니다."],
        benefit: "팀은 같은 정제된 HTML과 정확한 쿼리 정의를 읽습니다. 각자의 재조회 결과 행은 로컬에 남습니다.",
        prerequisite: "열람에는 워크스페이스 참여와 DB 권한이, 재조회에는 사용 권한과 개인별 DB 접근이 필요합니다. 퍼널은 아티클의 분석 주제입니다. 재조회가 본문이나 차트를 자동 갱신하지는 않습니다.",
      },
    ],
  },
};
