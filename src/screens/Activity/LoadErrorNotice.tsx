// The one Activity load-failure row: a danger notice with a single retry action.
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";

export default function LoadErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <InlineNotice
      tone="danger"
      icon="alert"
      role="alert"
      action={
        <Button size="xs" onClick={onRetry}>
          {t("activity.retry")}
        </Button>
      }
    >
      {message}
    </InlineNotice>
  );
}
