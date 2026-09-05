// Derives activity labels from ACP tool identities and progress text. Article
// save status is reserved for exact typed Article operations, never file names
// or words in a shell command.

import type { useI18n } from "../../lib/i18n";
import { recordString } from "./acpTranscriptPresentation";

type Translate = ReturnType<typeof useI18n>["t"];

export function progressActivityLabel(text: string, t: Translate) {
  const normalized = text.toLocaleLowerCase();
  if (/(environment_context|source context|evidence route|근거 범위)/.test(normalized)) {
    return t("agent.acpActivityEvidencePlan");
  }
  if (/(source_search|searching source|source search|소스 검색)/.test(normalized)) {
    return t("agent.acpActivitySourceSearch");
  }
  if (/(source_read|reading source|source code|소스 코드)/.test(normalized)) {
    return t("agent.acpActivitySourceRead");
  }
  if (/(dashboard|chart|visuali[sz]|대시보드|차트|시각화)/.test(normalized)) {
    return t("agent.acpActivityPrepareAnalysis");
  }
  if (/(connection|connect|database status|연결 상태|연결 확인)/.test(normalized)) {
    return t("agent.acpActivityConnection");
  }
  if (
    /(write|insert|update|delete|alter|create|drop|permission|approval|쓰기|추가|수정|삭제|변경|승인)/.test(
      normalized,
    )
  ) {
    return t("agent.acpActivityPrepareChange");
  }
  if (
    /(schema|column|catalog|describe|introspect|relation|스키마|컬럼|구조)/.test(
      normalized,
    )
  ) {
    return t("agent.acpActivityInspectSchema");
  }
  if (
    /(query|select|count|aggregate|row|result|sql|table|조회|쿼리|집계|결과|행|테이블)/.test(
      normalized,
    )
  ) {
    return t("agent.acpActivityQuery");
  }
  return t("agent.acpActivityReasoning");
}

export function toolActivityLabel(
  data: Record<string, unknown>,
  t: Translate,
) {
  const identifiers = [
    recordString(data, "title"),
    recordString(data, "kind"),
    recordString(data, "name"),
    recordString(data, "toolName"),
    recordString(data, "tool_name"),
  ].filter((value): value is string => value !== null);
  const articleOperation = identifiers.map((value) => value.toLocaleLowerCase().match(
    /^(?:(?:mcp[._]+)?dopedb[\w-]*[._]+)?analysis_article_(list|verify|propose|update)$/,
  )?.[1]).find(Boolean);
  if (articleOperation === "list") {
    return t("agent.acpActivityArticleList");
  }
  if (articleOperation === "verify") {
    return t("agent.acpActivityArticleVerify");
  }
  if (articleOperation === "propose") {
    return t("agent.acpActivityArticleCreate");
  }
  if (articleOperation === "update") {
    return t("agent.acpActivityArticleUpdate");
  }
  const identifier = identifiers.join(" ").toLocaleLowerCase();

  if (/tool.?search/.test(identifier)) {
    return t("agent.acpActivityToolSearch");
  }
  if (/environment_context/.test(identifier)) {
    return t("agent.acpActivityEvidencePlan");
  }
  if (/source_search/.test(identifier)) {
    return t("agent.acpActivitySourceSearch");
  }
  if (/source_read/.test(identifier)) {
    return t("agent.acpActivitySourceRead");
  }
  if (
    /table_describe|catalog|schema|describe|introspect|column|relation/.test(
      identifier,
    )
  ) {
    return t("agent.acpActivityInspectSchema");
  }
  if (
    /query_read|query|select|count|aggregate|execute|explain/.test(identifier)
  ) {
    return t("agent.acpActivityQuery");
  }
  if (/connection|database_list|status/.test(identifier)) {
    return t("agent.acpActivityConnection");
  }
  if (
    /propose|write|insert|update|delete|alter|create|drop/.test(identifier)
  ) {
    return t("agent.acpActivityPrepareChange");
  }
  return t("agent.acpActivityGeneric");
}
