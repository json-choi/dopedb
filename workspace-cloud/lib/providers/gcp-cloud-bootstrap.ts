// Stable Google Cloud bootstrap facade.
export {
  checkGcpSetupPermissions,
  type GcpCloudBootstrapInput,
  type GcpCloudBootstrapResult,
  type GcpSetupPermissionCheck,
  type GcpSetupPermissionRequirement,
} from "./gcp-cloud-bootstrap-core";
export {
  grantTemporaryGcpSetupPermissions,
  revokeTemporaryGcpSetupPermissions,
  type GcpTemporaryPermissionGrant,
} from "./gcp-cloud-bootstrap-iam";
export {
  recoverDatabaseBootstrapUser,
} from "./gcp-cloud-bootstrap-database";
export {
  parseDatabaseBootstrapRecovery,
  type GcpDatabaseBootstrapRecovery,
} from "./gcp-cloud-bootstrap-recovery";
export { bootstrapGcpCloudSql, GcpIamPropagationPendingError } from "./gcp-cloud-bootstrap-application";
