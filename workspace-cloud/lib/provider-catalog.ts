// Public catalog of provider adapters that can complete discovery, read-only
// import, and managed credential issuance today. Undecided providers do not get
// placeholders or capability claims; PD-18 owns any future expansion.

export const providerKinds = [
  "gcpCloudSql",
  "neon",
  "planetScale",
  "vault",
] as const;

export type ProviderKind = (typeof providerKinds)[number];

export interface ProviderDescriptor {
  id: ProviderKind;
  name: string;
  supportedEngines: readonly string[];
  leaseSeconds: number | null;
  setupKind: "oauth" | "apiKey" | "appRole";
  resourceLevels: readonly [
    { key: string; kind: string; label: string },
    { key: string; kind: string; label: string },
    { key: string; kind: string; label: string },
  ];
  note: string;
}

export const providerCatalog: readonly ProviderDescriptor[] = [
  {
    id: "planetScale",
    name: "PlanetScale",
    supportedEngines: ["postgres", "mysql"],
    leaseSeconds: 15 * 60,
    setupKind: "oauth",
    resourceLevels: [
      { key: "organization", kind: "organizations", label: "조직" },
      { key: "database", kind: "databases", label: "DB" },
      { key: "branch", kind: "branches", label: "브랜치" },
    ],
    note: "OAuth로 연결하고 구성원별 TTL 역할 또는 비밀번호를 발급합니다.",
  },
  {
    id: "gcpCloudSql",
    name: "GCP Cloud SQL",
    supportedEngines: ["postgres", "mysql"],
    leaseSeconds: 15 * 60,
    setupKind: "oauth",
    resourceLevels: [
      { key: "project", kind: "projects", label: "프로젝트" },
      { key: "instance", kind: "instances", label: "인스턴스" },
      { key: "database", kind: "databases", label: "DB" },
    ],
    note: "Google 로그인 후 프로젝트와 인스턴스만 선택하면 역할 기반 IAM 접근과 단기 자격증명 회전을 자동 구성합니다.",
  },
  {
    id: "neon",
    name: "Neon",
    supportedEngines: ["postgres"],
    leaseSeconds: 15 * 60,
    setupKind: "apiKey",
    resourceLevels: [
      { key: "project", kind: "projects", label: "프로젝트" },
      { key: "branch", kind: "branches", label: "브랜치" },
      { key: "database", kind: "databases", label: "DB" },
    ],
    note: "프로젝트 범위 API 키로 15분 제한 역할을 만들고 만료·회수합니다.",
  },
  {
    id: "vault",
    name: "HashiCorp Vault",
    supportedEngines: ["postgres", "mysql"],
    leaseSeconds: 15 * 60,
    setupKind: "appRole",
    resourceLevels: [
      { key: "broker", kind: "brokers", label: "브로커" },
      { key: "target", kind: "targets", label: "대상" },
      { key: "database", kind: "databases", label: "DB" },
    ],
    note: "허용된 Vault AppRole로 구성원별 15분 이하 동적 DB 자격증명을 발급·회수합니다.",
  },
] as const;
