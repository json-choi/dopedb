// The AI Chat header owns session navigation and secondary actions.
// Agent and model selection stay in the header's leading slot.

import { Icon } from "../../components/Icon";
import ToolbarMenu, { ToolbarMenuItem } from "../../components/ToolbarMenu";
import { Button } from "../../design-system/components/Button";
import { ToolWindowHideButton } from "../../design-system/components/ToolWindow";
import { useI18n } from "../../lib/i18n";
import type { AcpChatController } from "./useAcpChatController";

export function AcpChatHeaderActions({
  session,
  commands,
  onClose,
}: Pick<AcpChatController, "session" | "commands"> & {
  onClose: () => void;
}) {
  const { t } = useI18n();
  const active = session.active;
  return (
    <>
      <Button
        iconOnly
        size="xs"
        variant="ghost"
        data-agent-focus-target="session-control"
        disabled={session.starting}
        onClick={commands.session.beginNewChat}
        title={t("agent.acpNew")}
        aria-label={t("agent.acpNew")}
      >
        <Icon name="plus" />
      </Button>
      <Button
        iconOnly
        size="xs"
        variant="ghost"
        aria-pressed={session.historyOpen}
        onClick={commands.session.toggleHistory}
        title={t("agent.acpSessions")}
        aria-label={t("agent.acpSessions")}
      >
        <Icon name="history" />
      </Button>
      <ToolbarMenu
        align="end"
        triggerVariant="compact"
        icon="moreVertical"
        label={t("agent.acpMore")}
      >
        <ToolbarMenuItem icon="gear" onClick={commands.setup.openAgentSetup}>
          {t("agent.acpAgentSetup")}
        </ToolbarMenuItem>
        {active && active.lifecycle !== "closed" && active.lifecycle !== "failed" ? (
          <ToolbarMenuItem
            icon="trash"
            onClick={() => void commands.session.close()}
          >
            {t("agent.acpCloseSession")}
          </ToolbarMenuItem>
        ) : null}
      </ToolbarMenu>
      <ToolWindowHideButton label={t("common.close")} onClick={onClose} />
    </>
  );
}
