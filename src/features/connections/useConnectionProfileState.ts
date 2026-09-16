// Owns the editable profile draft, URL projection, connection options, and
// local command status shared by the Connection editor controllers.
import { useEffect, useRef, useState } from "react";

import { useToast } from "../../components/Toast";
import { isDocumentEngine } from "../../lib/capabilities";
import { useI18n } from "../../lib/i18n";
import { isIntrospectionParameter } from "../catalogExplorer/scopeFilter";
import {
  connectionProfileFlags,
  CONTROLLED_CONNECTION_PARAMETERS,
  MONGO_TLS_PARAMETERS,
  sslModeForEngine,
  type ConnectionInputMode,
  type ConnectionTab,
} from "./connectionEditorModel";
import {
  connectionUrlNeedsDatabaseSelection,
  formatConnectionUrl,
  parseConnectionUrl,
} from "./connectionUrl";
import type { ConnectionProfile } from "./domain";
import type { ConnectionTestFailure } from "./domain";
import {
  CONNECTION_INPUT_MODE_PARAMETER,
  isConnectionOptionParameter,
  isConnectionOptionSupported,
} from "./options";
import {
  blankConnection,
  type ConnectionLaunchPreset,
} from "./presets";
import { pickConnectionFile } from "./tauriAdapter";

/**
 * Fields that cannot change whether this connection opens. Every other edit
 * discards the last check result, because leaving a success marker next to a
 * changed setting reads as "this was verified" when nothing verified it.
 */
const NON_CONNECTIVITY_FIELDS = new Set<keyof ConnectionProfile>([
  "name",
  "env",
  "readonlyDefault",
  "allowWrites",
  "schemaGroup",
]);

export function useConnectionProfileState({
  initial,
  preset,
}: {
  initial: ConnectionProfile | null;
  preset: ConnectionLaunchPreset | null;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState<ConnectionProfile>(() => {
    const profile = initial ?? blankConnection(preset);
    return {
      ...profile,
      sslmode: sslModeForEngine(profile.engine, profile.sslmode),
    };
  });
  const [isNew, setIsNew] = useState(initial === null);
  const [persisted, setPersisted] = useState(initial !== null);
  const [nameInteracted, setNameInteracted] = useState(false);
  const [password, setPassword] = useState("");
  const [portDraft, setPortDraftState] = useState(() => String(form.port));
  const [connectionInputMode, setConnectionInputMode] =
    useState<ConnectionInputMode>(
      form.extraParams[CONNECTION_INPUT_MODE_PARAMETER] === "urlOnly"
        ? "urlOnly"
        : "default",
    );
  const [connectionUrlDraft, setConnectionUrlDraft] = useState(() =>
    formatConnectionUrl(form),
  );
  const [activeTab, setActiveTab] = useState<ConnectionTab>("general");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<
    "save" | "apply" | "test" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [testFailure, setTestFailure] = useState<ConnectionTestFailure | null>(null);
  // Counts how many times the draft stopped matching what was last checked. A probe
  // reads it before it starts and again when it returns, so a late answer about the
  // previous settings cannot mark the edited form as verified. It is a plain counter
  // and never records a field value, so no secret ends up in state identity.
  const validityRevision = useRef(0);
  const flags = connectionProfileFlags(form);
  const advancedParameters = Object.entries(form.extraParams).filter(
    ([key]) =>
      !isIntrospectionParameter(key) &&
      !CONTROLLED_CONNECTION_PARAMETERS.has(key),
  );

  useEffect(() => {
    setPortDraftState(String(form.port));
  }, [form.port]);

  function invalidateCheckedResult() {
    validityRevision.current += 1;
    setMessage(null);
    setMessageIsError(false);
    setTestFailure(null);
  }

  function replaceValue(...args: Parameters<typeof setForm>) {
    invalidateCheckedResult();
    setForm(...args);
  }

  function set<K extends keyof ConnectionProfile>(
    key: K,
    value: ConnectionProfile[K],
  ) {
    if (key === "name") setNameInteracted(true);
    if (!NON_CONNECTIVITY_FIELDS.has(key)) invalidateCheckedResult();
    setForm((current) => ({ ...current, [key]: value }));
  }

  function editPassword(value: string) {
    invalidateCheckedResult();
    setPassword(value);
  }

  function setPortDraft(value: string) {
    setPortDraftState(value);
    invalidateCheckedResult();
    if (!/^\d+$/u.test(value)) return;
    const port = Number(value);
    if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) {
      set("port", port);
    }
  }

  function setExtraParameter(key: string, value: string) {
    replaceValue((current) => {
      const extraParams = { ...current.extraParams };
      if (value) extraParams[key] = value;
      else delete extraParams[key];
      return { ...current, extraParams };
    });
  }

  function setSrv(checked: boolean) {
    replaceValue((current) => {
      const extraParams = { ...current.extraParams };
      if (checked) extraParams.srv = "true";
      else delete extraParams.srv;
      return { ...current, extraParams };
    });
  }

  function setMongoTls(checked: boolean) {
    replaceValue((current) => {
      const extraParams = { ...current.extraParams };
      if (checked) {
        extraParams.tls = "true";
      } else {
        for (const key of MONGO_TLS_PARAMETERS) delete extraParams[key];
      }
      return { ...current, extraParams };
    });
  }

  function toggleTimedConnectionOption(
    key: string,
    checked: boolean,
    defaultSeconds: number,
  ) {
    setExtraParameter(key, checked ? String(defaultSeconds) : "");
  }

  function setTimedConnectionOptionValue(key: string, value: string) {
    replaceValue((current) => ({
      ...current,
      extraParams: {
        ...current.extraParams,
        [key]: value,
      },
    }));
  }

  async function pickExtraParameterFile(key: string) {
    const file = await pickConnectionFile();
    if (file) setExtraParameter(key, file);
  }

  async function pickDatabaseFile() {
    const file = await pickConnectionFile();
    if (file) set("database", file);
  }

  function updateAdvancedParameter(
    currentKey: string,
    nextKey: string,
    nextValue: string,
  ) {
    replaceValue((current) => {
      const extraParams = { ...current.extraParams };
      delete extraParams[currentKey];
      if (nextKey.trim()) extraParams[nextKey] = nextValue;
      return { ...current, extraParams };
    });
  }

  function addAdvancedParameter() {
    replaceValue((current) => {
      let suffix = 1;
      let key = "parameter";
      while (key in current.extraParams) {
        suffix += 1;
        key = `parameter${suffix}`;
      }
      return {
        ...current,
        extraParams: { ...current.extraParams, [key]: "" },
      };
    });
  }

  function removeAdvancedParameter(key: string) {
    replaceValue((current) => {
      const extraParams = { ...current.extraParams };
      delete extraParams[key];
      return { ...current, extraParams };
    });
  }

  function selectConnectionInputMode(mode: ConnectionInputMode) {
    if (mode === connectionInputMode) return;
    if (mode === "urlOnly") {
      setConnectionUrlDraft(formatConnectionUrl(form));
    }
    setForm((current) => {
      const extraParams = { ...current.extraParams };
      if (mode === "urlOnly") {
        extraParams[CONNECTION_INPUT_MODE_PARAMETER] = "urlOnly";
      } else {
        delete extraParams[CONNECTION_INPUT_MODE_PARAMETER];
      }
      return { ...current, extraParams };
    });
    setConnectionInputMode(mode);
    invalidateCheckedResult();
  }

  function applyConnectionUrl(
    raw: string,
    showFeedback: boolean,
    normalizeDraft = false,
    inputMode = connectionInputMode,
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
    replaceValue(nextForm);
    if (parsed.password != null) setPassword(parsed.password);
    if (normalizeDraft) {
      setConnectionUrlDraft(formatConnectionUrl(nextForm));
    }
    if (showFeedback) toast(t("connections.clipboardImported"));
    return true;
  }

  function editConnectionUrl(raw: string) {
    setConnectionUrlDraft(raw);
    applyConnectionUrl(raw, false);
  }

  function normalizeConnectionUrl(raw = connectionUrlDraft) {
    applyConnectionUrl(raw, false, true);
  }

  async function importConnectionUrlFromClipboard(showFeedback = true) {
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
      const imported = applyConnectionUrl(text, showFeedback, true, inputMode);
      if (imported) setConnectionInputMode(inputMode);
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
    form: {
      value: form,
      setValue: replaceValue,
      set,
      nameInteracted,
      revealNameValidation: () => setNameInteracted(true),
      portDraft,
      setPortDraft,
      flags,
      advancedParameters,
      addAdvancedParameter,
      removeAdvancedParameter,
      updateAdvancedParameter,
      setExtraParameter,
      setMongoTls,
      setSrv,
      toggleTimedConnectionOption,
      setTimedConnectionOptionValue,
      pickDatabaseFile,
      pickExtraParameterFile,
    },
    identity: { isNew, setIsNew, persisted, setPersisted },
    credentials: { password, setPassword: editPassword },
    tabs: { active: activeTab, setActive: setActiveTab },
    url: {
      mode: connectionInputMode,
      setMode: setConnectionInputMode,
      draft: connectionUrlDraft,
      setDraft: setConnectionUrlDraft,
      selectMode: selectConnectionInputMode,
      edit: editConnectionUrl,
      normalize: normalizeConnectionUrl,
      importFromClipboard: importConnectionUrlFromClipboard,
    },
    status: {
      busy,
      setBusy,
      running,
      setRunning,
      message,
      setMessage,
      messageIsError,
      setMessageIsError,
      testFailure,
      setTestFailure,
      readValidityRevision: () => validityRevision.current,
    },
  };
}

export type ConnectionProfileState = ReturnType<
  typeof useConnectionProfileState
>;
