// Canonical destructive-action confirmation. The trigger keeps its original
// geometry while the decision moves into the shared blocking ConfirmDialog.
import { useId, useRef, useState, type ReactNode } from "react";
import {
  Button,
  type ButtonProps,
} from "../design-system/components/Button";
import { useI18n } from "../lib/i18n";
import ConfirmDialog from "./ConfirmDialog";

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
        <ConfirmDialog
          id={dialogId}
          title={actionLabel}
          description={confirmLabel ?? t("common.reallyDelete")}
          confirmLabel={actionLabel}
          confirmDisabled={disabled}
          onCancel={close}
          onConfirm={() => {
            close();
            onConfirm();
          }}
          returnFocusRef={triggerRef}
        />
      ) : null}
    </>
  );
}
