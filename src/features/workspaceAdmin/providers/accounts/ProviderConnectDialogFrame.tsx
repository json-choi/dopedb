// Shared frame of the provider credential forms: a blocking dialog whose single
// submit verifies the input with the workspace service. It cannot be dismissed
// while that request runs, and a backdrop click never discards typed input.
import type { ReactNode } from "react";

import { Button } from "../../../../design-system/components/Button";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../../../design-system/components/Modal";
import { useI18n } from "../../../../lib/i18n";

export default function ProviderConnectDialogFrame({
  titleId,
  title,
  submitLabel,
  submitting,
  onCancel,
  onSubmit,
  children,
}: {
  titleId: string;
  title: string;
  submitLabel: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <ModalBackdrop>
      <ModalSurface
        aria-labelledby={titleId}
        aria-busy={submitting}
        onRequestClose={onCancel}
        dismissible={!submitting}
      >
        <ModalHeader title={title} titleId={titleId} />
        <form
          className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!submitting) onSubmit();
          }}
        >
          <div className="tw:grid tw:min-h-0 tw:min-w-0 tw:flex-1 tw:content-start tw:gap-4 tw:overflow-auto tw:bg-background tw:p-4">
            {children}
          </div>
          <ModalFooter>
            <Button disabled={submitting} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              disabledBehavior="focusable"
            >
              {submitting ? t("workspaceProviders.verifying") : submitLabel}
            </Button>
          </ModalFooter>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
