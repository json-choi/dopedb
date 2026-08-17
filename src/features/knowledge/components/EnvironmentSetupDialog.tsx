// Environment creation stays a scoped Project mutation. The dialog selects the
// target Project explicitly and returns the updated revisioned Project inventory.
import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "../../../design-system/components/Button";
import {
  Field,
  SelectInput,
  TextInput,
} from "../../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalSurface,
  ModalTitleBar,
} from "../../../design-system/components/Modal";
import { InlineNotice } from "../../../design-system/components/Status";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import { useCatalogScope } from "../../../lib/queries";
import { captureProductEvent } from "../../productAnalytics/client";
import type { ProductAnalyticsWorkspaceContextInput } from "../../productAnalytics/domain";
import { productAnalyticsWorkspaceContext } from "../../productAnalytics/outcomes";
import type { KnowledgeEnvironment, KnowledgeProject } from "../domain";
import { knowledgeQueryKeys } from "../queryKeys";
import { createKnowledgeEnvironment } from "../tauriAdapter";

const ENVIRONMENT_SETUP_TITLE_ID = "environment-setup-title";

function initialProjectId(
  projects: KnowledgeProject[],
  preferredProjectId: string | null,
): string {
  return projects.some((project) => project.id === preferredProjectId)
    ? preferredProjectId ?? ""
    : projects[0]?.id ?? "";
}

export function EnvironmentSetupDialog({
  projects,
  preferredProjectId,
  catalogScopeKey,
  onClose,
  onCreated,
}: {
  projects: KnowledgeProject[];
  preferredProjectId: string | null;
  catalogScopeKey: string;
  onClose: () => void;
  onCreated: (project: KnowledgeProject) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const analyticsAttempt = useRef<{
    context: ProductAnalyticsWorkspaceContextInput;
    existingEnvironmentIds: Set<string>;
  } | null>(null);
  const [projectId, setProjectId] = useState(() =>
    initialProjectId(projects, preferredProjectId),
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );
  const [environmentName, setEnvironmentName] = useState("prod");
  const [riskClass, setRiskClass] =
    useState<KnowledgeEnvironment["riskClass"]>("production");
  const createEnvironment = useMutation({
    mutationFn: createKnowledgeEnvironment,
    onMutate: () => {
      const context = productAnalyticsWorkspaceContext(catalogScope);
      analyticsAttempt.current = context && selectedProject
        ? {
            context,
            existingEnvironmentIds: new Set(
              selectedProject.environments.map((environment) => environment.id),
            ),
          }
        : null;
    },
    onSuccess: async (project) => {
      const attempt = analyticsAttempt.current;
      analyticsAttempt.current = null;
      const environment = attempt
        ? project.environments.find(
            (candidate) => !attempt.existingEnvironmentIds.has(candidate.id),
          )
        : null;
      if (attempt && environment) {
        void captureProductEvent({
          name: "knowledge_environment_created",
          properties: { creationKind: "additional" },
          context: attempt.context,
          dedupeId: environment.id,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.projects(catalogScopeKey),
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.agentEnvironments(),
        }),
      ]);
      onCreated(project);
      onClose();
    },
    onError: () => {
      analyticsAttempt.current = null;
    },
  });
  const canCreate =
    selectedProject !== null && environmentName.trim().length > 0;

  return (
    <ModalBackdrop
      onMouseDown={() => {
        if (!createEnvironment.isPending) onClose();
      }}
    >
      <ModalSurface
        aria-labelledby={ENVIRONMENT_SETUP_TITLE_ID}
        onEscape={createEnvironment.isPending ? undefined : onClose}
      >
        <form
          className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate || createEnvironment.isPending) return;
            createEnvironment.mutate({
              projectId,
              name: environmentName.trim(),
              riskClass,
            });
          }}
        >
          <ModalTitleBar
            title={t("connections.environmentSetupTitle")}
            titleId={ENVIRONMENT_SETUP_TITLE_ID}
            closeLabel={t("common.close")}
            onClose={() => {
              if (!createEnvironment.isPending) onClose();
            }}
          />
          <div className="tw:grid tw:min-h-0 tw:flex-1 tw:content-start tw:gap-4 tw:overflow-y-auto tw:p-5 tw:max-[640px]:p-4">
            <p className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
              {t("connections.environmentSetupDescription")}
            </p>
            <Field label={t("connections.projects")}>
              <SelectInput
                density="compact"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[520px]:grid-cols-1">
              <Field label={t("connections.environmentName")}>
                <TextInput
                  data-modal-initial-focus
                  density="compact"
                  value={environmentName}
                  placeholder={t("connections.environmentNamePlaceholder")}
                  autoComplete="off"
                  onChange={(event) => setEnvironmentName(event.target.value)}
                />
              </Field>
              <Field label={t("connections.environmentRiskClass")}>
                <SelectInput
                  density="compact"
                  value={riskClass}
                  onChange={(event) =>
                    setRiskClass(
                      event.target.value as KnowledgeEnvironment["riskClass"],
                    )
                  }
                >
                  <option value="development">
                    {t("connections.environmentRiskDevelopment")}
                  </option>
                  <option value="staging">
                    {t("connections.environmentRiskStaging")}
                  </option>
                  <option value="production">
                    {t("connections.environmentRiskProduction")}
                  </option>
                  <option value="test">
                    {t("connections.environmentRiskTest")}
                  </option>
                  <option value="custom">
                    {t("connections.environmentRiskCustom")}
                  </option>
                </SelectInput>
              </Field>
            </div>
            {createEnvironment.error ? (
              <InlineNotice tone="danger" icon="alert" role="alert">
                {errMessage(createEnvironment.error)}
              </InlineNotice>
            ) : null}
          </div>
          <ModalFooter>
            <Button
              variant="ghost"
              disabled={createEnvironment.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canCreate || createEnvironment.isPending}
            >
              {createEnvironment.isPending
                ? t("connections.creatingEnvironment")
                : t("connections.addEnvironment")}
            </Button>
          </ModalFooter>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
