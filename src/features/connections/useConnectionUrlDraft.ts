// Owns how the Connection editor accepts a connection URL: the input mode, the URL
// draft, its parse into the profile draft, and clipboard import. Profile edits go
// through the profile state's commands, and a password parsed from a URL goes only
// to the credential field, never into the profile.
import { useState, type SetStateAction } from "react";

import { useToast } from "../../components/Toast";
import { isDocumentEngine } from "../../lib/capabilities";
import { useI18n } from "../../lib/i18n";
import { isIntrospectionParameter } from "../catalogExplorer/scopeFilter";
import type { ConnectionInputMode } from "./connectionEditorModel";
import {
  connectionUrlNeedsDatabaseSelection,
  formatConnectionUrl,
  parseConnectionUrl,
} from "./connectionUrl";
import type { ConnectionProfile } from "./domain";
import {
  CONNECTION_INPUT_MODE_PARAMETER,
  isConnectionOptionParameter,
  isConnectionOptionSupported,
} from "./options";

export function useConnectionUrlDraft({
  form,
  setFormValue,
  setPassword,
  invalidate,
}: {
  form: ConnectionProfile;
  setFormValue: (value: SetStateAction<ConnectionProfile>) => void;
  setPassword: (value: string) => void;
  /** Clears the previous check result when an edited URL does not parse. */
  invalidate: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [mode, setMode] = useState<ConnectionInputMode>(() =>
    form.extraParams[CONNECTION_INPUT_MODE_PARAMETER] === "urlOnly"
      ? "urlOnly"
      : "default",
  );
  const [draft, setDraft] = useState(() => formatConnectionUrl(form));

  function selectMode(next: ConnectionInputMode) {
    if (next === mode) return;
    if (next === "urlOnly") {
      setDraft(formatConnectionUrl(form));
    }
    setFormValue((current) => {
      const extraParams = { ...current.extraParams };
      if (next === "urlOnly") {
        extraParams[CONNECTION_INPUT_MODE_PARAMETER] = "urlOnly";
      } else {
        delete extraParams[CONNECTION_INPUT_MODE_PARAMETER];
      }
      return { ...current, extraParams };
    });
    setMode(next);
  }

  function apply(
    raw: string,
    showFeedback: boolean,
    normalizeDraft = false,
    inputMode = mode,
  ) {
    const parsed = parseConnectionUrl(raw);
    if (!parsed) return false;
    const parsedEngine = parsed.update.engine ?? form.engine;
    const internalExtraParams = Object.fromEntries(
      Object.entries(form.extraParams).filter(
        ([key]) =>
          (!isDocumentEngine(parsedEngine) &&
            isIntrospectionParameter(key)) ||
          (isConnectionOptionParameter(key) &&
            isConnectionOptionSupported(key, parsedEngine)),
      ),
    );
    if (inputMode === "urlOnly") {
      internalExtraParams[CONNECTION_INPUT_MODE_PARAMETER] = "urlOnly";
    }
    const nextForm: ConnectionProfile = {
      ...form,
      ...parsed.update,
      name:
        normalizeDraft && !form.name.trim()
          ? (parsed.update.name ?? form.name)
          : form.name,
      extraParams: {
        ...internalExtraParams,
        ...(parsed.update.extraParams ?? {}),
      },
      id: form.id,
      secretRef: form.secretRef,
    };
    // Replacing the draft also clears the previous check result and message.
    setFormValue(nextForm);
    if (parsed.password != null) setPassword(parsed.password);
    if (normalizeDraft) {
      setDraft(formatConnectionUrl(nextForm));
    }
    if (showFeedback) toast(t("connections.clipboardImported"));
    return true;
  }

  function edit(raw: string) {
    invalidate();
    setDraft(raw);
    apply(raw, false);
  }

  function normalize(raw = draft) {
    apply(raw, false, true);
  }

  async function importFromClipboard(showFeedback = true) {
    if (!navigator.clipboard?.readText) {
      if (showFeedback) {
        toast(t("connections.clipboardUnavailable"), "error");
      }
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseConnectionUrl(text);
      const inputMode =
        parsed && connectionUrlNeedsDatabaseSelection(parsed)
          ? "default"
          : "urlOnly";
      const imported = apply(text, showFeedback, true, inputMode);
      if (imported) setMode(inputMode);
      if (!imported && showFeedback) {
        toast(t("connections.clipboardNoConnectionUrl"), "error");
      }
    } catch {
      if (showFeedback) {
        toast(t("connections.clipboardUnavailable"), "error");
      }
    }
  }

  return {
    mode,
    setMode,
    draft,
    setDraft,
    selectMode,
    edit,
    normalize,
    importFromClipboard,
  };
}
