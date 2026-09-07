import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { Field, TextInput } from "../../design-system/components/FormControls";
import { ModalBackdrop, ModalFooter, ModalHeader, ModalSurface } from "../../design-system/components/Modal";
import { InlineNotice, LoadingLabel } from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import { errMessage } from "../../ipc/types";
import { createArticleInvitation, getArticleSharing, revokeArticleInvitation } from "./tauriAdapter";

export function AnalysisShareButton({ articleId }: { articleId: string }) {
  const { t } = useI18n();
  const catalog = useCatalogScope();
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="primary" size="compact" onClick={() => setOpen(true)}><Icon name="link" />{t("analysis.share")}</Button>
    {open && catalog.workspaceId && catalog.accountScope ? <ShareDialog
      key={`${catalog.key}:${articleId}`}
      scope={{ articleId, workspaceId: catalog.workspaceId, accountId: catalog.accountScope }}
      scopeKey={catalog.key} onClose={() => setOpen(false)}
    /> : null}
  </>;
}

function ShareDialog({ scope, scopeKey, onClose }: {
  scope: { articleId: string; workspaceId: string; accountId: string }; scopeKey: string; onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const key = ["analysis-sharing", scopeKey, scope.articleId] as const;
  const sharing = useQuery({ queryKey: key, queryFn: () => getArticleSharing(scope), retry: false });
  const [email, setEmail] = useState("");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => createArticleInvitation(scope, email.trim()),
    onSuccess: async (result) => { setCreatedLink(result.url); setError(null); await queryClient.invalidateQueries({ queryKey: key }); },
    onError: (reason) => setError(errMessage(reason)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeArticleInvitation(scope, id),
    onSuccess: async () => { setCreatedLink(null); setError(null); await queryClient.invalidateQueries({ queryKey: key }); },
    onError: (reason) => setError(errMessage(reason)),
  });
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setFeedback(t("analysis.copiedLink")); setError(null); }
    catch (reason) { setError(errMessage(reason)); }
  }
  const busy = invite.isPending || revoke.isPending;
  const data = sharing.data;
  return <ModalBackdrop onMouseDown={onClose}>
    <ModalSurface aria-labelledby="analysis-share-title" onRequestClose={onClose}>
      <ModalHeader title={t("analysis.shareTitle")} titleId="analysis-share-title" />
      <div className="scrollbar-sleek tw:grid tw:min-h-0 tw:flex-1 tw:gap-5 tw:overflow-auto tw:p-5">
        {sharing.isPending ? <LoadingLabel>{t("analysis.loading")}</LoadingLabel> : null}
        {sharing.isError ? <><InlineNotice icon="alert" tone="danger" role="alert">{t("analysis.shareLoadFailed")}</InlineNotice><Button onClick={() => void sharing.refetch()}>{t("analysis.retryShared")}</Button></> : null}
        {data ? <>
          <section className="tw:grid tw:gap-2">
            <strong className="tw:text-sm">{t("analysis.shareExisting")}</strong>
            <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">{t("analysis.shareExistingBody")}</p>
            <TextInput aria-label={t("analysis.shareExisting")} value={data.url} readOnly onFocus={(event) => event.currentTarget.select()} />
            <Button onClick={() => void copy(data.url)}><Icon name="copy" />{t("analysis.copyLink")}</Button>
          </section>
          {data.canInvite ? <section className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-4">
            <strong className="tw:text-sm">{t("analysis.inviteTitle")}</strong>
            <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">{data.connectionName} · {t("analysis.inviteScope")}</p>
            {data.credentialMode !== "managed" ? <InlineNotice icon="alert" tone="warning">{t("analysis.inviteLocal")}</InlineNotice> : null}
            <form className="tw:grid tw:gap-3" onSubmit={(event) => { event.preventDefault(); setFeedback(null); invite.mutate(); }}>
              <Field label={t("analysis.inviteEmail")}><TextInput type="email" required maxLength={254} value={email} disabled={busy} onChange={(event) => { setEmail(event.target.value); setCreatedLink(null); }} /></Field>
              <Button type="submit" variant="primary" disabled={busy || !email.trim() || !!createdLink}>{invite.isPending ? t("analysis.creatingInvite") : t("analysis.createInvite")}</Button>
            </form>
            {createdLink ? <div className="tw:grid tw:gap-2">
              <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">{t("analysis.inviteLink")}</p>
              <TextInput aria-label={t("analysis.inviteLink")} value={createdLink} readOnly onFocus={(event) => event.currentTarget.select()} />
              <Button onClick={() => void copy(createdLink)}><Icon name="copy" />{t("analysis.copyLink")}</Button>
            </div> : null}
            {data.invitations.length > 0 ? <>
              <strong className="tw:mt-2 tw:text-xs">{t("analysis.inviteHistory")}</strong>
              <ul className="tw:m-0 tw:grid tw:list-none tw:gap-3 tw:p-0">
                {data.invitations.map((invitation) => {
                  const active = !invitation.acceptedAt && !invitation.revokedAt && Date.parse(invitation.expiresAt) > Date.now();
                  const status = invitation.acceptedAt ? t("analysis.inviteAccepted") : invitation.revokedAt ? t("analysis.inviteRevoked") : !active ? t("analysis.inviteExpired") : t("analysis.invitePending", { date: new Date(invitation.expiresAt).toLocaleDateString(lang) });
                  return <li key={invitation.id} className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
                    <div className="tw:grid tw:min-w-0 tw:gap-1"><span className="tw:break-all tw:text-xs">{invitation.recipientEmail}</span><span className="tw:text-2xs tw:text-muted-foreground">{status}</span></div>
                    {active ? <div className="tw:flex tw:gap-1"><Button size="compact" aria-label={`${t("analysis.copyLink")} · ${invitation.recipientEmail}`} disabled={busy} onClick={() => void copy(`${new URL(data.url).origin}/article-invitations/${invitation.id}`)}>{t("analysis.copyLink")}</Button><Button size="compact" disabled={busy} onClick={() => revoke.mutate(invitation.id)}>{t("analysis.cancelInvite")}</Button></div> : null}
                  </li>;
                })}
              </ul>
              <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">{t("analysis.inviteRevokeHelp")}</p>
            </> : null}
          </section> : <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">{t("analysis.inviteAdminOnly")}</p>}
        </> : null}
        {feedback ? <p className="tw:m-0 tw:text-xs tw:text-success" role="status">{feedback}</p> : null}
        {error ? <InlineNotice icon="alert" tone="danger" role="alert">{error}</InlineNotice> : null}
      </div>
      <ModalFooter><Button onClick={onClose}>{t("common.close")}</Button></ModalFooter>
    </ModalSurface>
  </ModalBackdrop>;
}
