// The one notice for a connection problem a person can fix: a message, an
// optional title, and at most one recovery command. Credential, managed
// workspace and check-failure surfaces decide the copy and command and render
// it here on the shared inline notice.
import { Button } from "../../design-system/components/Button";
import { InlineNotice } from "../../design-system/components/Status";

export interface RecoveryAction {
  label: string;
  run: () => void;
  disabled?: boolean;
}

export default function RecoveryNotice({
  title,
  message,
  action,
}: {
  title?: string;
  message: string;
  action?: RecoveryAction | null;
}) {
  return (
    <InlineNotice
      tone="danger"
      icon="alert"
      role="alert"
      action={action ? (
        <Button size="compact" disabled={action.disabled} onClick={action.run}>
          {action.label}
        </Button>
      ) : undefined}
    >
      {title ? (
        <strong className="tw:block tw:font-semibold tw:text-danger">{title}</strong>
      ) : null}
      {message}
    </InlineNotice>
  );
}
