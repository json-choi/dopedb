// Shared heading and load feedback for the selected Knowledge environment view.
import { Icon } from "../../../components/Icon";
import { Button } from "../../../design-system/components/Button";
import { EnvironmentBadge } from "../../../design-system/components/EnvironmentBadge";
import { InlineNotice } from "../../../design-system/components/Status";
import { useI18n } from "../../../lib/i18n";
import type {
  KnowledgeEnvironment,
  KnowledgeEnvironmentView,
  KnowledgeProject,
} from "../domain";
import { knowledgeEnvironmentBadge } from "../presentation";

interface KnowledgeWorkspaceHeaderProps {
  view: KnowledgeEnvironmentView;
  project: KnowledgeProject | null;
  environment: KnowledgeEnvironment | null;
  loadFailure: {
    hasData: boolean;
    message: string;
    retry: () => unknown;
  } | null;
  actionError: string | null;
  projectsEmpty: boolean;
}

export function KnowledgeWorkspaceHeader({
  view,
  project,
  environment,
  loadFailure,
  actionError,
  projectsEmpty,
}: KnowledgeWorkspaceHeaderProps) {
  const { t } = useI18n();
  const title =
    view === "databases"
      ? t("knowledge.viewDatabases")
      : t("knowledge.viewSources");
  return (
    <>
      <header className="tw:flex tw:min-h-control-lg tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:pb-3">
        <Icon
          name={view === "databases" ? "database" : "branch"}
          className="tw:shrink-0 tw:text-muted-foreground"
        />
        <h1 className="tw:m-0 tw:min-w-0 tw:truncate tw:text-base tw:font-semibold tw:tracking-tight">
          {title}
        </h1>
        {project && environment ? (
          <span className="tw:min-w-0 tw:truncate tw:text-xs tw:text-muted-foreground">
            {project.name} / {environment.name}
          </span>
        ) : null}
        {environment ? (
          <EnvironmentBadge
            environment={knowledgeEnvironmentBadge(environment.riskClass)}
          />
        ) : null}
        {environment ? (
          <span className="tw:ml-auto tw:font-mono tw:text-2xs tw:text-muted-foreground">
            r{environment.revision}
          </span>
        ) : null}
      </header>

      {loadFailure ? (
        <InlineNotice
          tone={loadFailure.hasData ? "warning" : "danger"}
          icon="alert"
          role={loadFailure.hasData ? "status" : "alert"}
          action={(
            <Button size="compact" onClick={() => void loadFailure.retry()}>
              {t("knowledge.retry")}
            </Button>
          )}
        >
          {loadFailure.message}
        </InlineNotice>
      ) : null}
      {actionError ? (
        <InlineNotice tone="danger" icon="alert" role="alert">
          {actionError}
        </InlineNotice>
      ) : null}
      {projectsEmpty ? (
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          {t("knowledge.emptyProjects")}
        </p>
      ) : null}
    </>
  );
}
