// Public-site URLs and bilingual copy are the landing page's stable content contract.

export const repoUrl = "https://github.com/json-choi/dopedb";
export const releasesUrl = `${repoUrl}/releases/latest`;
export const workspaceSiteUrl = "https://app.dopedb.dev";
export const downloadUrls = {
  windows: `${repoUrl}/releases/latest/download/DopeDB-windows-x64-setup.exe`,
  macApple: `${repoUrl}/releases/latest/download/DopeDB-macos-arm64.dmg`,
  macIntel: `${repoUrl}/releases/latest/download/DopeDB-macos-x64.dmg`,
};
export const siteUrl = "https://dopedb.dev";
// Keep in sync with the required local tools in docs/PROJECT.md#development.
export type Lang = "en" | "ko";

export const workspaceUrls: Record<Lang, string> = {
  en: `${workspaceSiteUrl}/settings`,
  ko: `${workspaceSiteUrl}/ko/settings`,
};

export const homeCopy = {
  "en": {
    "landing": {
      "skip": "Skip to content",
      "productNav": "Product",
      "flowNav": "How it works",
      "trustNav": "FAQ",
      "workspace": "Open team workspace",
      "download": "Download",
      "heroLineOne": "Before Codex",
      "heroLineTwo": "meets prod",
      "heroSuffix": ".",
      "heroLineThree": "Set the boundary.",
      "category": "Shared database access for teams and AI agents",
      "description": "Share connections and policies. Keep credentials individual.\nYour agent works only with the resources you select.",
      "seeProduct": "See the actual app",
      "proof": "Runs locally · Personal needs no account · macOS & Windows · Open-source alpha",
      "explore": "Explore the galaxy",
      "return": "Back to the default view",
      "exploreHelp": "Drag / arrows to look around · Wheel / + − to zoom · Esc",
      "moveHelp": "Move your cursor to explore",
      "pause": "Pause galaxy animation",
      "play": "Resume galaxy animation",
      "reduced": "System reduced motion is enabled",
      "scroll": "Next, your actual workspace",
      "desktopTitle": "Where you meet your data.",
      "desktopBody": "Inspect schemas · approve changes · review results.",
      "desktopLabel": "Actual app · DopeDB 0.4.21",
      "desktopSample": "Demo SQLite · public sample data",
      "enlarge": "Enlarge the screenshot",
      "close": "Close",
      "imageDialog": "Actual DopeDB screenshot, enlarged",
      "flowLabel": "02 / INSIDE YOUR ORBIT",
      "flowTitle": "Room to explore.\nA precise boundary.",
      "flowBody": "Choose resources, then approve the proposed SQL.",
      "demoNotice": "Illustrative demo · No database connection or SQL execution.",
      "faqLabel": "03 / FAQ",
      "faqTitle": "Questions,\nanswered.",
      "docs": "Product boundaries and project docs",
      "downloadTitle": "Try one real connection.\nThe account can wait.",
      "downloadBody": "Personal needs no sign-in. Sign in for team sharing or managed access.",
      "install": "Before you install",
      "alpha": "Alpha · Verify least privilege and recovery before touching production.",
      "privacy": "Privacy",
      "terms": "Terms"
    },
    "product": {
      "imageSrc": "/dopedb-desktop-0.4.21.png",
      "imageAlt": "DopeDB 0.4.21 showing the Demo SQLite orders table, columns, and foreign key in Personal Workspace"
    },
    "faq": {
      "eyebrow": "Before you trust it",
      "title": "Not convinced? Ask these first.",
      "items": [
        {
          "question": "Do my queries pass through your servers?",
          "answer": "Database traffic runs from Desktop. The workspace stores membership, connection metadata, policy, provider resources, revisions, and collaboration audit. Sharing an Article also uploads its sanitized HTML and saved query definition, without query result rows."
        },
        {
          "question": "If I share a connection, does my database password go up with it?",
          "answer": "No. Member-local credentials remain in that member's OS store. Supported managed access returns an expiring member-specific credential and does not persist the issued secret."
        },
        {
          "question": "Can an Agent approve the write it just wrote?",
          "answer": "No. A person must approve the proposed SQL in Desktop before it runs."
        },
        {
          "question": "If DopeDB goes down, do we lose our database?",
          "answer": "No. An already synchronized connection with your member-local credential keeps working, and Personal Workspace never needed an account. New managed credentials and membership or policy changes wait until the service is back."
        },
        {
          "question": "How do I invite someone to an Article?",
          "answer": "A workspace manager with management access to the database creates an invitation for one recipient. That person signs in and explicitly accepts to join the workspace and receive read access. They still install Desktop and supply any member-local credential themselves."
        },
        {
          "question": "Can I use Claude or Codex from my terminal?",
          "answer": "Yes. Each run asks Desktop to approve the selected resources, then starts your locally authenticated official CLI."
        },
        {
          "question": "Can I use it in production today?",
          "answer": "It is still an alpha. Verify the supported provider and recovery scope, use least-privilege database roles, and validate your workflow before it touches production data."
        }
      ]
    },
    "download": {
      "primary": "Open the latest release",
      "downloadWindows": "Download for Windows",
      "downloadMacApple": "Download for Apple Silicon",
      "downloadMacIntel": "Download for Intel Mac",
      "chooseMac": "Choose your Mac build",
      "chooseDesktop": "Choose a desktop build",
      "source": "Build from source",
      "windows": "Windows x64",
      "macApple": "macOS Apple Silicon",
      "macIntel": "macOS Intel",
      "recommended": "Recommended",
      "detectionPending": "Choose a build · this browser will mark the best match",
      "detectedWindows": "Windows detected · x64 installer selected",
      "detectedMacApple": "Apple Silicon Mac detected · ARM64 DMG selected",
      "detectedMacIntel": "Intel Mac detected · x64 DMG selected",
      "detectedMacUnknown": "macOS detected · choose Apple Silicon or Intel",
      "detectedUnsupported": "No installer for this device · choose a desktop build",
      "macSigning": "Current macOS releases are Developer ID signed and notarized.",
      "windowsWarningTitle": "Windows alpha installers may show a SmartScreen warning.",
      "windowsWarningBody": "The installer is not code-signed yet. Confirm the file came from GitHub Releases, then choose More info → Run anyway."
    },
    "jsonDescription": "DopeDB is an open-source database workspace where teams share access without sharing database credentials, and Codex or Claude works through one locally enforced session scoped to selected Project resources."
  },
  "ko": {
    "landing": {
      "skip": "본문으로 이동",
      "productNav": "제품",
      "flowNav": "작동 방식",
      "trustNav": "FAQ",
      "workspace": "팀 워크스페이스 열기",
      "download": "다운로드",
      "heroLineOne": "Codex에게",
      "heroLineTwo": "prod DB",
      "heroSuffix": "를",
      "heroLineThree": "맡기기 전에.",
      "category": "팀과 AI Agent를 위한 공유 DB 접근 워크스페이스",
      "description": "연결과 정책은 함께. 인증정보는 각자.\nAgent는 직접 선택한 리소스에서만 일합니다.",
      "seeProduct": "실제 화면 보기",
      "proof": "로컬 실행 · Personal은 계정 없이 · macOS & Windows · 오픈소스 Alpha",
      "explore": "은하 탐험하기",
      "return": "기본 시점으로",
      "exploreHelp": "드래그·방향키로 둘러보기 · 휠·+ −로 거리 조절 · Esc",
      "moveHelp": "마우스를 움직여보세요",
      "pause": "은하 애니메이션 일시정지",
      "play": "은하 애니메이션 재생",
      "reduced": "시스템 동작 줄이기 사용 중",
      "scroll": "이제, 실제 작업 화면으로",
      "desktopTitle": "당신의 데이터에 닿는 곳.",
      "desktopBody": "스키마 확인 · 변경 승인 · 결과 검토",
      "desktopLabel": "실제 앱 화면 · DopeDB 0.4.21",
      "desktopSample": "Demo SQLite · 공개 샘플 데이터",
      "enlarge": "화면 크게 보기",
      "close": "닫기",
      "imageDialog": "DopeDB 실제 화면 확대",
      "flowLabel": "02 / INSIDE YOUR ORBIT",
      "flowTitle": "가능성은 넓게.\n권한은 정확하게.",
      "flowBody": "리소스를 고르고, 제안된 SQL을 승인해보세요.",
      "demoNotice": "설명용 데모 · 실제 DB에 연결하거나 SQL을 실행하지 않습니다.",
      "faqLabel": "03 / FAQ",
      "faqTitle": "자주 묻는 질문",
      "docs": "제품 경계와 프로젝트 문서",
      "downloadTitle": "진짜 연결 하나를 넣어보세요.\n계정은 그다음입니다.",
      "downloadBody": "Personal은 로그인 없이 시작합니다. 팀 공유·관리형 접근은 로그인 후.",
      "install": "설치 전 확인",
      "alpha": "Alpha · 프로덕션 사용 전 최소 권한과 복구 흐름을 확인하세요.",
      "privacy": "개인정보처리방침",
      "terms": "이용약관"
    },
    "product": {
      "imageSrc": "/dopedb-desktop-0.4.21-ko.png",
      "imageAlt": "개인 워크스페이스에서 Demo SQLite의 주문 테이블·컬럼·외래 키를 보여주는 DopeDB 0.4.21"
    },
    "faq": {
      "eyebrow": "신뢰하기 전에",
      "title": "못 믿겠으면, 이것부터 물어보세요.",
      "items": [
        {
          "question": "내 쿼리가 당신들 서버를 지나가나요?",
          "answer": "DB 통신은 Desktop에서 실행됩니다. 워크스페이스는 구성원, 연결 정보, 정책, 클라우드 리소스, 버전과 협업 감사 기록을 관리합니다. Article 공유 시 정제된 HTML과 저장 쿼리 정의도 업로드하며, 쿼리 결과 행은 업로드하지 않습니다."
        },
        {
          "question": "연결을 공유하면 내 DB 비번도 같이 올라가나요?",
          "answer": "아니요. Member-local credential은 각자의 OS 저장소에 남습니다. 지원되는 managed access는 만료되는 구성원별 credential을 반환하며 발급된 secret을 저장하지 않습니다."
        },
        {
          "question": "Agent가 자기가 만든 write를 자기가 승인할 수 있나요?",
          "answer": "아니요. 제안한 SQL은 사람이 Desktop에서 직접 승인해야 실행됩니다."
        },
        {
          "question": "DopeDB가 내려가면 우리 DB도 못 쓰나요?",
          "answer": "아니요. 이미 동기화된 연결과 기기에 저장한 개인 인증정보로는 계속 작업할 수 있고, Personal Workspace는 애초에 계정이 필요 없습니다. 새 managed credential 발급과 멤버십·정책 변경 반영만 service가 돌아온 뒤로 밀립니다."
        },
        {
          "question": "Article에 다른 사람을 초대하려면 어떻게 하나요?",
          "answer": "해당 DB의 관리 권한이 있는 워크스페이스 관리자가 수신자 한 명을 지정해 초대합니다. 수신자가 로그인하고 직접 수락하면 워크스페이스 참여와 읽기 권한 등록을 함께 처리합니다. Desktop 설치와 개인 로컬 인증정보 입력은 수신자가 직접 진행합니다."
        },
        {
          "question": "터미널의 Claude나 Codex에서도 사용할 수 있나요?",
          "answer": "네. 실행할 때마다 Desktop에서 선택한 리소스를 승인한 뒤, 로그인된 공식 CLI를 시작합니다."
        },
        {
          "question": "지금 production에 써도 되나요?",
          "answer": "아직 Alpha입니다. 지원 provider와 복구 범위를 확인하고 최소 권한 DB role을 사용하며 production data에 닿기 전에 workflow를 검증하세요."
        }
      ]
    },
    "download": {
      "primary": "최신 Release 열기",
      "downloadWindows": "Windows용 다운로드",
      "downloadMacApple": "Apple Silicon용 다운로드",
      "downloadMacIntel": "Intel Mac용 다운로드",
      "chooseMac": "Mac 설치 파일 선택",
      "chooseDesktop": "데스크톱 설치 파일 선택",
      "source": "소스에서 빌드",
      "windows": "Windows x64",
      "macApple": "macOS Apple Silicon",
      "macIntel": "macOS Intel",
      "recommended": "추천",
      "detectionPending": "설치 파일을 선택하세요 · 브라우저가 권장 항목을 표시합니다",
      "detectedWindows": "Windows 감지 · x64 설치 파일을 선택했습니다",
      "detectedMacApple": "Apple Silicon Mac 감지 · ARM64 DMG를 선택했습니다",
      "detectedMacIntel": "Intel Mac 감지 · x64 DMG를 선택했습니다",
      "detectedMacUnknown": "macOS 감지 · Apple Silicon 또는 Intel을 선택하세요",
      "detectedUnsupported": "이 기기용 설치 파일 없음 · 데스크톱 설치 파일을 선택하세요",
      "macSigning": "현재 macOS 정식 배포본은 Developer ID 서명과 Apple 공증을 거칩니다.",
      "windowsWarningTitle": "Windows Alpha 설치본에는 SmartScreen 경고가 표시될 수 있습니다.",
      "windowsWarningBody": "설치 파일에 아직 코드 서명이 없습니다. GitHub Releases에서 받은 파일인지 확인한 뒤 추가 정보 → 실행을 선택하세요."
    },
    "jsonDescription": "DopeDB는 팀이 DB 인증정보 대신 연결과 정책을 공유하고, Codex와 Claude가 한 Project에서 선택한 리소스의 로컬 권한 경계 안에서 일하게 하는 오픈소스 데이터베이스 워크스페이스입니다."
  }
};

export type HomeCopy = (typeof homeCopy)[Lang];
export type LandingCopy = HomeCopy["landing"];
