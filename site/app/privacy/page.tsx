// Public privacy policy used by the website, workspace service, and Google OAuth
// verification. It describes only data paths implemented by the current product.
import type { Metadata } from "next";
import { LegalDocument, type LegalSection } from "../components/LegalDocument";

const operatorName = { en: "Jaesong Choi", ko: "최재송" } as const;
const contactEmail = "cjs5241@gmail.com";
const effectiveDate = { en: "October 19, 2026", ko: "2026년 10월 19일" } as const;

type PrivacyProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const content: Record<"en" | "ko", {
  title: string;
  description: string;
  sections: LegalSection[];
}> = {
  en: {
    title: "Privacy Policy",
    description:
      "This policy explains how DopeDB processes information across its public website, local desktop app, hosted workspace, and optional provider integrations.",
    sections: [
      {
        title: "Controller and privacy contact",
        paragraphs: [
          `The data controller and privacy officer for DopeDB's hosted service is ${operatorName.en}, an individual operator in the Republic of Korea. Privacy questions, rights requests, and complaints can be sent to ${contactEmail}.`,
        ],
      },
      {
        title: "Scope and responsibility",
        paragraphs: [
          "This policy covers dopedb.dev, the hosted service at app.dopedb.dev, the DopeDB desktop app, and optional managed provider integrations. Information that remains only on your device is controlled by you and is not received by the hosted service, except for the separately described sanitized Sentry error diagnostics.",
          "A workspace organization may separately determine why and how it uses member or database-related information. In that case, the organization is responsible for its own notices, authority, and instructions, while DopeDB processes hosted workspace data to provide and secure the service.",
        ],
      },
      {
        title: "Information we process",
        items: [
          "Account and invitation data: Google account identifier, verified email address, name, profile image, account timestamps, workspace memberships and roles, invitation address and status, inviter identity, and workspace name.",
          "Session and security data: session and device-authorization identifiers, expiration and activity timestamps, IP address, user agent, rate-limit key and count, request identifier, authentication status, and redacted audit events.",
          "Workspace data: workspace profile, members and roles, secretless connection templates, environment and safety settings, access grants, revisions and conflicts, provider/resource selectors, encrypted metadata backups and deletion markers, and audit records. Shared templates reject database passwords, tokens, certificates, embedded-credential URLs, local paths, and local secret references.",
          "Provider setup and managed-access data: provider identity and resource metadata, selected Google Cloud project and Cloud SQL instance, requested OAuth scopes, short-lived setup authorization, encrypted reusable provider authorization when required, setup receipts, and credential-lease metadata. One-time database credentials are returned only to the authenticated desktop app and are not stored in the workspace database.",
          "Local desktop and Agent data: other than the separately described error diagnostics, database credentials, certificates, advanced connection parameters, query history, full execution records, and provider CLI authentication remain on the device or in its operating-system credential store unless you deliberately publish supported metadata or send selected context to an Agent provider.",
          "Desktop error diagnostics: production builds send Sentry a sanitized exception type and stack structure or code location, app release and runtime, a bounded React component-name chain, and closed Agent-plugin provider, operation, and failure outcome tags. User, request, breadcrumb, free-form message, extra context, logs, replay, tracing, and default PII are disabled or removed before sending.",
          "No product analytics: DopeDB does not collect product or usage analytics in the Desktop app or the hosted workspace. It records no behavioral events, session replays, heatmaps, or advertising identifiers there.",
          "Website data: hosting and security requests, plus closed page/language and download or workspace-button event categories stored in Cloudflare Analytics Engine for three months. Website metrics contain no visitor identifier, full URL, query string, referrer, device, or location field and are not used for advertising profiles.",
        ],
      },
      {
        title: "Desktop error diagnostics and no product analytics",
        paragraphs: [
          "Sentry error diagnostics are the only telemetry the Desktop app sends. Sentry receives only the sanitized production error projection described above. The Desktop app runs no product analytics, funnel measurement, or session recording, and Sentry is not used for them. The public website's aggregate page and download counts are described separately.",
          "Cloudflare may separately process request metadata and IP addresses as hosting and security data.",
          "Error diagnostics are not allowed to contain SQL or query text, parameters, database results, database, host, connection, schema, table, column or project names, credentials, tokens, certificates, Agent prompts or transcripts, repository names or source, local paths, email, display name, raw account or workspace identifiers, request or response bodies, or raw product errors. DopeDB does not use this system for advertising or general-purpose AI training.",
        ],
      },
      {
        title: "Purposes and legal grounds",
        items: [
          "Provide the service and follow your request: authenticate accounts and devices, maintain sessions, create workspaces, synchronize supported metadata, send invitations, and issue managed credentials.",
          "Apply workspace access rules, preserve revision and audit history, prevent abuse, investigate failures, protect users and the service, and maintain reliability.",
          "Complete an optional Google Cloud or other provider setup that an authorized administrator starts and approves.",
          "Diagnose sanitized Desktop failures so they can be fixed.",
          "Depending on the processing, we rely on performance of the service you request, explicit consent for optional provider access, legitimate security and operational interests balanced against your rights for strictly bounded diagnostics, or another basis permitted or required by applicable law.",
        ],
      },
      {
        title: "Google user data",
        paragraphs: [
          "Ordinary sign-in requests Google identity scopes for your account identifier, verified email, name, and profile image. DopeDB clears Google access, refresh, and ID token values before account data is stored.",
          "Only when an authorized workspace administrator starts Google Cloud SQL setup does DopeDB request the Google Cloud platform scope. The resulting access token is encrypted, used to list accessible projects and instances, validate the selected resource, and perform the explicitly approved keyless setup, and expires within ten minutes. DopeDB does not request or retain a Google refresh token or service-account key.",
          "Google data is not used for advertising, credit decisions, or training general-purpose AI models. DopeDB's use and transfer of information received from Google APIs follows the Google API Services User Data Policy, including its Limited Use requirements. You can revoke access from your Google Account permissions.",
        ],
      },
      {
        title: "Agents and user-directed services",
        paragraphs: [
          "DopeDB launches official Agent adapters and relies on the user's local Codex or Claude CLI login. DopeDB does not read, refresh, or persist that provider login token. Prompts and any schema, query, result, file, or error context you include may be transmitted by the official CLI to the selected provider and processed under that provider's account settings, terms, and privacy policy.",
          "A cloud project, database, GitHub repository, or other service that you deliberately connect likewise receives the requests and data needed to perform your instruction. Those providers are independent recipients, and their processing locations and retention depend on the provider, account, and resource you select. DopeDB does not independently use Agent conversations or database contents to train a general-purpose AI model.",
        ],
      },
      {
        title: "Service providers and sharing",
        items: [
          "Cloudflare hosts and secures the public website, Workspace application, background coordinator, and workload identity service. Its D1 database stores account and workspace records, including encrypted integration and backup records. It stores closed public website events in Analytics Engine and may process request and security metadata. Policy: https://www.cloudflare.com/privacypolicy/.",
          "Sentry provides production Desktop error diagnostics through its United States ingest service. It receives only the sanitized error projection described above. Policy: https://sentry.io/privacy/.",
          "Neon, LLC (Neon) previously stored account and workspace records in PostgreSQL. Restricted recovery copies remain during migration cleanup; the active Workspace database is Cloudflare D1. Contact: privacy@neon.tech; policy: https://neon.com/privacy-policy.",
          "Plus Five Five, Inc. (Resend) sends workspace invitations only when email delivery is configured. It receives recipient and inviter name/email, workspace name, and the invitation link. Contact: privacy@resend.com; policy: https://resend.com/legal/privacy-policy.",
          "Google receives sign-in and optional Cloud API requests; a user-selected Agent, cloud, or database provider receives only the requests the user initiates. Each independent provider applies its own terms and privacy policy.",
          "Workspace data is visible to members according to their current roles and connection grants. Information may also be disclosed when required by applicable law, a valid legal order, or an urgent need to protect rights and safety. DopeDB does not sell personal information or share it for cross-context behavioral advertising.",
        ],
      },
      {
        title: "International processing and transfer",
        paragraphs: [
          "DopeDB is operated in the Republic of Korea. Public website and Workspace requests run on Cloudflare’s distributed network, which is not restricted to one country. The Workspace D1 database requests placement in Eastern North America; this placement preference does not guarantee a country or legal jurisdiction. Restricted legacy recovery copies remain in the United States during migration cleanup. Authenticated requests and records are transferred over encrypted connections. These providers may use subprocessors in the locations identified in their legal notices.",
          "Sanitized production Desktop errors are sent directly to Sentry’s United States ingest service. Hosting-security metadata may be processed by Cloudflare outside the Workspace database region.",
          "If invitation email is enabled, the invitation data listed above is sent by encrypted API request to Resend in the United States when an administrator sends or resends an invitation. Google and user-selected Agent, cloud, and database providers may process data in the countries shown in their own policies or the region selected for the connected resource.",
          "Recipients process information for the purposes described above for the service relationship, account or workspace lifecycle, provider backup cycle, and any period required by law. You can refuse core overseas processing by not signing in to or creating a hosted workspace; this prevents hosted sharing and managed access but does not prevent local-only desktop use. You can separately refuse an optional integration by not connecting it or by disconnecting and revoking it with the provider.",
        ],
      },
      {
        title: "Retention, deletion, and destruction",
        items: [
          "Device authorization and Google Cloud setup sessions are valid for no more than ten minutes, managed database credentials normally for no more than fifteen minutes, invitation links for 48 hours, and current account sessions for up to 30 days unless revoked sooner. Related security and audit records can be retained for the longer periods described below.",
          "Account, membership, workspace, connection, revision, integration, and audit records are retained while needed to provide and secure an active workspace and to meet legal obligations. Self-service workspace deletion is currently disabled; an owner or other authorized person can email a verified deletion request, and we will explain any record that must be retained.",
          "Deleting a metadata backup makes it unavailable through the product and records a deletion marker. Its encrypted ciphertext may remain until a verified workspace deletion or an operational purge is completed. Disconnecting an integration removes or invalidates DopeDB's stored authorization where supported, but you should also revoke provider-side access.",
          "Sanitized Sentry events are retained only for the configured incident-investigation period and are deleted or anonymized when no longer needed.",
          "When destruction is due, electronic records are deleted or irreversibly anonymized through the applicable database, storage, and provider lifecycle. Isolated provider backups may remain until their protected backup cycle expires and are not used for ordinary service operations.",
          "Local desktop data remains until you remove the connection or history, delete the operating-system credential item, or uninstall the app. Agent or connected-provider copies must be deleted through that provider's controls.",
        ],
      },
      {
        title: "Cookies and automatic collection",
        paragraphs: [
          "The hosted workspace uses secure, essential authentication cookies to maintain the selected session, including a short cookie cache. Current sessions can last up to 30 days. Blocking or deleting these cookies prevents or ends hosted sign-in but does not prevent local-only desktop use.",
          "The public website uses same-origin Cloudflare Analytics Engine collection for bounded page and click counts. It creates no website visitor identifier and uses no advertising cookies or cross-site behavioral tracking. Do Not Track and Global Privacy Control disable collection. Hosting security metadata may still be processed when a request reaches the service.",
          "DopeDB runs no product or usage analytics in the Desktop app or the hosted workspace, and the website's counts are not linked to any Desktop or account identifier. Sentry diagnostics is a separate error-monitoring path.",
        ],
      },
      {
        title: "Security",
        paragraphs: [
          "DopeDB uses encrypted transport, server-side authorization checks, short-lived credentials, encrypted provider authorization and metadata backups, keyless Google Cloud federation, redacted logs, secretless shared templates, and operating-system credential storage. Access is restricted by workspace role and connection grant. No system is perfectly secure, so users should grant the minimum cloud and database privileges required and report suspected compromise promptly.",
        ],
      },
      {
        title: "Your rights and complaints",
        items: [
          `You or an authorized representative may request access, correction, deletion, suspension or restriction of processing, withdrawal of consent, or a copy of applicable personal information by emailing ${contactEmail}. You may also object or appeal when a request is denied. We may verify identity and authority and will explain a refusal required or permitted by law.`,
          "You can disconnect an integration, revoke DopeDB in Google Account permissions, sign out a session, or ask a workspace administrator to change or remove membership. Optional provider integration is not required for local-only desktop use.",
          "You may seek additional help from Korea's Personal Information Infringement Report Center at https://privacy.kisa.or.kr or the Personal Information Dispute Mediation Committee at https://www.kopico.go.kr.",
        ],
      },
      {
        title: "Children, changes, and language",
        paragraphs: [
          "DopeDB is a developer tool and is not directed to children under 16. We do not knowingly collect their personal information through the hosted service; if we learn that we have done so, we will take appropriate deletion steps.",
          "We may update this policy as the product or law changes. Material updates will be posted here with a revised effective date, and additional notice will be provided when required by law. A prior version can be requested at the privacy contact.",
          "The Korean and English versions are intended to have the same meaning. If they conflict, the Korean version controls to the extent permitted by applicable law.",
        ],
      },
    ],
  },
  ko: {
    title: "개인정보처리방침",
    description:
      "이 방침은 DopeDB 공개 웹사이트, 로컬 데스크톱 앱, 호스팅 워크스페이스와 선택형 공급자 연동에서 정보를 처리하는 방식을 설명합니다.",
    sections: [
      {
        title: "개인정보처리자와 보호책임자",
        paragraphs: [
          `DopeDB 호스팅 서비스의 개인정보처리자이자 개인정보 보호책임자는 대한민국의 개인 운영자 ${operatorName.ko}입니다. 개인정보 문의, 권리 요청과 불만은 ${contactEmail}으로 보낼 수 있습니다.`,
        ],
      },
      {
        title: "적용 범위와 책임",
        paragraphs: [
          "이 방침은 dopedb.dev, app.dopedb.dev의 호스팅 서비스, DopeDB 데스크톱 앱과 선택형 관리형 공급자 연동에 적용됩니다. 별도로 설명한 정제된 Sentry 오류 진단을 제외하고 기기에만 남는 정보는 사용자가 통제하며 호스팅 서비스가 수신하지 않습니다.",
          "워크스페이스 조직은 구성원 또는 DB 관련 정보를 이용하는 목적과 방법을 별도로 결정할 수 있습니다. 이 경우 해당 조직은 자체 고지, 처리 권한과 지시에 책임이 있고, DopeDB는 서비스 제공과 보호를 위해 호스팅된 워크스페이스 정보를 처리합니다.",
        ],
      },
      {
        title: "처리하는 정보",
        items: [
          "계정·초대 정보: Google 계정 식별자, 인증된 이메일 주소, 이름, 프로필 이미지, 계정 시각 정보, 워크스페이스 멤버십·역할, 초대 주소·상태, 초대한 사람의 신원과 워크스페이스 이름.",
          "세션·보안 정보: 세션·기기 인증 식별자, 만료·활동 시각, IP 주소, 사용자 에이전트, 요청 제한 키·횟수, 요청 식별자, 인증 상태와 비밀값을 제거한 감사 이벤트.",
          "워크스페이스 정보: 워크스페이스 프로필, 구성원·역할, 비밀값 없는 연결 템플릿, 환경·안전 설정, 접근 권한, 버전·충돌, 공급자·리소스 선택 정보, 암호화된 메타데이터 백업·삭제 표식과 감사 기록. 공유 템플릿은 DB 비밀번호, 토큰, 인증서, 인증 정보가 포함된 URL, 로컬 경로와 로컬 비밀값 참조를 거부합니다.",
          "공급자 설정·관리형 접근 정보: 공급자 신원·리소스 메타데이터, 선택한 Google Cloud 프로젝트·Cloud SQL 인스턴스, 요청한 OAuth 범위, 단기 설정 승인, 필요한 경우 암호화된 재사용 가능 공급자 승인, 설정 확인 정보와 자격 증명 임대 메타데이터. 일회성 DB 자격 증명은 인증된 데스크톱 앱에만 반환되며 워크스페이스 DB에 저장하지 않습니다.",
          "로컬 데스크톱·Agent 정보: 아래에서 별도로 설명하는 오류 진단을 제외한 DB 자격 증명, 인증서, 고급 연결 파라미터, 쿼리 기록, 전체 실행 기록과 공급자 CLI 인증은 사용자가 지원되는 메타데이터를 명시적으로 게시하거나 선택한 맥락을 Agent 공급자에게 보내지 않는 한 기기 또는 운영체제 자격 증명 저장소에 남습니다.",
          "데스크톱 오류 진단: 정식 빌드는 정제된 예외 종류와 스택 구조 또는 코드 위치, 앱 릴리스·런타임, 제한된 React 컴포넌트 이름 연결, 폐쇄형 Agent 플러그인 공급자·작업·실패 결과 태그를 Sentry에 전송합니다. 사용자, 요청, breadcrumb, 자유 형식 메시지, 추가 맥락, 로그, replay, tracing과 기본 개인정보는 전송 전에 비활성화하거나 제거합니다.",
          "제품 분석 없음: DopeDB는 데스크톱 앱과 호스팅 워크스페이스에서 제품·이용 분석을 수집하지 않습니다. 이곳에서는 행동 이벤트, 세션 녹화, heatmap, 광고 식별자를 기록하지 않습니다.",
          "웹사이트 정보: 호스팅·보안 요청과 Cloudflare Analytics Engine에 3개월 보관하는 정해진 페이지·언어·다운로드·워크스페이스 버튼 이벤트 분류. 웹사이트 집계에는 방문자 식별자, 전체 URL, 쿼리 문자열, 유입 경로, 기기 또는 위치 항목을 넣지 않으며 광고 프로필에 사용하지 않습니다.",
        ],
      },
      {
        title: "데스크톱 오류 진단과 제품 분석 없음",
        paragraphs: [
          "Sentry 오류 진단은 데스크톱 앱이 전송하는 유일한 원격 측정입니다. Sentry에는 위에서 설명한 정식 앱의 정제된 오류 정보만 전송합니다. 데스크톱 앱은 제품 분석, 퍼널 측정, 세션 녹화를 운영하지 않으며 Sentry도 그런 용도로 사용하지 않습니다. 공개 웹사이트의 페이지·다운로드 집계는 별도로 설명합니다.",
          "오류 진단에는 SQL·쿼리 본문이나 파라미터, DB 결과, DB·호스트·연결·스키마·테이블·컬럼·프로젝트 이름, 자격 증명·토큰·인증서, Agent 프롬프트·대화, 저장소 이름·소스 코드, 로컬 경로, 이메일·표시 이름, 원본 계정·워크스페이스 식별자, 요청·응답 본문 또는 원본 제품 오류를 넣지 않습니다. 광고나 범용 AI 모델 학습에도 사용하지 않습니다.",
        ],
      },
      {
        title: "처리 목적과 법적 근거",
        items: [
          "서비스 제공과 이용자 요청 이행: 계정·기기 인증, 세션 유지, 워크스페이스 생성, 지원되는 메타데이터 동기화, 초대 전송과 관리형 자격 증명 발급.",
          "워크스페이스 접근 규칙 적용, 버전·감사 이력 보존, 부정 이용 방지, 장애 조사, 이용자·서비스 보호와 안정성 유지.",
          "권한 있는 관리자가 시작하고 승인한 선택형 Google Cloud 또는 기타 공급자 설정 수행.",
          "정제된 데스크톱 장애를 진단해 수정합니다.",
          "처리 항목에 따라 이용자가 요청한 서비스의 이행, 선택형 공급자 접근에 대한 명시적 동의, 이용자 권리와 비교형량한 엄격히 제한된 진단의 보안·운영상 정당한 이익 또는 관련 법률이 허용·요구하는 다른 근거에 따라 처리합니다.",
        ],
      },
      {
        title: "Google 사용자 데이터",
        paragraphs: [
          "일반 로그인에는 Google 계정 식별자, 인증된 이메일, 이름과 프로필 이미지를 위한 신원 범위를 요청합니다. DopeDB는 계정 정보를 저장하기 전에 Google 액세스·갱신·ID 토큰 값을 제거합니다.",
          "권한 있는 워크스페이스 관리자가 Google Cloud SQL 설정을 시작한 경우에만 Google Cloud platform 범위를 요청합니다. 발급된 액세스 토큰은 암호화되고, 접근 가능한 프로젝트·인스턴스 조회, 선택한 리소스 검증과 명시적으로 승인한 키 없는 설정에 사용되며 10분 안에 만료됩니다. Google 갱신 토큰이나 서비스 계정 키는 요청하거나 보관하지 않습니다.",
          "Google 데이터는 광고, 신용 결정 또는 범용 AI 모델 학습에 사용하지 않습니다. DopeDB의 Google API 정보 사용과 이전은 제한적 사용 요건을 포함한 Google API 서비스 사용자 데이터 정책을 따릅니다. Google 계정 권한에서 접근을 철회할 수 있습니다.",
        ],
      },
      {
        title: "Agent와 사용자가 선택한 서비스",
        paragraphs: [
          "DopeDB는 공식 Agent 어댑터를 실행하며 사용자의 로컬 Codex 또는 Claude CLI 로그인을 이용합니다. DopeDB는 해당 공급자 로그인 토큰을 읽거나 갱신하거나 저장하지 않습니다. 프롬프트와 사용자가 포함한 스키마, 쿼리, 결과, 파일 또는 오류 맥락은 공식 CLI를 통해 선택한 공급자에게 전송되고 해당 계정 설정, 약관과 개인정보처리방침에 따라 처리될 수 있습니다.",
          "사용자가 명시적으로 연결한 클라우드 프로젝트, DB, GitHub 저장소 또는 기타 서비스도 지시 수행에 필요한 요청과 데이터를 수신합니다. 해당 공급자는 독립된 수신자이며 처리 위치와 보유 기간은 선택한 공급자, 계정과 리소스에 따라 달라집니다. DopeDB는 Agent 대화나 DB 내용을 범용 AI 모델 학습에 별도로 사용하지 않습니다.",
        ],
      },
      {
        title: "처리 위탁과 정보 제공",
        items: [
          "Cloudflare는 공개 웹사이트, 워크스페이스 앱, 백그라운드 작업 조정과 워크로드 신원 서비스를 호스팅하고 보호합니다. D1 데이터베이스에 계정·워크스페이스 레코드와 암호화된 연동·백업 레코드를 저장합니다. 정해진 웹사이트 이벤트를 Analytics Engine에 저장하며 요청과 보안 메타데이터를 처리할 수 있습니다. 방침: https://www.cloudflare.com/privacypolicy/.",
          "Sentry는 미국 수집 서비스를 통해 정식 데스크톱 앱의 오류 진단을 제공합니다. 위에서 설명한 정제된 오류 정보만 수신합니다. 방침: https://sentry.io/privacy/.",
          "Neon, LLC(Neon)는 이전 계정·워크스페이스 레코드를 PostgreSQL에 저장했습니다. 이전 정리 중에는 접근을 제한한 복구 사본이 남으며, 현재 워크스페이스 데이터베이스는 Cloudflare D1입니다. 연락처: privacy@neon.tech, 방침: https://neon.com/privacy-policy.",
          "Plus Five Five, Inc.(Resend)는 이메일 전송이 구성된 경우에만 워크스페이스 초대를 발송합니다. 수신자·초대자 이름과 이메일, 워크스페이스 이름, 초대 링크를 받습니다. 연락처: privacy@resend.com, 방침: https://resend.com/legal/privacy-policy.",
          "Google은 로그인·선택형 Cloud API 요청을 수신하고, 사용자가 선택한 Agent·클라우드·DB 공급자는 사용자가 시작한 요청만 수신합니다. 각 독립 공급자의 약관과 개인정보처리방침이 적용됩니다.",
          "워크스페이스 정보는 현재 역할과 연결 권한에 따라 구성원에게 표시됩니다. 관련 법률, 유효한 법적 명령 또는 권리·안전을 보호할 긴급한 필요가 있는 경우에도 정보를 제공할 수 있습니다. 개인정보를 판매하거나 맞춤형 행태 광고 목적으로 공유하지 않습니다.",
        ],
      },
      {
        title: "개인정보의 국외 처리와 이전",
        paragraphs: [
          "DopeDB 운영자는 대한민국에 있습니다. 공개 웹사이트와 워크스페이스 요청은 단일 국가로 제한되지 않는 Cloudflare 분산 네트워크에서 처리됩니다. 워크스페이스 D1 데이터베이스는 북미 동부 배치를 요청하지만, 이 배치 선호가 특정 국가나 법적 관할을 보장하지는 않습니다. 이전 정리 중에는 미국에 접근을 제한한 과거 복구 사본이 남습니다. 인증 요청과 레코드는 암호화된 통신으로 전송됩니다. 각 공급자는 법적 고지에 표시된 위치의 하위 처리자를 이용할 수 있습니다.",
          "정제된 정식 데스크톱 오류는 Sentry의 미국 수집 서비스로 직접 전송됩니다. 호스팅 보안 메타데이터는 Cloudflare가 워크스페이스 DB 리전 밖에서 처리할 수 있습니다.",
          "초대 이메일이 활성화된 경우 관리자가 초대를 보내거나 다시 보낼 때 위에 적은 초대 정보가 암호화된 API 요청으로 미국의 Resend에 전송됩니다. Google과 사용자가 선택한 Agent·클라우드·DB 공급자는 자체 방침에 표시된 국가 또는 연결 리소스에서 선택한 리전에서 정보를 처리할 수 있습니다.",
          "수신자는 위 목적을 위해 서비스 계약, 계정·워크스페이스 생애주기, 공급자 백업 주기와 법률상 필요한 기간 동안 정보를 처리합니다. 핵심 국외 처리를 거부하려면 호스팅 워크스페이스에 로그인하거나 이를 생성하지 않을 수 있습니다. 이 경우 호스팅 공유·관리형 접근은 이용할 수 없지만 로컬 전용 데스크톱 기능은 사용할 수 있습니다. 선택형 연동은 연결하지 않거나 연결 해제 후 공급자 측 권한을 철회하여 별도로 거부할 수 있습니다.",
        ],
      },
      {
        title: "보유, 삭제와 파기",
        items: [
          "기기 인증·Google Cloud 설정 세션은 최대 10분, 관리형 DB 자격 증명은 일반적으로 최대 15분, 초대 링크는 48시간, 현재 계정 세션은 더 일찍 철회하지 않는 한 최대 30일 동안 유효합니다. 관련 보안·감사 기록은 아래의 더 긴 기간 동안 보유할 수 있습니다.",
          "계정, 멤버십, 워크스페이스, 연결, 버전, 연동과 감사 기록은 활성 워크스페이스 제공·보호와 법적 의무 이행에 필요한 동안 보유합니다. 현재 워크스페이스의 직접 삭제 기능은 비활성화되어 있으므로 Owner 또는 권한 있는 사람은 이메일로 확인 절차를 거친 삭제를 요청할 수 있으며, 계속 보유해야 하는 기록이 있으면 그 이유를 설명합니다.",
          "메타데이터 백업을 삭제하면 제품에서 이용할 수 없게 되고 삭제 표식이 기록됩니다. 암호화된 본문은 확인된 워크스페이스 삭제 또는 운영상 파기가 완료될 때까지 남을 수 있습니다. 연동을 해제하면 지원되는 범위에서 DopeDB가 저장한 승인을 삭제하거나 무효화하지만 공급자 측 접근도 직접 철회해야 합니다.",
          "정제된 Sentry 이벤트는 설정된 장애 조사 기간에만 보유하고 더 이상 필요하지 않으면 삭제하거나 익명화합니다.",
          "파기 시점이 되면 전자 기록은 해당 DB, 저장소와 공급자 생애주기에 따라 삭제하거나 복구할 수 없게 익명화합니다. 격리된 공급자 백업은 보호된 백업 주기가 끝날 때까지 남을 수 있으며 일반 서비스 운영에는 사용하지 않습니다.",
          "로컬 데스크톱 정보는 연결·기록 제거, 운영체제 자격 증명 항목 삭제 또는 앱 제거 시까지 남습니다. Agent나 연결된 공급자가 가진 사본은 해당 공급자의 기능으로 삭제해야 합니다.",
        ],
      },
      {
        title: "쿠키와 자동 수집",
        paragraphs: [
          "호스팅 워크스페이스는 선택한 세션을 유지하기 위해 짧은 쿠키 캐시를 포함한 보안·필수 인증 쿠키를 사용합니다. 현재 세션은 최대 30일간 유지될 수 있습니다. 쿠키를 차단하거나 삭제하면 호스팅 로그인이 불가능하거나 종료되지만 로컬 전용 데스크톱 이용에는 영향이 없습니다.",
          "공개 웹사이트는 페이지·클릭 수를 제한된 항목으로 집계하기 위해 동일 출처의 Cloudflare Analytics Engine 수집 경로를 사용합니다. 웹사이트 방문자 식별자를 만들지 않고 광고 쿠키나 사이트 간 행태 추적을 사용하지 않습니다. Do Not Track과 Global Privacy Control 설정 시 수집을 중단합니다. 요청이 서비스에 도달하면 호스팅 보안 메타데이터는 처리될 수 있습니다.",
          "DopeDB는 데스크톱 앱과 호스팅 워크스페이스에서 제품·이용 분석을 운영하지 않으며, 웹사이트 집계는 데스크톱이나 계정 식별자와 연결하지 않습니다. Sentry 진단은 별도 오류 관측 경로입니다.",
        ],
      },
      {
        title: "안전성 확보조치",
        paragraphs: [
          "DopeDB는 암호화 통신, 서버 권한 재검증, 단기 자격 증명, 암호화된 공급자 승인·메타데이터 백업, 키 없는 Google Cloud 연합, 비밀값을 제거한 로그, 비밀값 없는 공유 템플릿과 운영체제 자격 증명 저장소를 사용합니다. 현재 워크스페이스 역할과 연결 권한에 따라 접근을 제한합니다. 완전한 보안은 보장할 수 없으므로 필요한 최소 클라우드·DB 권한만 부여하고 침해가 의심되면 즉시 알려 주세요.",
        ],
      },
      {
        title: "이용자의 권리와 구제",
        items: [
          `이용자 또는 적법한 대리인은 ${contactEmail}으로 개인정보 열람, 정정, 삭제, 처리 정지·제한, 동의 철회 또는 해당 정보의 사본을 요청할 수 있습니다. 요청이 거절된 경우 이의 제기도 할 수 있습니다. 처리 전에 신원과 권한을 확인할 수 있으며 법률상 요청을 거절해야 하거나 거절할 수 있는 경우 이유를 설명합니다.`,
          "연동 해제, Google 계정에서 DopeDB 권한 철회, 세션 로그아웃 또는 워크스페이스 관리자에게 멤버십 변경·삭제 요청을 할 수 있습니다. 로컬 전용 데스크톱 이용에는 선택형 공급자 연동이 필요하지 않습니다.",
          "추가 구제가 필요하면 개인정보침해 신고센터(https://privacy.kisa.or.kr) 또는 개인정보분쟁조정위원회(https://www.kopico.go.kr)에 도움을 요청할 수 있습니다.",
        ],
      },
      {
        title: "아동, 방침 변경과 언어",
        paragraphs: [
          "DopeDB는 개발자 도구이며 만 16세 미만 아동을 대상으로 하지 않습니다. 호스팅 서비스를 통해 해당 아동의 개인정보를 고의로 수집하지 않으며 이를 알게 되면 적절한 삭제 조치를 합니다.",
          "제품이나 법률 변경에 따라 이 방침을 수정할 수 있습니다. 중요한 변경은 변경된 시행일과 함께 이 페이지에 게시하고 법률이 요구하는 경우 별도로 알립니다. 이전 버전은 개인정보 문의처에 요청할 수 있습니다.",
          "한국어판과 영어판은 같은 의미로 작성되었습니다. 내용이 충돌하면 관련 법률이 허용하는 범위에서 한국어판이 우선합니다.",
        ],
      },
    ],
  },
};

function language(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) === "ko" ? "ko" as const : "en" as const;
}

export async function generateMetadata({ searchParams }: PrivacyProps): Promise<Metadata> {
  const params = searchParams ? await searchParams : {};
  const lang = language(params.lang);
  const canonical = lang === "ko" ? "/ko/privacy" : "/privacy";
  return {
    title: content[lang].title,
    description: content[lang].description,
    alternates: {
      canonical,
      languages: { "en-US": "/privacy", "ko-KR": "/ko/privacy" },
    },
  };
}

export default async function PrivacyPage({ searchParams }: PrivacyProps) {
  const params = searchParams ? await searchParams : {};
  const lang = language(params.lang);
  const page = content[lang];
  return (
    <LegalDocument
      {...page}
      effectiveDate={effectiveDate[lang]}
      lang={lang}
      alternateHref={lang === "ko" ? "/privacy" : "/ko/privacy"}
      alternateLabel={lang === "ko" ? "English" : "한국어"}
    />
  );
}
