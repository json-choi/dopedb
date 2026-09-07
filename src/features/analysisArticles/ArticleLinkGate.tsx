import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../design-system/components/Button";
import { ModalBackdrop, ModalFooter, ModalHeader, ModalSurface } from "../../design-system/components/Modal";
import { InlineNotice, LoadingLabel } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import { errMessage } from "../../ipc/types";
import { runWorkspaceAuthorityTransition, synchronizeWorkspaceScope } from "../workspaces/cache";
import { workspaceId } from "../workspaces/domain";
import { requestWorkspaceLogin } from "../workspaces/loginRequest";
import { workspaceAuthStateQuery } from "../workspaces/queries";
import { SelectInput } from "../../design-system/components/FormControls";
import { accountId } from "../workspaces/domain";
import { refreshWorkspaceAuthState, setActiveWorkspace, setActiveWorkspaceAccount } from "../workspaces/tauriAdapter";
import { dismissArticleLink, getArticleSharing, onArticleLink, pendingArticleLink } from "./tauriAdapter";

const inboxKey = ["analysis-article-link-inbox"] as const;

export function ArticleLinkGate({ onScopeChanged, onOpen }: {
  onScopeChanged: () => Promise<unknown>;
  onOpen: (environmentId: string, articleId: string) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const auth = useQuery(workspaceAuthStateQuery());
  const inbox = useQuery({ queryKey: inboxKey, queryFn: pendingArticleLink, staleTime: Infinity });
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onArticleLink(() => { void queryClient.invalidateQueries({ queryKey: inboxKey }); }).then((stop) => {
      if (disposed) stop();
      else { unlisten = stop; void queryClient.invalidateQueries({ queryKey: inboxKey }); }
    });
    return () => { disposed = true; unlisten?.(); };
  }, [queryClient]);
  const link = inbox.data;
  const user = auth.data?.user;
  const sharing = useQuery({
    queryKey: ["analysis-sharing-link", user?.id, auth.data?.authorityGeneration, link?.requestId],
    queryFn: () => getArticleSharing({ accountId: user!.id, workspaceId: link!.workspaceId, articleId: link!.articleId }),
    enabled: !!link && !!user,
    retry: false,
  });
  const dismiss = useMutation({
    mutationFn: dismissArticleLink,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: inboxKey }); },
  });
  const open = useMutation({
    mutationFn: async () => {
      if (!link || !user || !sharing.data) return;
      const target = { link, user, sharing: sharing.data };
      await runWorkspaceAuthorityTransition(queryClient, async () => {
        const refreshed = await refreshWorkspaceAuthState();
        if (refreshed.user?.id !== target.user.id) throw new Error(t("analysis.sharedAccountHelp"));
        await setActiveWorkspace(workspaceId(target.link.workspaceId), target.user.id);
      }, async () => { await synchronizeWorkspaceScope(queryClient); await onScopeChanged(); });
      onOpen(target.sharing.projectEnvironmentId, target.link.articleId);
      await dismissArticleLink(target.link.requestId);
      await queryClient.invalidateQueries({ queryKey: inboxKey });
    },
  });
  const chooseAccount = useMutation({
    mutationFn: async (id: string) => {
      await runWorkspaceAuthorityTransition(queryClient,
        () => setActiveWorkspaceAccount(accountId(id)),
        async () => { await synchronizeWorkspaceScope(queryClient); await onScopeChanged(); });
      await queryClient.invalidateQueries({ queryKey: inboxKey });
    },
  });
  if (!link) return null;
  const close = () => { if (!open.isPending) dismiss.mutate(link.requestId); };
  return <ModalBackdrop onMouseDown={close}>
    <ModalSurface aria-labelledby="article-link-title" onRequestClose={close} dismissible={!open.isPending}>
      <ModalHeader title={t("analysis.openSharedTitle")} titleId="article-link-title" />
      <div className="tw:grid tw:gap-3 tw:p-5">
        {user ? <span className="tw:text-xs tw:text-muted-foreground">{user.email}</span> : null}
        {!user || sharing.isError ? <>
          <InlineNotice icon="alert" tone="warning">{t("analysis.sharedAccountHelp")}</InlineNotice>
          <Button onClick={() => { requestWorkspaceLogin(); }}>{t("analysis.sharedSignIn")}</Button>
          {user && (auth.data?.accounts.length ?? 0) > 1 ? <SelectInput
            aria-label={t("analysis.sharedChooseAccount")} value={user.id} disabled={chooseAccount.isPending}
            onChange={(event) => chooseAccount.mutate(event.target.value)}
          >{auth.data!.accounts.map((account) => <option key={account.user.id} value={account.user.id}>{account.user.email}</option>)}</SelectInput> : null}
          {user ? <Button onClick={() => void sharing.refetch()}>{t("analysis.retryShared")}</Button> : null}
        </> : sharing.isPending ? <LoadingLabel>{t("analysis.loading")}</LoadingLabel> : <>
          <strong className="tw:text-base">{sharing.data.title}</strong>
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">{t("analysis.openSharedBody", { workspace: sharing.data.workspaceName })}</p>
          <Button variant="primary" disabled={open.isPending} onClick={() => open.mutate()}>{t("analysis.openShared")}</Button>
        </>}
        {chooseAccount.isError ? <InlineNotice icon="alert" tone="danger" role="alert">{errMessage(chooseAccount.error)}</InlineNotice> : null}
        {open.isError ? <InlineNotice icon="alert" tone="danger" role="alert">{errMessage(open.error)}</InlineNotice> : null}
      </div>
      <ModalFooter><Button disabled={open.isPending} onClick={close}>{t("common.close")}</Button></ModalFooter>
    </ModalSurface>
  </ModalBackdrop>;
}
