// Owns the editable profile draft, connection options, required-field reveal
// state, saved-password removal, tab focus, and local command status shared by
// the Connection editor controllers, including the check cooldown every surface
// counts down. It composes the URL draft, the free-form parameter rows, and the
// unsaved-change decision, and other controllers change the draft only through
// the commands returned here.
import { useEffect, useRef, useState, type SetStateAction } from "react";

import {
  connectionProfileFlags,
  MONGO_TLS_PARAMETERS,
  sslModeForEngine,
  type ConnectionTab,
} from "./connectionEditorModel";
import type { ConnectionProfile, ConnectionTestIssue } from "./domain";
import {
  blankConnection,
  type ConnectionLaunchPreset,
} from "./presets";
import { pickConnectionFile } from "./tauriAdapter";
import { useAdvancedParameterRows } from "./useAdvancedParameterRows";
import { useConnectionDraftChanges } from "./useConnectionDraftChanges";
import { useConnectionUrlDraft } from "./useConnectionUrlDraft";

/** The editor command whose failure an error message reports. */
export type ConnectionCommandStage = "save" | "delete" | "driver" | "refresh";

/**
 * Profile fields that never change which server or credential the draft uses.
 * The target database is one of them: choosing among discovered databases must
 * not discard the list it was chosen from.
 */
const SERVER_NEUTRAL_FIELDS = new Set<keyof ConnectionProfile>([
  "name",
  "env",
  "schemaGroup",
  "readonlyDefault",
  "database",
]);

/** Field ids whose required-value diagnostics wait for a touch or an attempt. */
const PROFILE_FIELD_IDS: Partial<Record<keyof ConnectionProfile, string>> = {
  name: "connection-name",
  host: "connection-host",
  database: "connection-database",
  driverId: "connection-driver",
};

export function useConnectionProfileState({
  initial,
  preset,
}: {
  initial: ConnectionProfile | null;
  preset: ConnectionLaunchPreset | null;
}) {
  const [initialDraft] = useState<ConnectionProfile>(() => {
    const profile = initial ?? blankConnection(preset);
    return {
      ...profile,
      sslmode: sslModeForEngine(profile.engine, profile.sslmode),
    };
  });
  const [form, setForm] = useState<ConnectionProfile>(initialDraft);
  const [isNew, setIsNew] = useState(initial === null);
  const [persisted, setPersisted] = useState(initial !== null);
  const [password, setPassword] = useState("");
  const [clearStoredPassword, setClearStoredPasswordState] = useState(false);
  const [portDraft, setPortDraftState] = useState(() => String(form.port));
  const [touchedFields, setTouchedFields] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [validationRevealed, setValidationRevealed] = useState(false);
  const [activeTab, setActiveTab] = useState<ConnectionTab>("general");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<
    "save" | "apply" | "test" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [messageStage, setMessageStage] = useState<ConnectionCommandStage | null>(
    null,
  );
  const [testFailure, setTestFailure] = useState<ConnectionTestIssue | null>(null);
  const [verified, setVerified] = useState(false);
  const [testUsedSavedCredential, setTestUsedSavedCredential] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const verificationRevision = useRef(0);
  const endpointRevision = useRef(0);
  const flags = connectionProfileFlags(form);
  const retrySeconds = retryAt === null
    ? 0
    : Math.max(1, Math.ceil((retryAt - clock) / 1_000));
  const advanced = useAdvancedParameterRows(form.extraParams, setFormValue);
  const url = useConnectionUrlDraft({
    form,
    setFormValue,
    setPassword: setCredentialPassword,
    invalidate: invalidateVerification,
  });
  const { rebase, ...changes } = useConnectionDraftChanges({
    initial: initialDraft,
    form,
    portDraft,
    urlDraft: url.mode === "urlOnly" ? url.draft : null,
    credentialEdited: password.length > 0 || clearStoredPassword,
  });

  useEffect(() => {
    setPortDraftState(String(form.port));
  }, [form.port]);

  // A running cooldown ticks once a second so every surface shows the same wait.
  useEffect(() => {
    if (retryAt === null) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryAt) setRetryAt(null);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  function invalidateVerification() {
    verificationRevision.current += 1;
    setMessage(null);
    setMessageIsError(false);
    setTestFailure(null);
    setVerified(false);
  }

  function setFormValue(
    value: SetStateAction<ConnectionProfile>,
    endpointChanged = true,
  ) {
    invalidateVerification();
    if (endpointChanged) endpointRevision.current += 1;
    setForm(value);
  }

  function setCredentialPassword(value: SetStateAction<string>) {
    invalidateVerification();
    endpointRevision.current += 1;
    setPassword(value);
  }

  function setClearStoredPassword(value: boolean) {
    invalidateVerification();
    endpointRevision.current += 1;
    setClearStoredPasswordState(value);
  }

  function touch(fieldId: string) {
    setTouchedFields((current) =>
      current.has(fieldId) ? current : new Set(current).add(fieldId),
    );
  }

  function set<K extends keyof ConnectionProfile>(
    key: K,
    value: ConnectionProfile[K],
  ) {
    const fieldId = PROFILE_FIELD_IDS[key];
    if (fieldId) touch(fieldId);
    setFormValue(
      (current) => ({ ...current, [key]: value }),
      !SERVER_NEUTRAL_FIELDS.has(key),
    );
  }

  function setPortDraft(value: string) {
    invalidateVerification();
    endpointRevision.current += 1;
    setPortDraftState(value);
    if (!/^\d+$/u.test(value)) return;
    const port = Number(value);
    if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) {
      setForm((current) => ({ ...current, port }));
    }
  }

  function setExtraParameter(key: string, value: string) {
    setFormValue((current) => {
      const extraParams = { ...current.extraParams };
      if (value) extraParams[key] = value;
      else delete extraParams[key];
      return { ...current, extraParams };
    });
  }

  function setSrv(checked: boolean) {
    setFormValue((current) => {
      const extraParams = { ...current.extraParams };
      if (checked) extraParams.srv = "true";
      else delete extraParams.srv;
      return { ...current, extraParams };
    });
  }

  function setMongoTls(checked: boolean) {
    setFormValue((current) => {
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
    setFormValue((current) => ({
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

  /** Show a tab and focus one of its fields once that tab has rendered. */
  function focusField(tab: ConnectionTab, fieldId: string) {
    setActiveTab(tab);
    requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
  }

  /** The saved profile becomes the new baseline for unsaved-change detection. */
  /** Report a failed command; Problems titles its message by the stage that failed. */
  function showError(stage: ConnectionCommandStage, text: string) {
    setMessage(text);
    setMessageIsError(true);
    setMessageStage(stage);
  }

  function markPersisted(saved: ConnectionProfile, urlDraft: string | null) {
    rebase(saved, urlDraft);
    setPortDraftState(String(saved.port));
    setClearStoredPasswordState(false);
  }

  return {
    form: {
      value: form,
      setValue: setFormValue,
      set,
      portDraft,
      setPortDraft,
      flags,
      advanced,
      setExtraParameter,
      setMongoTls,
      setSrv,
      toggleTimedConnectionOption,
      setTimedConnectionOptionValue,
      pickDatabaseFile,
      pickExtraParameterFile,
    },
    identity: { isNew, setIsNew, persisted, setPersisted, markPersisted },
    credentials: {
      password,
      setPassword: setCredentialPassword,
      clearStoredPassword,
      setClearStoredPassword,
      /**
       * The draft a probe may send. A saved credential participates only while
       * it is neither replaced by a typed password nor marked for removal.
       */
      probeProfile: (): ConnectionProfile =>
        clearStoredPassword ? { ...form, secretRef: null } : form,
      usesSavedPassword:
        form.secretRef !== null && !clearStoredPassword && !password,
    },
    changes,
    reveal: {
      touch,
      isFieldTouched: (fieldId: string) => touchedFields.has(fieldId),
      all: validationRevealed,
      revealAll: () => setValidationRevealed(true),
    },
    tabs: { active: activeTab, setActive: setActiveTab, focusField },
    url,
    status: {
      busy,
      setBusy,
      running,
      setRunning,
      message,
      setMessage,
      messageIsError,
      setMessageIsError,
      /** The command stage behind an error message, when a command reported one. */
      messageStage,
      showError,
      testFailure,
      setTestFailure,
      /** The current draft passed a check; any later edit clears it. */
      verified,
      setVerified,
      /** The last check authenticated with the credential saved on this device. */
      testUsedSavedCredential,
      setTestUsedSavedCredential,
      /** Whole seconds before a cooling-down check may run; 0 when it may run now. */
      retrySeconds,
      startRetryCooldown: (until: number) => {
        setClock(Date.now());
        setRetryAt(until);
      },
    },
    verification: {
      currentRevision: () => verificationRevision.current,
      /** Changes only when the server, transport, or credential changes. */
      endpointRevision: () => endpointRevision.current,
    },
  };
}

export type ConnectionProfileState = ReturnType<
  typeof useConnectionProfileState
>;
