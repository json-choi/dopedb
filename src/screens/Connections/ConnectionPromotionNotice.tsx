// Tells the member what happened to connections that were only on this device in a team
// workspace: how many were just shared with the team (one toast per increase), and why
// the rest stay local (the role cannot share, the service was unreachable, or it was
// refused). Reads the closed counts the workspace sync keeps; no names or server text.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useToast } from "../../components/Toast";
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";
import { workspaceAuthStateQuery } from "../../features/workspaces/queries";
import { useI18n, type I18nKey } from "../../lib/i18n";

/** Connections shared since launch that a toast already announced. */
let announcedPromoted = 0;

type Waiting = "roleDenied" | "unreachable" | "refused";

const WAITING: readonly { reason: Waiting; message: I18nKey }[] = [
  { reason: "roleDenied", message: "workspace.promotion.roleDenied" },
  { reason: "refused", message: "workspace.promotion.refused" },
  { reason: "unreachable", message: "workspace.promotion.unreachable" },
];

export function ConnectionPromotionNotice() {
  const { t } = useI18n();
  const toast = useToast();
  const status = useQuery(workspaceAuthStateQuery()).data?.connectionPromotion;
  const [dismissed, setDismissed] = useState<ReadonlySet<Waiting>>(new Set());

  useEffect(() => {
    if (!status || status.promoted <= announcedPromoted) return;
    toast(t("workspace.promotion.promoted", { count: status.promoted - announcedPromoted }));
    announcedPromoted = status.promoted;
  }, [status, t, toast]);

  const rows = WAITING.filter(({ reason }) => (status?.[reason] ?? 0) > 0 && !dismissed.has(reason));
  if (!status || rows.length === 0) return null;
  return (
    <div className="tw:grid tw:gap-1 tw:px-2 tw:pt-1">
      {rows.map(({ reason, message }) => (
        <InlineNotice
          key={reason}
          tone="warning"
          icon={reason === "unreachable" ? "info" : "alert"}
          role="status"
          action={(
            <Button
              size="compact"
              variant="ghost"
              onClick={() => setDismissed((current) => new Set(current).add(reason))}
            >
              {t("common.close")}
            </Button>
          )}
        >
          {t(message, { count: status[reason] })}
        </InlineNotice>
      ))}
    </div>
  );
}
