const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CRYPTO_KEY = /^projects\/[A-Za-z0-9._:-]+\/locations\/[A-Za-z0-9_-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/;
const CRYPTO_KEY_VERSION = /^projects\/[A-Za-z0-9._:-]+\/locations\/[A-Za-z0-9_-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+\/cryptoKeyVersions\/[1-9][0-9]*$/;
const WIF_AUDIENCE = /^\/\/iam\.googleapis\.com\/projects\/[1-9][0-9]{5,19}\/locations\/global\/workloadIdentityPools\/[A-Za-z0-9_-]+\/providers\/[A-Za-z0-9_-]+$/;
const SERVICE_ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}@[a-z][a-z0-9-]{4,61}\.iam\.gserviceaccount\.com$/;

export type WorkspaceKmsConfiguration = {
  keyName: string;
  workloadIdentityAudience: string;
  serviceAccountEmail: string;
};

export type WorkspaceWrappedDataKey = {
  kmsKeyVersion: string;
  wrappedKey: string;
};

export class WorkspaceKmsError extends Error {
  constructor(
    readonly kind:
      | "configuration"
      | "oidc"
      | "federation"
      | "impersonation"
      | "encrypt"
      | "decrypt"
      | "integrity"
      | "unavailable",
    readonly status: number,
  ) {
    super(`Workspace KMS ${kind} failed`);
    this.name = "WorkspaceKmsError";
  }
}

export function parseWorkspaceKmsConfiguration(input: {
  keyName: unknown;
  workloadIdentityAudience: unknown;
  serviceAccountEmail: unknown;
}): WorkspaceKmsConfiguration {
  if (
    typeof input.keyName !== "string"
    || !CRYPTO_KEY.test(input.keyName)
    || typeof input.workloadIdentityAudience !== "string"
    || !WIF_AUDIENCE.test(input.workloadIdentityAudience)
    || typeof input.serviceAccountEmail !== "string"
    || !SERVICE_ACCOUNT.test(input.serviceAccountEmail)
  ) {
    throw new WorkspaceKmsError("configuration", 503);
  }
  return {
    keyName: input.keyName,
    workloadIdentityAudience: input.workloadIdentityAudience,
    serviceAccountEmail: input.serviceAccountEmail,
  };
}

export function workspaceDataKeyAad(
  workspaceId: string,
  dataKeyId: string,
  version: number,
) {
  if (
    !UUID.test(workspaceId)
    || !UUID.test(dataKeyId)
    || !Number.isSafeInteger(version)
    || version < 1
    || version > 2_147_483_647
  ) {
    throw new WorkspaceKmsError("integrity", 409);
  }
  return Buffer.from(
    `dopedb:workspace-data-key:v1:${workspaceId.toLowerCase()}:${dataKeyId.toLowerCase()}:v${version}`,
    "utf8",
  );
}

const crc32cTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
  }
  crc32cTable[index] = value >>> 0;
}

export function crc32c(bytes: Uint8Array) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = crc32cTable[(checksum ^ byte) & 0xff]! ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function base64Bytes(value: unknown, maximumBytes: number) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > Math.ceil(maximumBytes / 3) * 4 + 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 1 || bytes.length > maximumBytes) return null;
  if (bytes.toString("base64") !== value) return null;
  return bytes;
}

function checksumMatches(bytes: Uint8Array, value: unknown) {
  const expected = typeof value === "string" && /^[0-9]{1,10}$/.test(value)
    ? Number(value)
    : typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : -1;
  return expected === crc32c(bytes);
}

export function parseKmsEncryptResponse(
  value: unknown,
  keyName: string,
): WorkspaceWrappedDataKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceKmsError("integrity", 502);
  }
  const response = value as Record<string, unknown>;
  const ciphertext = base64Bytes(response.ciphertext, 8_192);
  if (
    typeof response.name !== "string"
    || !CRYPTO_KEY_VERSION.test(response.name)
    || !response.name.startsWith(`${keyName}/cryptoKeyVersions/`)
    || !ciphertext
    || response.verifiedPlaintextCrc32c !== true
    || response.verifiedAdditionalAuthenticatedDataCrc32c !== true
    || !checksumMatches(ciphertext, response.ciphertextCrc32c)
  ) {
    ciphertext?.fill(0);
    throw new WorkspaceKmsError("integrity", 502);
  }
  ciphertext.fill(0);
  return { kmsKeyVersion: response.name, wrappedKey: response.ciphertext as string };
}

export function parseKmsDecryptResponse(value: unknown): Buffer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceKmsError("integrity", 502);
  }
  const response = value as Record<string, unknown>;
  const plaintext = base64Bytes(response.plaintext, 32);
  if (!plaintext || plaintext.length !== 32 || !checksumMatches(plaintext, response.plaintextCrc32c)) {
    plaintext?.fill(0);
    throw new WorkspaceKmsError("integrity", 502);
  }
  return plaintext;
}
