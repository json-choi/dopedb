// Window-close and app-quit confirmation while manual transactions are open.
// The backend holds the request and asks here. Each request is acknowledged
// only after the dialog has rendered, so the backend can tell a missing or
// broken renderer from a person deciding. Cancel keeps the app open; confirming
// lets the backend roll every open transaction back (never commit) and close.
import { useEffect, useState } from "react";

import ConfirmDialog from "../../components/ConfirmDialog";
import { useI18n } from "../../lib/i18n";
import {
  onManualTransactionExitRequested,
  respondManualTransactionExit,
  type ManualTransactionExitRequest,
} from "./tauriAdapter";

export default function ManualTransactionExitGuard() {
  const { t } = useI18n();
  const [request, setRequest] = useState<ManualTransactionExitRequest | null>(null);
  const [closing, setClosing] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const pending = onManualTransactionExitRequested(setRequest);
    return () => {
      void pending.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  // Every request arrives as a new object, so each one is acknowledged once
  // the dialog showing it has been committed.
  useEffect(() => {
    if (request) void respondManualTransactionExit("shown").catch(() => {});
  }, [request]);

  if (!request) return null;

  const cancel = () => {
    if (closing) return;
    setRequest(null);
    setFailed(false);
    void respondManualTransactionExit("cancelled").catch(() => {});
  };
  const confirm = () => {
    if (closing) return;
    setClosing(true);
    setFailed(false);
    // Success closes the app; the dialog only needs to handle a failure.
    respondManualTransactionExit("confirmed")
      .catch(() => setFailed(true))
      .finally(() => setClosing(false));
  };

  return (
    <ConfirmDialog
      title={t("ide.manualTransaction.exit.title")}
      description={
        <>
          {t("ide.manualTransaction.exit.message", { count: request.count })}
          {failed ? (
            <span role="alert" className="tw:mt-2 tw:block tw:text-danger">
              {t("ide.manualTransaction.exit.failed")}
            </span>
          ) : null}
        </>
      }
      confirmLabel={
        closing
          ? t("ide.manualTransaction.exit.closing")
          : t("ide.manualTransaction.exit.confirm", { count: request.count })
      }
      pending={closing}
      onCancel={cancel}
      onConfirm={confirm}
    />
  );
}
