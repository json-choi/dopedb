// Presents the editor footer for profile and catalog modes.
import { Button } from "../../design-system/components/Button";
import { ModalFooter } from "../../design-system/components/Modal";
import type { ConnectionEditorController } from "../../features/connections/useConnectionEditorController";
import type { ConnectionEditorProps } from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";

export function ConnectionEditorFooter({
  view,
  canEditConnection,
  commands,
  onCancel,
}: {
  view: ConnectionEditorController["catalog"]["navigation"]["view"];
  canEditConnection: boolean;
  commands: ConnectionEditorController["commands"];
  onCancel: ConnectionEditorProps["onCancel"];
}) {
  const { t } = useI18n();

  return (
    <ModalFooter>
      {view === "dataSources" ? (
        canEditConnection ? (
          <>
            <Button
              size="compact"
              disabled={commands.busy}
              onClick={onCancel}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={commands.busy}
              size="compact"
              onClick={() => void commands.save(false)}
            >
              {commands.running === "apply"
                ? t("common.saving")
                : t("common.apply")}
            </Button>
            <Button
              variant="primary"
              disabled={commands.busy}
              size="compact"
              onClick={() => void commands.save(true)}
            >
              {commands.running === "save"
                ? t("common.saving")
                : t("common.ok")}
            </Button>
          </>
        ) : (
          <Button
            size="compact"
            disabled={commands.busy}
            onClick={onCancel}
          >
            {t("common.close")}
          </Button>
        )
      ) : (
        <Button
          size="compact"
          disabled={commands.busy}
          onClick={onCancel}
        >
          {t("common.close")}
        </Button>
      )}
    </ModalFooter>
  );
}
