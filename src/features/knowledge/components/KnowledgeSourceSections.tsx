// Source connection and inventory presentation for one selected environment.
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import {
  Field,
  SelectInput,
  TextInput,
} from "../../../design-system/components/FormControls";
import {
  InlineNotice,
  LoadingLabel,
  StatusBadge,
  type StatusTone,
} from "../../../design-system/components/Status";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import type { QueryResultPhase } from "../../../lib/queryResultPhase";
import type {
  GithubKnowledgeRepository,
  KnowledgeSource,
} from "../domain";
import {
  knowledgeRevisionLabel,
} from "../presentation";
import type { GithubInstallState } from "../useKnowledgeGithubInstall";
import {
  knowledgeRepositoryLabel,
  knowledgeSourceHealthKey,
  type KnowledgeSourceActivity,
} from "../workspaceModel";

interface KnowledgeConnectSourceSectionProps {
  projectName: string;
  environmentName: string;
  githubProviderVisible: boolean;
  personalAuthResolved: boolean;
  githubAvailable: boolean;
  repositoryPhase: QueryResultPhase;
  repositories: GithubKnowledgeRepository[] | undefined;
  repositoryError: unknown;
  githubInstallState: GithubInstallState;
  repositoryId: string;
  refName: string;
  displayName: string;
  selectedRepository: GithubKnowledgeRepository | null;
  environmentSelected: boolean;
  pending: boolean;
  githubPending: boolean;
  localPending: boolean;
  onRepositoryChange: (repository: GithubKnowledgeRepository) => void;
  onRefNameChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onRetryRepositories: () => void;
  onBeginGithubInstall: () => void;
  onLogin: () => void;
  onConnectGithub: () => void;
  onConnectLocal: () => void;
}

export function KnowledgeConnectSourceSection({
  projectName,
  environmentName,
  githubProviderVisible,
  personalAuthResolved,
  githubAvailable,
  repositoryPhase,
  repositories,
  repositoryError,
  githubInstallState,
  repositoryId,
  refName,
  displayName,
  selectedRepository,
  environmentSelected,
  pending,
  githubPending,
  localPending,
  onRepositoryChange,
  onRefNameChange,
  onDisplayNameChange,
  onRetryRepositories,
  onBeginGithubInstall,
  onLogin,
  onConnectGithub,
  onConnectLocal,
}: KnowledgeConnectSourceSectionProps) {
  const { t } = useI18n();
  return (
    <section data-primary-flow className="tw:grid tw:gap-4 tw:border-b tw:border-border-subtle tw:pb-5">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-start tw:justify-between tw:gap-3">
        <div className="tw:grid tw:gap-1">
          <h2 className="tw:m-0 tw:text-base tw:font-semibold">
            {t("knowledge.connectSource")}
          </h2>
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
            {t("knowledge.connectSourceScope", {
              project: projectName,
              environment: environmentName,
            })}
          </p>
        </div>
      </div>

      {githubProviderVisible ? (
        !personalAuthResolved ? (
          <LoadingLabel>{t("workspace.loginChecking")}</LoadingLabel>
        ) : !githubAvailable ? (
          <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:bg-surface-subtle tw:p-3">
            <div className="tw:grid tw:min-w-0 tw:gap-1">
              <strong className="tw:text-sm tw:font-semibold">
                {t("knowledge.githubSignInTitle")}
              </strong>
              <span className="tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
                {t("knowledge.githubSignInHint")}
              </span>
            </div>
            <Button variant="primary" onClick={onLogin}>
              <Icon name="user" />
              {t("workspace.login")}
            </Button>
          </div>
        ) : repositoryPhase === "coldLoading" ? (
          <LoadingLabel>{t("knowledge.loadingRepositories")}</LoadingLabel>
        ) : repositoryPhase === "coldError" && repositoryError ? (
          <InlineNotice
            tone="danger"
            icon="alert"
            role="alert"
            action={(
              <Button size="compact" onClick={onRetryRepositories}>
                {t("knowledge.retry")}
              </Button>
            )}
          >
            {t("knowledge.repositoriesLoadFailed", {
              error: errMessage(repositoryError),
            })}
          </InlineNotice>
        ) : (repositories?.length ?? 0) === 0 ? (
          <>
            {repositoryError ? (
              <InlineNotice
                tone="warning"
                icon="alert"
                role="status"
                action={(
                  <Button size="compact" onClick={onRetryRepositories}>
                    {t("knowledge.retry")}
                  </Button>
                )}
              >
                {t("knowledge.repositoriesRefreshFailed", {
                  error: errMessage(repositoryError),
                })}
              </InlineNotice>
            ) : null}
            {githubInstallState === "returned-empty" && !repositoryError ? (
              <InlineNotice tone="warning" icon="info" role="status">
                {t("knowledge.githubAccessIncomplete")}
              </InlineNotice>
            ) : null}
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-3">
              {githubInstallState === "waiting" ? (
                <LoadingLabel>{t("knowledge.githubAccessWaiting")}</LoadingLabel>
              ) : (
                <span className="tw:text-sm tw:text-muted-foreground">
                  {t("knowledge.githubAccessHint")}
                </span>
              )}
              <Button
                disabled={githubInstallState === "waiting"}
                onClick={onBeginGithubInstall}
              >
                {t("knowledge.githubAccessAction")}
              </Button>
              <Button variant="ghost" onClick={onRetryRepositories}>
                <Icon name="refresh" />
                {t("knowledge.refresh")}
              </Button>
            </div>
          </>
        ) : (
          <>
            {repositoryError ? (
              <InlineNotice
                tone="warning"
                icon="alert"
                role="status"
                action={(
                  <Button size="compact" onClick={onRetryRepositories}>
                    {t("knowledge.retry")}
                  </Button>
                )}
              >
                {t("knowledge.repositoriesRefreshFailed", {
                  error: errMessage(repositoryError),
                })}
              </InlineNotice>
            ) : null}
            <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[620px]:grid-cols-1">
              <Field label={t("knowledge.repository")}>
                <SelectInput
                  value={repositoryId}
                  onChange={(event) => {
                    const repository = repositories?.find(
                      (candidate) => candidate.id === event.target.value,
                    );
                    if (repository) onRepositoryChange(repository);
                  }}
                >
                  {repositories?.filter((repository) => !repository.archived).map((repository) => (
                    <option
                      key={`${repository.installationId}:${repository.id}`}
                      value={repository.id}
                    >
                      {knowledgeRepositoryLabel(
                        repository,
                        t("knowledge.privateRepository"),
                      )}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label={t("knowledge.branchRef")}>
                <TextInput
                  value={refName}
                  onChange={(event) => onRefNameChange(event.target.value)}
                />
              </Field>
            </div>
            <Field label={t("knowledge.displayName")}>
              <TextInput
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
              />
            </Field>
            <div>
              <Button
                variant="primary"
                disabled={
                  !selectedRepository ||
                  !environmentSelected ||
                  !refName.trim() ||
                  !displayName.trim() ||
                  pending
                }
                onClick={onConnectGithub}
              >
                {githubPending
                  ? t("knowledge.connecting")
                  : t("knowledge.connectRepository")}
              </Button>
            </div>
          </>
        )
      ) : (
        <>
          <Field label={t("knowledge.displayName")}>
            <TextInput
              value={displayName}
              placeholder={t("knowledge.localPlaceholder")}
              onChange={(event) => onDisplayNameChange(event.target.value)}
            />
          </Field>
          <p className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
            {t("knowledge.localSafety")}
          </p>
          <div>
            <Button
              variant="primary"
              disabled={!environmentSelected || !displayName.trim() || pending}
              onClick={onConnectLocal}
            >
              <Icon name="folder" />
              {localPending
                ? t("knowledge.scanning")
                : t("knowledge.chooseFolder")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

interface KnowledgeSourceInventoryProps {
  phase: QueryResultPhase;
  sources: KnowledgeSource[];
  activityBySourceId: ReadonlyMap<string, KnowledgeSourceActivity>;
  revokePending: boolean;
  onRefresh: () => void;
  onRevoke: (sourceId: string) => void;
}

export function KnowledgeSourceInventory({
  phase,
  sources,
  activityBySourceId,
  revokePending,
  onRefresh,
  onRevoke,
}: KnowledgeSourceInventoryProps) {
  const { t } = useI18n();
  return (
    <section className="tw:grid tw:gap-3">
      <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
        <h2 className="tw:m-0 tw:text-base tw:font-semibold">
          {t("knowledge.sources")}
        </h2>
        <Button
          iconOnly
          size="compact"
          variant="ghost"
          title={t("knowledge.refreshSources")}
          onClick={onRefresh}
        >
          <Icon name="refresh" />
        </Button>
      </div>
      {phase === "coldLoading" ? (
        <LoadingLabel>{t("knowledge.loadingSources")}</LoadingLabel>
      ) : phase === "coldError" ? null : sources.length === 0 ? (
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          {t("knowledge.emptySources")}
        </p>
      ) : (
        <div className="tw:grid tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle">
          {sources.map((source) => {
            const activity = activityBySourceId.get(source.sourceId);
            const visibleHealth =
              source.provider === "github"
                ? source.health
                : activity?.state ?? source.health;
            const tone: StatusTone =
              visibleHealth === "ready"
                ? "success"
                : visibleHealth === "failed"
                  ? "danger"
                  : "warning";
            return (
              <article
                key={source.sourceId}
                className="tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:border-b tw:border-border-subtle tw:px-3 tw:py-3 tw:last:border-b-0 tw:@max-[560px]:grid-cols-1"
              >
                <div className="tw:grid tw:min-w-0 tw:gap-1">
                  <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
                    <strong className="tw:truncate tw:text-sm">
                      {source.displayName}
                    </strong>
                    <StatusBadge tone={tone} density="compact">
                      {t(knowledgeSourceHealthKey[visibleHealth])}
                    </StatusBadge>
                    <StatusBadge density="compact">
                      {source.provider === "github"
                        ? "GitHub"
                        : t("knowledge.localFolder")}
                    </StatusBadge>
                  </div>
                  <span className="tw:truncate tw:text-xs tw:text-muted-foreground">
                    {source.projectName} / {source.environmentName} · {knowledgeRevisionLabel(source.revision, {
                      dirty: t("knowledge.revisionDirty"),
                      snapshot: t("knowledge.revisionSnapshot"),
                    })}
                  </span>
                  {source.provider === "github" ? (
                    <span className="tw:text-xs tw:text-muted-foreground">
                      {t("knowledge.sourceBrowseMode")}
                    </span>
                  ) : null}
                  {source.provider === "local_folder" && !source.localCapabilityAvailable ? (
                    <span className="tw:text-xs tw:text-warning">
                      {t("knowledge.restoreLocalFolder")}
                    </span>
                  ) : null}
                  {activity?.state === "failed" ? (
                    <span className="tw:text-xs tw:text-danger">
                      {t("knowledge.syncFailed", {
                        error: activity.errorKind ?? t("knowledge.unknownSyncError"),
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:@max-[560px]:justify-start">
                  <ConfirmButton
                    size="compact"
                    variant="dangerGhost"
                    disabled={revokePending}
                    onConfirm={() => onRevoke(source.sourceId)}
                  >
                    {t("knowledge.remove")}
                  </ConfirmButton>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
