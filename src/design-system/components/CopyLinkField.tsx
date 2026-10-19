// Canonical read-only link with a copy button. It owns the clipboard feedback
// (copied / failed) so every invitation and share link behaves the same way.
import { Icon } from "../../components/Icon";
import { useLinkCopy } from "../../lib/useLinkCopy";
import { Button } from "./Button";
import { TextInput } from "./FormControls";

export function CopyLinkField({
  url,
  label,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  url: string;
  /** Accessible name of the read-only link input. */
  label: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const links = useLinkCopy();
  const copied = links.state?.status === "copied";
  const failed = links.state?.status === "failed";
  return (
    <div className="tw:grid tw:min-w-0 tw:gap-2">
      <div className="ds-control-row tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:[--ds-row-control-size:var(--ds-control-md)]">
        <span className="tw:min-w-0 tw:flex-1">
          <TextInput
            density="compact"
            monospace
            readOnly
            value={url}
            aria-label={label}
            onFocus={(event) => event.currentTarget.select()}
          />
        </span>
        <Button
          size="compact"
          tone={copied ? "success" : "neutral"}
          onClick={() => void links.copyLink("link", url)}
        >
          <Icon name={copied ? "check" : "copy"} />
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="tw:m-0 tw:text-xs tw:text-danger">
          {failedLabel}
        </p>
      ) : null}
    </div>
  );
}
