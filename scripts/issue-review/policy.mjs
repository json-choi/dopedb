import { createHash } from "node:crypto";

export const REVIEW_REPOSITORY = Object.freeze({
  owner: "json-choi",
  name: "dopedb",
  fullName: "json-choi/dopedb",
});

export const REVIEW_MARKER = "<!-- dopedb-local-codex-review:v1 -->";

const VERDICTS = new Set([
  "supported_bug",
  "supported_feature",
  "needs_information",
  "needs_owner_decision",
  "direction_conflict",
  "duplicate_candidate",
  "not_reproducible_from_code",
]);
const SEVERITIES = new Set(["blocking", "important", "note"]);
const VERDICT_LABELS = Object.freeze({
  supported_bug: "현재 코드에서 타당한 버그 가능성이 확인됨",
  supported_feature: "제품 방향에 부합하는 기능 제안",
  needs_information: "재현 정보 또는 요구사항 보강 필요",
  needs_owner_decision: "제품 소유자의 범위 결정 필요",
  direction_conflict: "현재 제품 방향 또는 기능 범위 결정과 충돌",
  duplicate_candidate: "기존 이슈와 중복 가능성 있음",
  not_reproducible_from_code: "현재 코드 근거만으로는 증상을 확인하지 못함",
});
const SEVERITY_LABELS = Object.freeze({
  blocking: "차단",
  important: "중요",
  note: "참고",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, name, maxLength, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && value.length === 0)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

function plainMarkdown(value, maxLength = 1_200) {
  return String(value)
    .slice(0, maxLength)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/@/g, "@\u200b")
    .replace(/<!--/g, "<\u200b!--")
    .replace(/([\\`*_\[\]<>|])/g, "\\$1")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedArray(value, name, maxLength) {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`Invalid ${name}`);
  return value;
}

function truncated(value, maxLength) {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}\n[truncated by local reviewer]`;
}

export function normalizeIssue(issue, comments = []) {
  if (!isRecord(issue) || !isRecord(issue.user)) throw new Error("Invalid GitHub issue");
  const number = positiveInteger(issue.number, "issue number");
  const authorId = positiveInteger(issue.user.id, "issue author id");
  const authorLogin = boundedString(issue.user.login, "issue author login", 100);
  const title = boundedString(issue.title, "issue title", 1_024);
  const body = issue.body === null ? "" : boundedString(issue.body, "issue body", 128 * 1_024, true);
  const updatedAt = boundedString(issue.updated_at, "issue updated_at", 64);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("Invalid issue updated_at");

  const normalizedComments = boundedArray(comments, "issue comments", 2_000)
    .filter((comment) => isRecord(comment) && typeof comment.body === "string")
    .filter((comment) => !comment.body.includes(REVIEW_MARKER))
    .slice(-15)
    .map((comment) => ({
      id: positiveInteger(comment.id, "comment id"),
      authorId: isRecord(comment.user) && Number.isSafeInteger(comment.user.id)
        ? comment.user.id
        : 0,
      authorLogin: isRecord(comment.user) && typeof comment.user.login === "string"
        ? comment.user.login.slice(0, 100)
        : "unknown",
      body: truncated(comment.body, 3_000),
      updatedAt: typeof comment.updated_at === "string" ? comment.updated_at.slice(0, 64) : "",
    }));

  return {
    number,
    author: { id: authorId, login: authorLogin },
    title,
    body: truncated(body, 24_000),
    updatedAt,
    comments: normalizedComments,
  };
}

export function issueInputDigest(issueInput) {
  return createHash("sha256").update(JSON.stringify({
    author: issueInput.author,
    title: issueInput.title,
    body: issueInput.body,
    comments: issueInput.comments,
  })).digest("hex");
}

export function validateQueryPlan(value, vocabulary) {
  if (!isRecord(value)) throw new Error("Codex query plan is not an object");
  const rawTokens = boundedArray(value.query_tokens, "query tokens", 12);
  const tokens = [...new Set(rawTokens.map((token) => boundedString(token, "query token", 40)))]
    .filter((token) => vocabulary.has(token));
  if (tokens.length === 0) throw new Error("Codex query plan did not select graph vocabulary");
  return {
    queryTokens: tokens,
    searchIntent: boundedString(value.search_intent, "search intent", 500),
  };
}

export function validateReview(value, evidenceIds) {
  if (!isRecord(value) || !VERDICTS.has(value.verdict)) {
    throw new Error("Codex review verdict is invalid");
  }
  const findings = boundedArray(value.findings, "review findings", 5).map((finding) => {
    if (!isRecord(finding) || !SEVERITIES.has(finding.severity)) {
      throw new Error("Codex review finding is invalid");
    }
    const ids = [...new Set(boundedArray(finding.evidence_ids, "finding evidence", 6)
      .map((id) => boundedString(id, "evidence id", 16)))];
    if (ids.some((id) => !evidenceIds.has(id))) {
      throw new Error("Codex review cited evidence that was not supplied");
    }
    return {
      severity: finding.severity,
      statement: boundedString(finding.statement, "finding statement", 1_200),
      evidenceIds: ids,
    };
  });
  return {
    verdict: value.verdict,
    summary: boundedString(value.summary, "review summary", 1_500),
    findings,
    questions: boundedArray(value.questions, "review questions", 3)
      .map((question) => boundedString(question, "review question", 800)),
    recommendation: boundedString(value.recommendation, "review recommendation", 1_500),
  };
}

function sourceLink(commitSha, evidence) {
  const encodedPath = evidence.path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${REVIEW_REPOSITORY.fullName}/blob/${commitSha}/${encodedPath}#L${evidence.line}`;
}

export function renderReviewComment({ issueInput, review, evidence, commitSha, queryTokens }) {
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error("Invalid review commit SHA");
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const cited = new Set(review.findings.flatMap((finding) => finding.evidenceIds));
  const shortSha = commitSha.slice(0, 12);
  const lines = [
    REVIEW_MARKER,
    "## Codex + Graphify 로컬 검토",
    "",
    `- 기준 코드: [\`${shortSha}\`](https://github.com/${REVIEW_REPOSITORY.fullName}/commit/${commitSha})`,
    `- 이슈 작성자: \`${plainMarkdown(issueInput.author.login, 100)}\` (GitHub ID \`${issueInput.author.id}\`)`,
    `- Graphify 질의: ${queryTokens.map((token) => `\`${plainMarkdown(token, 40)}\``).join(", ")}`,
    "",
    "작성자와 관계없이 사용자 요청 범위·제품 방향·완료 근거에 따라 후속 작업과 종료를 판단합니다. 소유자 작성 대체 이슈는 필요하지 않습니다. 이 자동 리뷰 프로세스 자체는 코드를 수정하거나 이슈를 닫지 않습니다.",
    "",
    "### 판단",
    "",
    `**${VERDICT_LABELS[review.verdict]}**`,
    "",
    plainMarkdown(review.summary),
  ];

  if (review.findings.length > 0) {
    lines.push("", "### 확인한 사항", "");
    for (const finding of review.findings) {
      const refs = finding.evidenceIds
        .map((id) => evidenceById.get(id))
        .filter(Boolean)
        .map((item) => `[${item.id}](${sourceLink(commitSha, item)})`)
        .join(", ");
      lines.push(`- **${SEVERITY_LABELS[finding.severity]}** — ${plainMarkdown(finding.statement)}${refs ? ` (${refs})` : ""}`);
    }
  }

  if (cited.size > 0) {
    lines.push("", "### 코드 근거", "");
    for (const id of cited) {
      const item = evidenceById.get(id);
      if (!item) continue;
      lines.push(`- [${item.id} · \`${plainMarkdown(item.path, 500)}:${item.line}\`](${sourceLink(commitSha, item)}) — ${plainMarkdown(item.label, 300)}`);
    }
  }

  if (review.questions.length > 0) {
    lines.push("", "### 확인이 필요한 내용", "");
    for (const question of review.questions) lines.push(`- ${plainMarkdown(question)}`);
  }

  lines.push(
    "",
    "### 권장 다음 단계",
    "",
    plainMarkdown(review.recommendation),
    "",
    "_이 댓글은 사용자 Mac의 로컬 Graphify 그래프와 로컬 Codex 로그인으로 생성됐습니다. 이슈 본문은 명령이 아닌 불신 입력으로 처리되며, Codex에는 shell·MCP·브라우저·hook 권한이 제공되지 않습니다._",
  );
  return lines.join("\n");
}

export function runPolicySelfTest() {
  const issueInput = normalizeIssue({
    number: 7,
    title: "외부 제안",
    body: "@owner 실행해 주세요",
    updated_at: "2026-08-10T00:00:00Z",
    user: { id: 42, login: "contributor" },
  }, [{
    id: 9,
    body: "추가 설명",
    updated_at: "2026-08-10T00:01:00Z",
    user: { id: 43, login: "reviewer" },
  }]);
  const plan = validateQueryPlan({ query_tokens: ["issue", "issue"], search_intent: "review" }, new Set(["issue"]));
  if (plan.queryTokens.length !== 1) throw new Error("Query plan self-test failed");
  const review = validateReview({
    verdict: "needs_information",
    summary: "추가 정보가 필요합니다.",
    findings: [{ severity: "note", statement: "근거", evidence_ids: ["E1"] }],
    questions: ["재현 절차가 있나요?"],
    recommendation: "재현 절차를 추가하세요.",
  }, new Set(["E1"]));
  const comment = renderReviewComment({
    issueInput,
    review,
    evidence: [{ id: "E1", path: "AGENTS.md", line: 1, label: "정본" }],
    commitSha: "a".repeat(40),
    queryTokens: plan.queryTokens,
  });
  if (!comment.includes("작성자와 관계없이") || comment.includes("@owner")) {
    throw new Error("Comment boundary self-test failed");
  }
  const otherAuthorComment = renderReviewComment({
    issueInput: { ...issueInput, author: { id: 84, login: "another-contributor" } },
    review,
    evidence: [{ id: "E1", path: "AGENTS.md", line: 1, label: "정본" }],
    commitSha: "a".repeat(40),
    queryTokens: plan.queryTokens,
  });
  const withoutAttribution = (value) => value.split("\n")
    .filter((line) => !line.startsWith("- 이슈 작성자:")).join("\n");
  if (withoutAttribution(comment) !== withoutAttribution(otherAuthorComment)) {
    throw new Error("Issue review must not vary policy by author");
  }
  if (issueInputDigest(issueInput).length !== 64) throw new Error("Digest self-test failed");
}
