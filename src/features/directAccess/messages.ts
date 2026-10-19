// Closed localization maps for direct shared database values: every failure code and
// provisioning state names exactly one catalog key, so no raw server or driver text is
// ever shown. Both the add flow and the member status read these maps.
import type { I18nKey } from "../../lib/i18n";
import type { DirectFailureCode, DirectProvisioningState } from "./domain";

export const DIRECT_FAILURE_KEYS: Readonly<Record<DirectFailureCode, I18nKey>> = {
  marker_mismatch: "directAccess.failure.markerMismatch",
  oid_mismatch: "directAccess.failure.oidMismatch",
  owns_objects: "directAccess.failure.ownsObjects",
  unexpected_membership: "directAccess.failure.unexpectedMembership",
  grantor_insufficient: "directAccess.failure.grantorInsufficient",
  version_unsupported: "directAccess.failure.versionUnsupported",
  endpoint_changed: "directAccess.failure.endpointChanged",
  permission_denied: "directAccess.failure.permissionDenied",
  network: "directAccess.failure.network",
  name_conflict: "directAccess.failure.nameConflict",
  credential_missing: "directAccess.failure.credentialMissing",
};

export const DIRECT_STATE_KEYS: Readonly<Record<DirectProvisioningState, I18nKey>> = {
  not_requested: "directAccess.state.notRequested",
  requested: "directAccess.state.requested",
  applying: "directAccess.state.applying",
  ready: "directAccess.state.ready",
  failed: "directAccess.state.failed",
  drop_pending: "directAccess.state.revoked",
  dropped: "directAccess.state.revoked",
};
