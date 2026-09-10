// Inline two-step confirm: one click arms it ("Really delete? Yes / No"), auto-reverts
// after 3s if untouched. No window.confirm.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  type ButtonProps,
} from "../design-system/components/Button";
import { useI18n } from "../lib/i18n";

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
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!armed) {
    const arm = () => {
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), 3000);
    };
    if (iconOnly) {
      if (!label?.trim()) {
        throw new Error("ConfirmButton iconOnly requires a non-empty label");
      }
      return (
        <Button
          disabled={disabled}
          iconOnly
          presentation={presentation}
          size={size}
          tone={tone}
          variant={variant}
          title={label}
          aria-label={label}
          onClick={arm}
        >
          {children}
        </Button>
      );
    }
    return (
      <Button
        disabled={disabled}
        presentation={presentation}
        size={size}
        tone={tone}
        variant={variant}
        title={label}
        onClick={arm}
      >
        {children}
      </Button>
    );
  }

  return (
    <span className="tw:inline-flex tw:items-center tw:gap-[var(--ds-control-gap)]">
      <span className="tw:text-muted-foreground">
        {confirmLabel ?? t("common.reallyDelete")}
      </span>
      <Button
        size={size}
        variant="danger"
        disabled={disabled}
        onClick={() => {
          window.clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        }}
      >
        {t("common.yes")}
      </Button>
      <Button
        size={size}
        autoFocus
        disabled={disabled}
        onClick={() => {
          window.clearTimeout(timer.current);
          setArmed(false);
        }}
      >
        {t("common.no")}
      </Button>
    </span>
  );
}
