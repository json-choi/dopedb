// onboarding messages are owned by this bounded feature catalogue.
import { defineCatalog } from "../types";

export const onboardingCatalog = defineCatalog(
  {
    "onboarding.openWelcome": "Start page",
    "onboarding.cosmicScene": "Interactive space. Drag or use arrow keys to orbit; plus/minus to zoom; Space to pause; 0 to reset.",
    "onboarding.cosmicHint": "Drag to orbit · Scroll to zoom",
    "onboarding.cosmicZoomIn": "Zoom in",
    "onboarding.cosmicZoomOut": "Zoom out",
    "onboarding.cosmicReset": "Reset view",
    "onboarding.cosmicPause": "Pause space animation",
    "onboarding.cosmicPlay": "Play space animation",
    "onboarding.demoAgentReadPrompt":
      "Using only Demo SQLite, compare paid or shipped revenue by month and identify the highest-value customer segment. Show the SQL and keep this read-only.",
    "onboarding.demoAgentWritePrompt":
      "Order 10103 has settled. Propose the exact SQL to change its status from processing to paid, but stop for my approval before executing anything.",
    "onboarding.demoAnalyzeRevenue": "2. Ask Agent to analyze revenue",
    "onboarding.demoBrowseOrders": "1. Browse the sample orders",
    "onboarding.demoEnableWrites": "3. Allow writes for this demo",
    "onboarding.demoEnvironmentMissing":
      "The demo Environment is not ready. Run the guided demo setup again.",
    "onboarding.demoLead":
      "Demo ready. Follow these three real product flows.",
    "onboarding.demoOrdersMissing":
      "The demo orders table could not be found.",
    "onboarding.demoPracticeApproval": "3. Practice an exact write approval",
    "onboarding.demoReady": "Guided demo is ready",
    "onboarding.demoStart": "Explore the guided demo",
    "onboarding.demoStarting": "Preparing guided demo…",
    "onboarding.firstRunLead": "Connect a data source to browse and query it.",
    "onboarding.title": "Welcome to DopeDB",
  },
  {
    "onboarding.openWelcome": "시작 화면",
    "onboarding.cosmicScene": "인터랙티브 우주. 드래그 또는 방향키로 회전, 더하기·빼기로 확대·축소, 스페이스로 정지, 0으로 시점 초기화.",
    "onboarding.cosmicHint": "드래그로 회전 · 휠로 확대",
    "onboarding.cosmicZoomIn": "확대",
    "onboarding.cosmicZoomOut": "축소",
    "onboarding.cosmicReset": "시점 초기화",
    "onboarding.cosmicPause": "우주 움직임 정지",
    "onboarding.cosmicPlay": "우주 움직임 재생",
    "onboarding.demoAgentReadPrompt":
      "Demo SQLite만 사용해서 paid 또는 shipped 주문의 월별 매출을 비교하고, 매출이 가장 큰 고객 segment를 찾아줘. 사용한 SQL을 보여주고 읽기 전용으로 진행해.",
    "onboarding.demoAgentWritePrompt":
      "주문 10103의 결제가 완료됐어. 상태를 processing에서 paid로 바꾸는 정확한 SQL을 제안하되, 어떤 것도 실행하기 전에 내 승인을 기다려.",
    "onboarding.demoAnalyzeRevenue": "2. Agent에게 매출 분석 요청",
    "onboarding.demoBrowseOrders": "1. 샘플 주문 데이터 둘러보기",
    "onboarding.demoEnableWrites": "3. 이 데모의 쓰기 허용",
    "onboarding.demoEnvironmentMissing":
      "데모 Environment가 준비되지 않았습니다. 데모 설정을 다시 실행하세요.",
    "onboarding.demoLead":
      "데모가 준비됐습니다. 실제 제품 흐름 세 가지를 따라 해보세요.",
    "onboarding.demoOrdersMissing":
      "데모 orders 테이블을 찾지 못했습니다.",
    "onboarding.demoPracticeApproval": "3. 정확한 쓰기 승인 체험",
    "onboarding.demoReady": "가이드 데모가 준비됐습니다",
    "onboarding.demoStart": "가이드 데모로 둘러보기",
    "onboarding.demoStarting": "가이드 데모 준비 중…",
    "onboarding.firstRunLead": "데이터 소스를 연결해 탐색과 쿼리를 시작하세요.",
    "onboarding.title": "DopeDB에 오신 것을 환영합니다",
  },
);
