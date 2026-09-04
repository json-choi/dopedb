import LazySqlViewer from "../../components/LazySqlViewer";
import { Button } from "../../design-system/components/Button";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import { LoadingLabel } from "../../design-system/components/Status";
import { useTableDdl } from "../../features/catalog/useTableDdl";
import type { ConnectionProfile } from "../../features/connections/domain";
import type { CatalogTable } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { tableLabel } from "../../lib/tableRef";

export default function DdlModal({
  connection,
  table,
  onClose,
}: {
  connection: ConnectionProfile;
  table: CatalogTable;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { text, error, copied, copy } = useTableDdl(
    connection.id,
    table.name,
    table.schema,
    table.database,
  );
  return (
    <ModalBackdrop onMouseDown={onClose}>
      <ModalSurface
        aria-labelledby="ddl-dialog-title"
        aria-busy={text == null && !error}
        onRequestClose={onClose}
      >
        <ModalHeader
          title={t("connections.ddlTitle", {
            table: tableLabel(connection.engine, table),
          })}
          titleId="ddl-dialog-title"
        />
        <div className="tw:min-h-[112px] tw:min-w-0 tw:max-h-[min(60dvh,560px)] tw:flex-none tw:overflow-auto tw:bg-background tw:p-3">
          {error ? (
            <div className="tw:text-ui tw:text-danger" role="alert">
              {error}
            </div>
          ) : null}
          {!error && text == null && (
            <div className="tw:px-2 tw:py-1">
              <LoadingLabel>{t("common.loading")}</LoadingLabel>
            </div>
          )}
          {text != null && <LazySqlViewer value={text} minHeight="96px" />}
        </div>
        <ModalFooter>
          <Button
            onClick={() => void copy()}
            disabled={!text}
          >
            {copied ? t("common.copied") : t("common.copy")}
          </Button>
          <Button onClick={onClose}>
            {t("common.close")}
          </Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
