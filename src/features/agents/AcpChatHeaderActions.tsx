// The AI Chat header owns session navigation and secondary actions.
// Agent and model selection stay in the header's leading slot.

import { Icon } from "../../components/Icon";
import { MenuItem, ToolbarMenu } from "../../design-system/components/Menu";
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
        <MenuItem icon="gear" onClick={commands.setup.openAgentSettings}>
          {t("agent.acpAgentSetup")}
        </MenuItem>
        {active && active.lifecycle !== "closed" && active.lifecycle !== "failed" ? (
          <MenuItem
            icon="trash"
            onClick={() => void commands.session.close()}
          >
            {t("agent.acpCloseSession")}
          </MenuItem>
        ) : null}
      </ToolbarMenu>
      <ToolWindowHideButton label={t("common.close")} onClick={onClose} />
    </>
  );
}
