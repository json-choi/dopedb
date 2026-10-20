// Localized environment marker: the shared badge primitive plus the kind's display name.
import { EnvironmentBadge } from "../design-system/components/EnvironmentBadge";
import { ENVIRONMENT_KIND_LABEL_KEYS, type EnvironmentKind } from "../lib/environmentKind";
import { useI18n } from "../lib/i18n";

export function EnvironmentKindBadge({ kind }: { kind: EnvironmentKind }) {
  const { t } = useI18n();
  return <EnvironmentBadge kind={kind} label={t(ENVIRONMENT_KIND_LABEL_KEYS[kind])} />;
}
