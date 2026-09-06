// Derives operation labels from ACP tool identities. Free-form reasoning does
// not establish that a database or Article operation actually ran.

import type { useI18n } from "../../lib/i18n";
import { recordString } from "./acpTranscriptPresentation";

type Translate = ReturnType<typeof useI18n>["t"];

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
    /^(?:(?:mcp[._]+)?dopedb[\w-]*[._]+)?analysis_article_(guide|list|verify|propose|update)$/,
  )?.[1]).find(Boolean);
  if (articleOperation === "guide") {
    return t("agent.acpActivityArticleGuide");
  }
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
