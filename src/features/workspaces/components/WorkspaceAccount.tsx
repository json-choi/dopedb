// Account-specific Better Auth device login lifecycle and unified local account menu.
// Session tokens stay behind Rust IPC; this component caches public identity only.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ProviderCredentialDialog } from "../../providers/ProviderCredentialDialog";
import { ProviderCredentialsMenuItem } from "../../providers/ProviderCredentialsMenuItem";
import {
  beginWorkspaceLogin,
  onWorkspaceLoginCallback,
  pollWorkspaceLogin,
  refreshWorkspaceAuthState,
  setActiveWorkspaceAccount,
  signOutAllWorkspaces,
  signOutWorkspace,
  workspaceAuthState,
} from "../tauriAdapter";
import {
  invalidateWorkspaceContext,
  invalidateWorkspaceState,
  replaceWorkspaceAuth,
  replaceWorkspaceContext,
  workspaceAuthorityChanged,
  workspaceResourceQueryScopeChanged,
} from "../cache";
import type {
  AccountId,
  WorkspaceAuthState,
  WorkspaceLoginPoll,
} from "../domain";
import {
  readWorkspaceContext,
  workspaceAuthStateQuery,
  workspaceQueryKeys,
  type WorkspaceContextState,
} from "../queries";
import {
  shouldRevalidateWorkspaceAuth,
  workspaceAuthRetryDelay,
} from "../authPolicy";
import { onWorkspaceLoginRequested } from "../loginRequest";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import { Icon } from "../../../components/Icon";
import { useToast } from "../../../components/Toast";
import { PopupMenuItem } from "../../../design-system/components/PopupMenu";
import { Button } from "../../../design-system/components/Button";
import {
  cancelWorkspaceResourceQueries,
  resetWorkspaceResourceQueries,
  resumePendingWorkspaceResourceQueries,
} from "../../../lib/queryClient";
import { captureProductEvent } from "../../productAnalytics/client";

export default function WorkspaceAccount({
  onScopeChanged,
  compact = false,
  menuPlacement = "rail",
}: {
  onScopeChanged: () => void | Promise<void>;
  compact?: boolean;
  menuPlacement?: "rail" | "topbar";
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const auth = useQuery(workspaceAuthStateQuery());
  const [loginPhase, setLoginPhase] = useState<"idle" | "starting" | "waiting">("idle");
  const [loggingOut, setLoggingOut] = useState<AccountId | "all" | null>(null);
  const [switchingAccount, setSwitchingAccount] = useState<AccountId | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [providerCredentialsOpen, setProviderCredentialsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const loginAttempt = useRef(0);
  const pendingLogin = useRef<{
    attempt: number;
    analyticsAttemptId: string;
    deviceCode: string;
  } | null>(null);
  const completedLoginAnalyticsAttempts = useRef(new Set<string>());
  const pollInFlight = useRef<{
    deviceCode: string;
    request: Promise<WorkspaceLoginPoll>;
  } | null>(null);
  const membershipRefreshInFlight = useRef<Promise<void> | null>(null);
  const membershipRefreshRetryTimer = useRef<number | null>(null);
  const membershipRefreshFailures = useRef(0);
  const workspaceAccountMounted = useRef(false);
  const providerCredentialAuthorityVersion = useRef<number | null>(null);
  const membershipRefreshHandler = useRef<(force?: boolean) => void>(() => undefined);
  const loginCallbackHandler = useRef<() => void>(() => undefined);
  const loginRequestHandler = useRef<() => void>(() => undefined);
  const scopeChangeHandler = useRef<() => void | Promise<void>>(
    () => undefined,
  );
  scopeChangeHandler.current = onScopeChanged;

  const clearMembershipRefreshRetry = useCallback(() => {
    if (membershipRefreshRetryTimer.current === null) return;
    window.clearTimeout(membershipRefreshRetryTimer.current);
    membershipRefreshRetryTimer.current = null;
  }, []);

  const scheduleMembershipRefreshRetry = useCallback(() => {
    if (
      !workspaceAccountMounted.current ||
      membershipRefreshRetryTimer.current !== null ||
      document.visibilityState !== "visible" ||
      !navigator.onLine
    ) {
      return;
    }
    const delay = workspaceAuthRetryDelay(membershipRefreshFailures.current);
    membershipRefreshRetryTimer.current = window.setTimeout(() => {
      membershipRefreshRetryTimer.current = null;
      membershipRefreshHandler.current(true);
    }, delay);
  }, []);

  const membershipRefreshSucceeded = useCallback(() => {
    membershipRefreshFailures.current = 0;
    clearMembershipRefreshRetry();
  }, [clearMembershipRefreshRetry]);

  const membershipRefreshFailed = useCallback(() => {
    membershipRefreshFailures.current += 1;
    scheduleMembershipRefreshRetry();
  }, [scheduleMembershipRefreshRetry]);

  const refreshWorkspaceAuthority = useCallback(
    async function refreshWorkspaceAuthority(
      refreshAuth: () => Promise<Awaited<ReturnType<typeof workspaceAuthState>>>,
      previousAuthority?: {
        auth: WorkspaceAuthState | undefined;
        context: WorkspaceContextState | undefined;
      },
    ) {
    const previousAuth = previousAuthority?.auth ??
      queryClient.getQueryData<WorkspaceAuthState>(workspaceQueryKeys.auth());
    const previousContext = previousAuthority?.context ??
      queryClient.getQueryData<WorkspaceContextState>(
        workspaceQueryKeys.context(),
      );
    // Native membership/auth refreshes may change the backend's active account or
    // workspace. Stop old-generation reads before invoking that authority boundary.
    await cancelWorkspaceResourceQueries(queryClient);
    let nextAuth: WorkspaceAuthState;
    let nextContext: WorkspaceContextState;
    try {
      nextAuth = await refreshAuth();
      nextContext = await readWorkspaceContext();
    } catch (error) {
      // The native command may have committed a new authority before a later context
      // or provider cleanup failed. Re-read the local authoritative projection after
      // clearing old private data, then either advance every scope owner to its new
      // generation or safely refill the unchanged generation.
      await resetWorkspaceResourceQueries(queryClient);
      try {
        const recoveredAuth = await workspaceAuthState();
        const recoveredContext = await readWorkspaceContext();
        const recoveredScopeChanged = workspaceAuthorityChanged(
          previousAuth,
          previousContext,
          recoveredAuth,
          recoveredContext,
        );
        const recoveredQueryScopeChanged = workspaceResourceQueryScopeChanged(
          previousAuth,
          previousContext,
          recoveredAuth,
          recoveredContext,
        );
        replaceWorkspaceAuth(queryClient, recoveredAuth);
        replaceWorkspaceContext(queryClient, recoveredContext);
        if (recoveredScopeChanged) {
          await scopeChangeHandler.current();
          // A membership role can change while the active workspace/account key
          // remains identical. Its active observers were reset above and therefore
          // need an explicit read under the newly proven native authority.
          if (!recoveredQueryScopeChanged) {
            await resumePendingWorkspaceResourceQueries(queryClient);
          }
        } else {
          await resumePendingWorkspaceResourceQueries(queryClient);
        }
      } catch {
        // No local authority proof means the fail-closed empty projection remains.
      }
      throw error;
    }
    const scopeChanged = workspaceAuthorityChanged(
      previousAuth,
      previousContext,
      nextAuth,
      nextContext,
    );
    const queryScopeChanged = workspaceResourceQueryScopeChanged(
      previousAuth,
      previousContext,
      nextAuth,
      nextContext,
    );
    if (scopeChanged) {
      await resetWorkspaceResourceQueries(queryClient);
    }
    replaceWorkspaceAuth(queryClient, nextAuth);
    replaceWorkspaceContext(queryClient, nextContext);
    if (scopeChanged) {
      await scopeChangeHandler.current();
      if (!queryScopeChanged) {
        await resumePendingWorkspaceResourceQueries(queryClient);
      }
      return;
    }
    // `cancelWorkspaceResourceQueries` leaves an initial, data-less observer in
    // `pending + idle`. The unchanged-authority path must explicitly resume every
    // mounted private read after the native authority has been proven stable;
    // refreshing only Connections would otherwise strand Explorer Knowledge forever.
    await resumePendingWorkspaceResourceQueries(queryClient);
    },
    [queryClient],
  );

  useEffect(() => {
    workspaceAccountMounted.current = true;
    const onFocus = () => {
      // Returning from the browser is not a device-flow outcome. The normal poll
      // loop owns completion; only the visible Cancel action aborts a pending login.
      if (pendingLogin.current) return;
      membershipRefreshHandler.current(membershipRefreshFailures.current > 0);
    };
    const onOnline = () => membershipRefreshHandler.current(true);
    const onOffline = () => clearMembershipRefreshRetry();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && membershipRefreshFailures.current > 0) {
        membershipRefreshHandler.current(true);
      } else if (document.visibilityState !== "visible") {
        clearMembershipRefreshRetry();
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      workspaceAccountMounted.current = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (membershipRefreshRetryTimer.current !== null) {
        window.clearTimeout(membershipRefreshRetryTimer.current);
        membershipRefreshRetryTimer.current = null;
      }
      loginAttempt.current += 1;
      pendingLogin.current = null;
    };
  }, [clearMembershipRefreshRetry]);

  useEffect(() => onWorkspaceLoginRequested(() => loginRequestHandler.current()), []);

  useEffect(() => {
    const pending = onWorkspaceLoginCallback(() => loginCallbackHandler.current());
    return () => {
      void pending.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!auth.data?.authenticated) return;
    void invalidateWorkspaceContext(queryClient);
  }, [auth.data?.authenticated, queryClient]);

  useEffect(() => {
    if (providerCredentialAuthorityVersion.current !== null
      && providerCredentialAuthorityVersion.current !== auth.dataUpdatedAt) {
      setProviderCredentialsOpen(false);
    }
    providerCredentialAuthorityVersion.current = auth.dataUpdatedAt;
  }, [auth.dataUpdatedAt]);

  useEffect(() => {
    // React StrictMode mounts effects twice in development. The native refresh is
    // one authority verification, so duplicate setup must share the in-flight call.
    if (membershipRefreshInFlight.current) return;
    const request = refreshWorkspaceAuthority(refreshWorkspaceAuthState)
      .then(membershipRefreshSucceeded)
      .catch(membershipRefreshFailed)
      .finally(() => {
        if (membershipRefreshInFlight.current === request) {
          membershipRefreshInFlight.current = null;
        }
      });
    membershipRefreshInFlight.current = request;
  }, [
    membershipRefreshFailed,
    membershipRefreshSucceeded,
    refreshWorkspaceAuthority,
  ]);

  async function wait(ms: number) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  }

  function captureLoginOutcome(
    analyticsAttemptId: string,
    outcome: "success" | "denied" | "expired" | "failed",
    actorId?: string,
  ) {
    if (completedLoginAnalyticsAttempts.current.has(analyticsAttemptId)) return;
    completedLoginAnalyticsAttempts.current.add(analyticsAttemptId);
    if (outcome === "success" && actorId) {
      void captureProductEvent({
        name: "workspace_authentication_completed",
        properties: { outcome },
        context: { actorId },
        dedupeId: analyticsAttemptId,
      });
      return;
    }
    if (outcome !== "success") {
      void captureProductEvent({
        name: "workspace_authentication_completed",
        properties: { outcome },
        dedupeId: analyticsAttemptId,
      });
    }
  }

  async function pollOnce(deviceCode: string) {
    if (pollInFlight.current?.deviceCode === deviceCode) {
      return pollInFlight.current.request;
    }
    const request = pollWorkspaceLogin(deviceCode).finally(() => {
      if (pollInFlight.current?.request === request) pollInFlight.current = null;
    });
    pollInFlight.current = { deviceCode, request };
    return request;
  }

  function abortLoginAttempt() {
    loginAttempt.current += 1;
    pendingLogin.current = null;
    setLoginPhase("idle");
  }

  function cancelLogin() {
    if (!pendingLogin.current) return;
    abortLoginAttempt();
    toast(t("workspace.loginCanceled"));
  }

  async function handlePollResult(result: WorkspaceLoginPoll, attempt: number) {
    if (pendingLogin.current?.attempt !== attempt) return true;
    if (result.status === "signedIn" && result.user) {
      const analyticsAttemptId = pendingLogin.current.analyticsAttemptId;
      pendingLogin.current = null;
      if (loginAttempt.current === attempt) loginAttempt.current += 1;
      setLoginPhase("idle");
      // The native poll returns `signedIn` only after the account credential has
      // been durably accepted. Scope synchronization is measured separately and
      // must not turn a successful authentication into a second outcome.
      captureLoginOutcome(analyticsAttemptId, "success", result.user.id);
      await refreshWorkspaceAuthority(workspaceAuthState);
      toast(t("workspace.loginComplete", { name: result.user.displayName }), "success");
      return true;
    }
    if (result.status === "denied" || result.status === "expired") {
      const analyticsAttemptId = pendingLogin.current.analyticsAttemptId;
      pendingLogin.current = null;
      if (loginAttempt.current === attempt) loginAttempt.current += 1;
      setLoginPhase("idle");
      captureLoginOutcome(analyticsAttemptId, result.status);
      toast(
        t(result.status === "denied" ? "workspace.loginDenied" : "workspace.loginExpired"),
        "error",
      );
      return true;
    }
    return false;
  }

  loginCallbackHandler.current = () => {
    const pending = pendingLogin.current;
    if (!pending) return;
    void pollOnce(pending.deviceCode)
      .then((result) => handlePollResult(result, pending.attempt))
      .catch((error) => {
        // A wake-up poll is opportunistic. Network failures stay owned by the
        // scheduled device-flow loop, while a post-acceptance sync failure remains
        // visible because the pending attempt already reached a terminal state.
        if (pendingLogin.current?.attempt === pending.attempt) return;
        toast(t("workspace.loginFailed", { error: errMessage(error) }), "error");
      });
  };

  membershipRefreshHandler.current = (force = false) => {
    if (!auth.data?.authenticated || membershipRefreshInFlight.current) return;
    const revalidateAuth = shouldRevalidateWorkspaceAuth(
      true,
      auth.dataUpdatedAt,
      auth.isFetching,
    );
    // Routine focus respects the cooldown. Forced retries are reserved for a
    // previous failed proof or the browser returning online; native keeps the ACP
    // process alive while the Broker authority gate is paused.
    if (!force && !revalidateAuth) return;
    clearMembershipRefreshRetry();
    const request = refreshWorkspaceAuthority(refreshWorkspaceAuthState)
      .then(membershipRefreshSucceeded)
      .catch(async () => {
        // A membership 401 also invalidates the hosted session. Confirm that state
        // silently so expired team scopes disappear without turning the button into
        // a foreground loading indicator.
        await auth.refetch().catch(() => undefined);
        await invalidateWorkspaceContext(queryClient);
        membershipRefreshFailed();
      })
      .finally(() => {
        if (membershipRefreshInFlight.current === request) {
          membershipRefreshInFlight.current = null;
        }
      });
    membershipRefreshInFlight.current = request;
  };

  async function login() {
    if (loginPhase !== "idle") return;
    const attempt = ++loginAttempt.current;
    const analyticsAttemptId = crypto.randomUUID();
    setLoginPhase("starting");
    try {
      const authorization = await beginWorkspaceLogin();
      pendingLogin.current = {
        attempt,
        analyticsAttemptId,
        deviceCode: authorization.deviceCode,
      };
      await openUrl(authorization.verificationUriComplete);
      if (loginAttempt.current !== attempt) return;
      setLoginPhase("waiting");
      const expiresAt = Date.now() + authorization.expiresIn * 1000;
      let pollInterval = Math.max(authorization.interval, 1) * 1000;

      while (Date.now() < expiresAt) {
        await wait(pollInterval);
        if (loginAttempt.current !== attempt) return;
        const result = await pollOnce(authorization.deviceCode);
        if (result.status === "pending") continue;
        if (result.status === "slowDown") {
          pollInterval += 5_000;
          continue;
        }
        if (await handlePollResult(result, attempt)) return;
      }
      pendingLogin.current = null;
      captureLoginOutcome(analyticsAttemptId, "expired");
      toast(t("workspace.loginExpired"), "error");
    } catch (error) {
      pendingLogin.current = null;
      captureLoginOutcome(analyticsAttemptId, "failed");
      toast(t("workspace.loginFailed", { error: errMessage(error) }), "error");
    } finally {
      if (loginAttempt.current === attempt) setLoginPhase("idle");
    }
  }

  loginRequestHandler.current = () => {
    if (auth.data?.authenticated || loginPhase !== "idle") return;
    void login();
  };

  async function logout(userId: AccountId) {
    if (loggingOut) return;
    abortLoginAttempt();
    setProviderCredentialsOpen(false);
    setLoggingOut(userId);
    try {
      await refreshWorkspaceAuthority(() => signOutWorkspace(userId));
      setMenuOpen(false);
      toast(t("workspace.logoutComplete"), "success");
    } catch (error) {
      // The native command may already have removed the credential before a local
      // workspace-index error. Re-read identity so the UI never displays a stale user.
      await auth.refetch().catch(() => undefined);
      await invalidateWorkspaceContext(queryClient);
      toast(t("workspace.logoutFailed", { error: errMessage(error) }), "error");
    } finally {
      setLoggingOut(null);
    }
  }

  async function logoutAll() {
    if (loggingOut) return;
    abortLoginAttempt();
    setProviderCredentialsOpen(false);
    setLoggingOut("all");
    try {
      await refreshWorkspaceAuthority(signOutAllWorkspaces);
      setMenuOpen(false);
      toast(t("workspace.logoutAllComplete"), "success");
    } catch (error) {
      await auth.refetch().catch(() => undefined);
      toast(t("workspace.logoutFailed", { error: errMessage(error) }), "error");
    } finally {
      setLoggingOut(null);
    }
  }

  async function switchAccount(userId: AccountId) {
    if (switchingAccount || auth.data?.user?.id === userId) {
      setMenuOpen(false);
      return;
    }
    abortLoginAttempt();
    setProviderCredentialsOpen(false);
    setSwitchingAccount(userId);
    try {
      const previousAuthority = {
        auth: queryClient.getQueryData<WorkspaceAuthState>(
          workspaceQueryKeys.auth(),
        ),
        context: queryClient.getQueryData<WorkspaceContextState>(
          workspaceQueryKeys.context(),
        ),
      };
      // The native switch changes active authority before it returns. Freeze old
      // generation reads first; the common transition then replaces cache identity.
      await cancelWorkspaceResourceQueries(queryClient);
      await setActiveWorkspaceAccount(userId);
      await refreshWorkspaceAuthority(workspaceAuthState, previousAuthority);
      setMenuOpen(false);
    } catch (error) {
      await auth.refetch();
      await invalidateWorkspaceState(queryClient);
      toast(t("workspace.accountSwitchFailed", { error: errMessage(error) }), "error");
    } finally {
      setSwitchingAccount(null);
    }
  }

  const authKnown = auth.data !== undefined;
  const loginLabel = !authKnown
    ? t("workspace.loginChecking")
    : loginPhase === "starting"
      ? t("workspace.loginStarting")
      : loginPhase === "waiting"
        ? t("workspace.loginCancel")
        : t("workspace.login");

  const user = auth.data?.authenticated ? auth.data.user : null;

  return (
    <div
      data-compact={compact}
      data-menu-placement={menuPlacement}
      className="tw:relative tw:flex tw:min-h-control-md tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2 tw:p-0 tw:data-[compact=true]:min-h-control-lg tw:data-[compact=true]:w-control-lg tw:data-[compact=true]:min-w-control-lg tw:data-[compact=true]:flex-none tw:data-[compact=true]:justify-center"
      aria-live="polite"
      ref={rootRef}
    >
      {!authKnown ? (
        <div
          data-compact={compact}
          className="tw:h-control-md tw:w-[min(128px,78%)] tw:rounded-sm tw:bg-background tw:opacity-55 tw:data-[compact=true]:size-control-md tw:data-[compact=true]:rounded-full"
          aria-label={loginLabel}
        />
      ) : user ? (
        <>
          <button
            ref={triggerRef}
            type="button"
            data-rail-control={compact ? "" : undefined}
            data-compact={compact}
            className="tw:flex tw:min-h-control-md tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-left tw:text-foreground tw:aria-expanded:bg-muted tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:data-[compact=true]:grid tw:data-[compact=true]:size-control-lg tw:data-[compact=true]:min-h-control-lg tw:data-[compact=true]:min-w-control-lg tw:data-[compact=true]:flex-none tw:data-[compact=true]:place-items-center tw:data-[compact=true]:p-0 tw:data-[compact=true]:text-center tw:data-[compact=true]:[&>.icon]:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={
              compact ? `${user.displayName || user.email} · ${user.email}` : undefined
            }
            title={`${user.displayName} · ${user.email}`}
          >
            <span
              data-compact={compact}
              className="tw:inline-grid tw:size-control-md tw:shrink-0 tw:place-items-center tw:rounded-full tw:bg-selection tw:text-xs tw:font-bold tw:text-primary tw:data-[compact=true]:size-control-md"
              aria-hidden="true"
            >
              {(user.displayName || user.email).slice(0, 1).toUpperCase()}
            </span>
            <span
              data-compact={compact}
              className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-[var(--ds-segment-gap)] tw:data-[compact=true]:hidden tw:[&_small]:overflow-hidden tw:[&_small]:text-2xs tw:[&_small]:text-muted-foreground tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:overflow-hidden tw:[&_strong]:text-sm tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap"
            >
              <strong>{user.displayName}</strong>
              <small>{user.email}</small>
            </span>
            <Icon name="chevronDown" />
          </button>
          {!compact ? (
            <Button
              iconOnly
              size="xs"
              variant="ghost"
              onClick={() => void logout(user.id)}
              disabled={loggingOut !== null}
              aria-label={t(loggingOut === user.id ? "workspace.logoutPending" : "workspace.logout")}
              aria-busy={loggingOut === user.id}
            >
              <Icon name="logOut" />
            </Button>
          ) : null}
          {menuOpen ? (
            <div
              data-compact={compact}
              data-menu-placement={menuPlacement}
              className="tw:absolute tw:bottom-[calc(100%+var(--ds-space-2))] tw:left-0 tw:z-[var(--ds-z-popover)] tw:max-h-[min(420px,calc(100vh_-_var(--ds-space-8)))] tw:w-[calc(100%+var(--ds-control-md)+var(--ds-space-2))] tw:max-w-[calc(100vw_-_var(--ds-space-6))] tw:overflow-auto tw:rounded-md tw:border tw:border-border-strong tw:bg-popover tw:p-1 tw:shadow-popover tw:data-[compact=true]:bottom-0 tw:data-[compact=true]:left-[calc(100%+var(--ds-space-2))] tw:data-[compact=true]:w-[min(284px,calc(100vw_-_64px))] tw:data-[menu-placement=topbar]:top-[calc(100%+var(--ds-space-2))] tw:data-[menu-placement=topbar]:right-0 tw:data-[menu-placement=topbar]:bottom-auto tw:data-[menu-placement=topbar]:left-auto tw:max-[561px]:data-[compact=true]:right-0 tw:max-[561px]:data-[compact=true]:bottom-[calc(100%+var(--ds-space-2))] tw:max-[561px]:data-[compact=true]:left-auto"
              role="menu"
              aria-label={t("workspace.accountMenu")}
            >
              <p className="tw:m-0 tw:p-2 tw:text-2xs tw:font-bold tw:tracking-[0.05em] tw:text-muted-foreground tw:uppercase">
                {t("workspace.accounts")}
              </p>
              {auth.data?.accounts.map((account) => {
                const active = account.user.id === user.id;
                return (
                  <div
                    className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_var(--ds-control-md)] tw:items-stretch"
                    key={account.user.id}
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className="tw:grid tw:min-h-control-lg tw:min-w-0 tw:cursor-pointer tw:grid-cols-[var(--ds-control-md)_minmax(0,1fr)_var(--ds-control-sm)] tw:items-center tw:gap-2 tw:rounded-sm tw:border-0 tw:bg-transparent tw:px-2 tw:py-1 tw:font-sans tw:text-left tw:text-foreground tw:disabled:cursor-progress tw:disabled:opacity-55 tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:[&>.icon]:text-xs tw:[&>.icon]:text-primary tw:[&>span:nth-child(2)]:grid tw:[&>span:nth-child(2)]:min-w-0 tw:[&>span:nth-child(2)]:gap-[var(--ds-segment-gap)] tw:[&_small]:overflow-hidden tw:[&_small]:text-2xs tw:[&_small]:text-muted-foreground tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:overflow-hidden tw:[&_strong]:text-sm tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap"
                      onClick={() => void switchAccount(account.user.id)}
                      disabled={switchingAccount !== null || loggingOut !== null}
                    >
                      <span
                        className="tw:inline-grid tw:size-control-md tw:place-items-center tw:rounded-full tw:bg-selection tw:text-xs tw:font-bold tw:text-primary"
                        aria-hidden="true"
                      >
                        {(account.user.displayName || account.user.email).slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <strong>{account.user.displayName}</strong>
                        <small>{account.user.email}</small>
                      </span>
                      {active ? <Icon name="check" /> : null}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="tw:inline-grid tw:min-h-control-lg tw:w-control-md tw:cursor-pointer tw:place-items-center tw:rounded-sm tw:border-0 tw:bg-transparent tw:text-muted-foreground tw:disabled:cursor-progress tw:disabled:opacity-55 tw:hover:bg-muted tw:hover:text-danger tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                      onClick={() => void logout(account.user.id)}
                      disabled={loggingOut !== null}
                      aria-label={t("workspace.logoutAccount", { email: account.user.email })}
                      title={t("workspace.logoutAccount", { email: account.user.email })}
                    >
                      <Icon name="logOut" />
                    </button>
                  </div>
                );
              })}
              <ProviderCredentialsMenuItem
                onOpen={() => {
                  setMenuOpen(false);
                  setProviderCredentialsOpen(true);
                }}
              />
              <PopupMenuItem
                onClick={() => {
                  setMenuOpen(false);
                  if (loginPhase === "waiting") cancelLogin();
                  else void login();
                }}
                disabled={loginPhase === "starting"}
              >
                <Icon name="plus" />
                {loginPhase === "waiting" ? t("workspace.loginCancel") : t("workspace.addAccount")}
              </PopupMenuItem>
              {auth.data && auth.data.accounts.length > 1 ? (
                <PopupMenuItem
                  data-tone="danger"
                  onClick={() => void logoutAll()}
                  disabled={loggingOut !== null}
                >
                  <Icon name="logOut" />
                  {t("workspace.logoutAll")}
                </PopupMenuItem>
              ) : null}
            </div>
          ) : null}
          {providerCredentialsOpen ? (
            <ProviderCredentialDialog
              key={user.id}
              onClose={() => setProviderCredentialsOpen(false)}
              returnFocusRef={triggerRef}
            />
          ) : null}
        </>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          data-rail-control={compact ? "" : undefined}
          data-compact={compact}
          className="tw:min-h-control-md tw:w-full tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-left tw:text-sm tw:font-semibold tw:text-muted-foreground tw:disabled:cursor-progress tw:disabled:opacity-65 tw:hover:text-foreground tw:data-[compact=true]:grid tw:data-[compact=true]:size-control-lg tw:data-[compact=true]:min-h-control-lg tw:data-[compact=true]:min-w-control-lg tw:data-[compact=true]:flex-none tw:data-[compact=true]:place-items-center tw:data-[compact=true]:rounded-sm tw:data-[compact=true]:text-center tw:data-[compact=true]:text-[var(--ds-icon-md)]"
          onClick={() => (loginPhase === "waiting" ? cancelLogin() : void login())}
          disabled={loginPhase === "starting"}
          title={loginPhase === "waiting" ? t("workspace.loginPending") : loginLabel}
          aria-label={loginLabel}
        >
          {compact ? <Icon name="user" /> : loginLabel}
        </button>
      )}
    </div>
  );
}
