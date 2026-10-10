// Canonical blocking confirmation dialog: a centered alertdialog with an impact
// description, Cancel as the first focus, and one destructive action. Backdrop
// clicks and Escape cancel, it never dismisses itself, and focus returns to
// `returnFocusRef` when it closes. ConfirmButton opens it from a trigger; flows
// that start elsewhere (a held window close) render it directly.
import { useId, type ReactNode, type RefObject } from "react";
import { Button } from "../design-system/components/Button";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../design-system/components/Modal";
import { floatingPortalOwnerId } from "../design-system/floating";
import { useI18n } from "../lib/i18n";

export type ConfirmDialogProps = {
  id?: string;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  /** The confirmed action is running: both actions stay focusable but inert. */
  pending?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export default function ConfirmDialog({
  id,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled,
  pending = false,
  returnFocusRef,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const generatedId = useId().replace(/:/g, "");
  const dialogId = id ?? `confirm-dialog-${generatedId}`;
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const busy = pending
    ? ({ disabled: true, disabledBehavior: "focusable" } as const)
    : {};

  return (
    <ModalBackdrop
      data-floating-owner-id={floatingPortalOwnerId(returnFocusRef?.current ?? null)}
      onMouseDown={onCancel}
    >
      <ModalSurface
        id={dialogId}
        size="alert"
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={pending || undefined}
        onRequestClose={onCancel}
        returnFocusRef={returnFocusRef}
      >
        <ModalHeader title={title} titleId={titleId} />
        <div className="tw:grid tw:min-w-0 tw:flex-1 tw:content-center tw:gap-2 tw:overflow-auto tw:px-5 tw:py-6 tw:max-[640px]:px-4 tw:max-[640px]:py-5">
          <p
            id={descriptionId}
            className="tw:m-0 tw:min-w-0 tw:text-sm tw:leading-ui tw:text-foreground tw:[overflow-wrap:anywhere]"
          >
            {description}
          </p>
        </div>
        <ModalFooter>
          <Button data-modal-initial-focus onClick={onCancel} {...busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={confirmDisabled}
            labelBehavior="wrap"
            onClick={onConfirm}
            {...busy}
          >
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalSurface>
    </ModalBackdrop>
  );
}
