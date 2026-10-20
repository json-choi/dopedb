// Controller of the inline direct-connection add flow: the endpoint and administrator
// credential drafts, the preflight read (kept in the query cache without the
// password), the chosen scope and write ceiling, and the single register command.
// It owns step navigation and the flow's error and reports busy state to the host.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isSshHostAlias } from "../../../connections/options";
import { connectionId } from "../../../connections/domain";
import {
  DIRECT_DEFAULT_PORT,
  DIRECT_SSL_MODES,
  directFailureCodeOf,
  type DirectEndpoint,
  type DirectEngine,
  type DirectFailureCode,
  type DirectPreflightInput,
  type DirectPreflightReport,
} from "../../../directAccess/domain";
import { directPreflightQuery, directPrefillQuery } from "../../../directAccess/queries";
import { registerDirectDatabase } from "../../../directAccess/tauriAdapter";
import type { EnvironmentKind } from "../../../../lib/environmentKind";
import { useEventCallback } from "../../../../lib/useEventCallback";
import type { WorkspaceAdminScope } from "../../domain";

export type DirectStep = 1 | 2 | 3;

export type EndpointDraft = Readonly<{
  engine: DirectEngine;
  host: string;
  port: string;
  database: string;
  sslmode: string;
  sshAlias: string;
}>;

export type CredentialDraft = Readonly<{ username: string; password: string }>;


/** What the flow could not do, as a closed localizable reason. */
export type DirectFlowError =
  | Readonly<{ kind: "probe"; code: DirectFailureCode | null }>
  | Readonly<{ kind: "register"; code: DirectFailureCode | null }>;

export type RegisteredDirect = Readonly<{ id: string; name: string }>;

const INITIAL_ENDPOINT: EndpointDraft = {
  engine: "postgres",
  host: "",
  port: String(DIRECT_DEFAULT_PORT.postgres),
  database: "",
  sslmode: DIRECT_SSL_MODES.postgres[0],
  sshAlias: "",
};

function parsePort(port: string): number | null {
  if (!/^\d{1,5}$/u.test(port)) return null;
  const value = Number(port);
  return value >= 1 && value <= 65_535 ? value : null;
}

/** Mirrors the host rule of the native endpoint check so the button never lies. */
function validHost(host: string): boolean {
  const value = host.trim();
  return value.length > 0 && value.length <= 512 && !/[\s,\p{Cc}]/u.test(value);
}

export function endpointIssues(draft: EndpointDraft) {
  const sshAlias = draft.sshAlias.trim();
  return {
    host: !validHost(draft.host),
    port: parsePort(draft.port) === null,
    database: draft.database.trim().length === 0 || /[?#\p{Cc}]/u.test(draft.database),
    sshAlias: sshAlias.length > 0 && !isSshHostAlias(sshAlias),
  };
}

function toEndpoint(draft: EndpointDraft): DirectEndpoint | null {
  const port = parsePort(draft.port);
  if (port === null) return null;
  return {
    engine: draft.engine,
    host: draft.host.trim(),
    port,
    database: draft.database.trim(),
    sslmode: draft.sslmode,
    sshAlias: draft.sshAlias.trim() || null,
  };
}

/** The report passes when the server version is supported and members can be created. */
export function preflightUsable(report: DirectPreflightReport | undefined): boolean {
  return report !== undefined
    && report.failureCode === null
    && report.versionSupported
    && report.canCreatePrincipal
    && report.namespaces.some((namespace) => namespace.grantable);
}

export function useDirectDatabaseSetup({
  scope,
  onRegistered,
  onBusyChange,
}: {
  scope: WorkspaceAdminScope;
  onRegistered: (database: RegisteredDirect) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<DirectStep>(1);
  const [endpoint, setEndpointDraft] = useState<EndpointDraft>(INITIAL_ENDPOINT);
  const [credential, setCredentialDraft] = useState<CredentialDraft>({
    username: "",
    password: "",
  });
  // The explicit "Check" attempt the cached report belongs to; editing resets it.
  const [attempt, setAttempt] = useState(0);
  const [checked, setChecked] = useState(false);
  const [selection, setSelection] = useState<readonly string[] | null>(null);
  const [writeCeiling, setWriteCeiling] = useState(false);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentKind | null>(null);
  const [error, setError] = useState<DirectFlowError | null>(null);

  const issues = endpointIssues(endpoint);
  const endpointValid = !Object.values(issues).some(Boolean) && toEndpoint(endpoint) !== null;
  const credentialValid = credential.username.trim().length > 0 && credential.password.length > 0;

  const probeEndpoint = toEndpoint(endpoint);
  const probeInput: DirectPreflightInput = {
    accountId: scope.accountId,
    endpoint: probeEndpoint ?? { ...INITIAL_ENDPOINT, port: 5432, sshAlias: null },
    credential: { username: credential.username.trim(), password: credential.password },
    scope: step === 3 && selection ? [...selection] : null,
    writeCeiling: step === 3 && writeCeiling,
  };
  const preflight = useQuery(
    directPreflightQuery(probeInput, attempt, checked && endpointValid && credentialValid),
  );
  const report = preflight.data;
  const probing = preflight.isFetching;
  const usable = checked && !probing && preflightUsable(report);

  const register = useMutation({
    mutationFn: registerDirectDatabase,
    onError: (caught) => setError({ kind: "register", code: directFailureCodeOf(caught) }),
  });
  const busy = probing || register.isPending;

  const reportBusy = useEventCallback(onBusyChange);
  useEffect(() => {
    reportBusy(busy);
  }, [busy, reportBusy]);
  useEffect(() => () => reportBusy(false), [reportBusy]);

  const grantable = (report?.namespaces ?? []).filter((namespace) => namespace.grantable);
  const effectiveSelection = selection ?? grantable.map((namespace) => namespace.name);
  const nameValue = name.trim();
  const nameValid = nameValue.length > 0 && nameValue.length <= 120 && !/\p{Cc}/u.test(nameValue);
  const planReady = report !== undefined && !probing && preflightUsable(report)
    && effectiveSelection.length > 0 && selection !== null;
  const canCreate = step === 3 && planReady && nameValid && !register.isPending;

  function invalidateCheck() {
    setChecked(false);
    setSelection(null);
    setError(null);
  }

  function setEndpoint(next: Partial<EndpointDraft>) {
    setEndpointDraft((current) => ({ ...current, ...next }));
    invalidateCheck();
  }

  function chooseEngine(engine: DirectEngine) {
    setEndpointDraft((current) => ({
      ...current,
      engine,
      port: current.port === String(DIRECT_DEFAULT_PORT[current.engine])
        ? String(DIRECT_DEFAULT_PORT[engine])
        : current.port,
      sslmode: DIRECT_SSL_MODES[engine][0],
    }));
    invalidateCheck();
  }

  function setCredential(next: Partial<CredentialDraft>) {
    setCredentialDraft((current) => ({ ...current, ...next }));
    invalidateCheck();
  }

  /** Copies only the endpoint of one of the user's saved connections. */
  async function prefill(id: string) {
    if (busy || !id) return;
    try {
      const value = await queryClient.fetchQuery(directPrefillQuery(connectionId(id)));
      setEndpointDraft({
        engine: value.engine,
        host: value.host,
        port: String(value.port),
        database: value.database,
        sslmode: value.sslmode,
        sshAlias: value.sshAlias ?? "",
      });
      invalidateCheck();
    } catch {
      setError({ kind: "probe", code: null });
    }
  }

  function check() {
    if (busy || !endpointValid || !credentialValid) return;
    setError(null);
    setSelection(null);
    setAttempt((current) => current + 1);
    setChecked(true);
  }

  function next() {
    if (busy) return;
    setError(null);
    if (step === 1 && endpointValid) setStep(2);
    else if (step === 2 && usable) {
      setSelection(grantable.map((namespace) => namespace.name));
      setStep(3);
    }
  }

  function back() {
    if (busy || step === 1) return;
    setError(null);
    setStep(step === 3 ? 2 : 1);
  }

  function toggleNamespace(namespace: string, selected: boolean) {
    setSelection((current) => {
      const base = current ?? grantable.map((item) => item.name);
      return selected
        ? [...new Set([...base, namespace])]
        : base.filter((item) => item !== namespace);
    });
  }

  async function create() {
    const resolved = toEndpoint(endpoint);
    if (!canCreate || !resolved || selection === null) return;
    setError(null);
    try {
      const registered = await register.mutateAsync({
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        name: nameValue,
        env: environment,
        schemaGroup: null,
        endpoint: resolved,
        credential: { username: credential.username.trim(), password: credential.password },
        scope: [...selection],
        writeCeiling,
      });
      onRegistered({ id: registered.connectionId, name: nameValue });
    } catch {
      // `onError` already recorded the closed reason.
    }
  }

  const probeError: DirectFlowError | null = preflight.isError
    ? { kind: "probe", code: directFailureCodeOf(preflight.error) }
    : null;

  return {
    step,
    endpoint,
    issues,
    credential,
    credentialValid,
    report,
    probing,
    checked,
    usable,
    grantable,
    selection: effectiveSelection,
    writeCeiling,
    name,
    nameValid,
    environment,
    busy,
    registering: register.isPending,
    error: error ?? probeError,
    canContinue: step === 1 ? endpointValid : usable,
    canCreate,
    setEndpoint,
    chooseEngine,
    setCredential,
    setWriteCeiling: (value: boolean) => {
      setWriteCeiling(value);
      setError(null);
    },
    setName,
    setEnvironment,
    prefill,
    check,
    next,
    back,
    toggleNamespace,
    create,
  };
}

export type DirectDatabaseSetup = ReturnType<typeof useDirectDatabaseSetup>;
