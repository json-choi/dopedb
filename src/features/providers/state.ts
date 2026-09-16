// Owns credential-dialog phase transitions and the current one-use verification receipt.

import type {
  ProviderCredentialReceipt,
  ProviderCredentialDialogStatus,
  ProviderIntegrationId,
} from "./domain";

export type ProviderCredentialDialogState = Readonly<{
  selectedIntegrationId: ProviderIntegrationId | null;
  receipt: ProviderCredentialReceipt | null;
  phase: "selecting" | "credentials" | "verifying" | "complete";
  status: ProviderCredentialDialogStatus | null;
}>;

export const initialProviderCredentialDialogState: ProviderCredentialDialogState = {
  selectedIntegrationId: null,
  receipt: null,
  phase: "selecting",
  status: null,
};

export type ProviderCredentialDialogAction =
  | { type: "select"; integrationId: ProviderIntegrationId }
  | { type: "submit" }
  | { type: "receipt"; receipt: ProviderCredentialReceipt }
  | { type: "verified"; status: ProviderCredentialDialogStatus }
  | { type: "status"; status: ProviderCredentialDialogStatus }
  | { type: "discard" };

/** The dialog reducer is the only writer for ephemeral receipts and secret form text. */
export function providerCredentialDialogReducer(
  state: ProviderCredentialDialogState,
  action: ProviderCredentialDialogAction,
): ProviderCredentialDialogState {
  switch (action.type) {
    case "select":
      return {
        selectedIntegrationId: action.integrationId,
        receipt: null,
        phase: "credentials",
        status: null,
      };
    case "submit":
      return { ...state, receipt: null, phase: "verifying", status: null };
    case "receipt":
      return {
        ...state,
        receipt: action.receipt,
        phase: "verifying",
        status: null,
      };
    case "verified":
      return { ...state, receipt: null, phase: "complete", status: action.status };
    case "status":
      return { ...state, receipt: null, phase: "credentials", status: action.status };
    case "discard":
      return initialProviderCredentialDialogState;
  }
}
