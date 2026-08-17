import { useRef, useState } from "react";
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
import type {
  KnowledgeEnvironment,
  KnowledgeProject,
} from "../domain";
import { knowledgeQueryKeys } from "../queryKeys";
import { createKnowledgeProject } from "../tauriAdapter";

const PROJECT_SETUP_TITLE_ID = "project-setup-title";

export function ProjectSetupDialog({
  catalogScopeKey,
  onClose,
  onCreated,
}: {
  catalogScopeKey: string;
  onClose: () => void;
  onCreated: (project: KnowledgeProject) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const analyticsContext = useRef<ProductAnalyticsWorkspaceContextInput | null>(
    null,
  );
  const [projectName, setProjectName] = useState("");
  const [environmentName, setEnvironmentName] = useState("main");
  const [riskClass, setRiskClass] =
    useState<KnowledgeEnvironment["riskClass"]>("development");
  const createProject = useMutation({
    mutationFn: createKnowledgeProject,
    onMutate: () => {
      analyticsContext.current = productAnalyticsWorkspaceContext(catalogScope);
    },
    onSuccess: async (project) => {
      const context = analyticsContext.current;
      analyticsContext.current = null;
      const environmentId = project.environments[0]?.id;
      if (context && environmentId) {
        void captureProductEvent({
          name: "knowledge_environment_created",
          properties: { creationKind: "project_default" },
          context,
          dedupeId: environmentId,
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
      analyticsContext.current = null;
    },
  });
  const canCreate =
    projectName.trim().length > 0 && environmentName.trim().length > 0;

  return (
    <ModalBackdrop
      onMouseDown={() => {
        if (!createProject.isPending) onClose();
      }}
    >
      <ModalSurface
        aria-labelledby={PROJECT_SETUP_TITLE_ID}
        onEscape={createProject.isPending ? undefined : onClose}
      >
        <form
          className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate || createProject.isPending) return;
            createProject.mutate({
              name: projectName.trim(),
              environments: [
                { name: environmentName.trim(), riskClass },
              ],
            });
          }}
        >
          <ModalTitleBar
            title={t("connections.projectSetupTitle")}
            titleId={PROJECT_SETUP_TITLE_ID}
            closeLabel={t("common.close")}
            onClose={() => {
              if (!createProject.isPending) onClose();
            }}
          />
          <div className="tw:grid tw:min-h-0 tw:flex-1 tw:content-start tw:gap-5 tw:overflow-y-auto tw:p-5 tw:max-[640px]:p-4">
            <p className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
              {t("connections.projectSetupDescription")}
            </p>

            <section className="tw:grid tw:gap-2">
              <h2 className="tw:m-0 tw:text-sm tw:font-semibold tw:text-foreground">
                {t("connections.projects")}
              </h2>
              <Field label={t("connections.projectName")}>
                <TextInput
                  data-modal-initial-focus
                  density="compact"
                  value={projectName}
                  placeholder={t("connections.projectNamePlaceholder")}
                  autoComplete="off"
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </Field>
            </section>

            <section className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-4">
              <h2 className="tw:m-0 tw:text-sm tw:font-semibold tw:text-foreground">
                {t("connections.firstEnvironment")}
              </h2>
              <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[520px]:grid-cols-1">
                <Field label={t("connections.environmentName")}>
                  <TextInput
                    density="compact"
                    value={environmentName}
                    placeholder={t("connections.environmentNamePlaceholder")}
                    autoComplete="off"
                    onChange={(event) =>
                      setEnvironmentName(event.target.value)
                    }
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
              <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">
                {t("connections.projectSetupNextStep")}
              </p>
            </section>

            {createProject.error ? (
              <InlineNotice tone="danger" icon="alert" role="alert">
                {errMessage(createProject.error)}
              </InlineNotice>
            ) : null}
          </div>
          <ModalFooter>
            <Button
              variant="ghost"
              disabled={createProject.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canCreate || createProject.isPending}
            >
              {createProject.isPending
                ? t("connections.creatingProject")
                : t("connections.createProject")}
            </Button>
          </ModalFooter>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
