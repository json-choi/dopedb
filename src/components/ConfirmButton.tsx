// Canonical destructive-action confirmation. The trigger keeps its original
// geometry while the decision moves into a centered, blocking alert dialog.
import { useId, useRef, useState, type ReactNode } from "react";
import {
  Button,
  type ButtonProps,
} from "../design-system/components/Button";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../design-system/components/Modal";
import { useI18n } from "../lib/i18n";
import { floatingPortalOwnerId } from "../design-system/floating";

type ConfirmButtonBaseProps = {
  children: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  confirmLabel?: string;
  presentation?: ButtonProps["presentation"];
  size?: ButtonProps["size"];
  tone?: ButtonProps["tone"];
  variant?: ButtonProps["variant"];
};

export type ConfirmButtonProps = ConfirmButtonBaseProps &
  (
    | { iconOnly: true; label: string }
    | { iconOnly?: false; label?: string }
  );

export default function ConfirmButton({
  children,
  onConfirm,
  disabled,
  confirmLabel,
  label,
  iconOnly = false,
  presentation = "button",
  size = "default",
  tone = "neutral",
  variant = "default",
}: ConfirmButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const generatedId = useId().replace(/:/g, "");
  const dialogId = `confirm-dialog-${generatedId}`;
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const actionLabel = label ?? children;
  const close = () => setOpen(false);

  if (iconOnly && !label?.trim()) {
    throw new Error("ConfirmButton iconOnly requires a non-empty label");
  }

  const commonTriggerProps = {
    ref: triggerRef,
    disabled,
    presentation,
    size,
    tone,
    variant,
    "aria-haspopup": "dialog" as const,
    "aria-expanded": open,
    "aria-controls": open ? dialogId : undefined,
    onClick: () => setOpen(true),
  };
  const trigger = iconOnly ? (
    <Button
      {...commonTriggerProps}
      iconOnly
      title={label ?? ""}
      aria-label={label ?? ""}
    >
      {children}
    </Button>
  ) : (
    <Button {...commonTriggerProps} title={label}>
      {children}
    </Button>
  );

  return (
    <>
      {trigger}
      {open ? (
        <ModalBackdrop
          data-floating-owner-id={floatingPortalOwnerId(triggerRef.current)}
          onMouseDown={close}
        >
          <ModalSurface
            id={dialogId}
            size="alert"
            role="alertdialog"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onRequestClose={close}
            returnFocusRef={triggerRef}
          >
            <ModalHeader title={actionLabel} titleId={titleId} />
            <div className="tw:grid tw:min-w-0 tw:flex-1 tw:content-center tw:gap-2 tw:overflow-auto tw:px-5 tw:py-6 tw:max-[640px]:px-4 tw:max-[640px]:py-5">
              <p
                id={descriptionId}
                className="tw:m-0 tw:min-w-0 tw:text-sm tw:leading-ui tw:text-foreground tw:[overflow-wrap:anywhere]"
              >
                {confirmLabel ?? t("common.reallyDelete")}
              </p>
            </div>
            <ModalFooter>
              <Button data-modal-initial-focus onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={disabled}
                labelBehavior="wrap"
                onClick={() => {
                  close();
                  onConfirm();
                }}
              >
                {actionLabel}
              </Button>
            </ModalFooter>
          </ModalSurface>
        </ModalBackdrop>
      ) : null}
    </>
  );
}
