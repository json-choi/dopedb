// One Environment creation dialog. With a target Project it adds an Environment
// (production needs an explicit confirmation); with none it creates a new Project
// together with its first Environment. Both return the revisioned Project.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "../../../design-system/components/Button";
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from "../../../design-system/components/FormControls";
import {
  ModalBackdrop,
  ModalFooter,
  ModalHeader,
  ModalSurface,
} from "../../../design-system/components/Modal";
import { InlineNotice } from "../../../design-system/components/Status";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import type { KnowledgeEnvironment, KnowledgeProject } from "../domain";
import { knowledgeQueryKeys } from "../queryKeys";
import { createKnowledgeEnvironment, createKnowledgeProject } from "../tauriAdapter";

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
  /** The Project to add an Environment to; null creates a new Project instead. */
  preferredProjectId: string | null;
  catalogScopeKey: string;
  onClose: () => void;
  onCreated: (project: KnowledgeProject) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const newProject = preferredProjectId === null;
  const [projectId, setProjectId] = useState(() =>
    initialProjectId(projects, preferredProjectId),
  );
  const selectedProject = newProject
    ? null
    : projects.find((project) => project.id === projectId) ?? null;
  const [projectName, setProjectName] = useState("");
  const [environmentName, setEnvironmentName] = useState(newProject ? "main" : "");
  const [riskClass, setRiskClass] =
    useState<KnowledgeEnvironment["riskClass"]>("development");
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      newProject
        ? createKnowledgeProject({
            name: projectName.trim(),
            environments: [{ name: environmentName.trim(), riskClass }],
          })
        : createKnowledgeEnvironment({
            projectId,
            name: environmentName.trim(),
            riskClass,
          }),
    onSuccess: async (project) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.inventory(catalogScopeKey),
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.agentEnvironments(),
        }),
      ]);
      onCreated(project);
      onClose();
    },
  });
  const canCreate =
    environmentName.trim().length > 0 &&
    (newProject
      ? projectName.trim().length > 0
      : selectedProject !== null &&
        (riskClass !== "production" || productionConfirmed));

  return (
    <ModalBackdrop
      onMouseDown={() => {
        if (!create.isPending) onClose();
      }}
    >
      <ModalSurface
        aria-labelledby={ENVIRONMENT_SETUP_TITLE_ID}
        onRequestClose={onClose}
        dismissible={!create.isPending}
      >
        <form
          className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate || create.isPending) return;
            create.mutate();
          }}
        >
          <ModalHeader
            title={t(newProject ? "connections.projectSetupTitle" : "connections.environmentSetupTitle")}
            titleId={ENVIRONMENT_SETUP_TITLE_ID}
          />
          <div className="tw:grid tw:min-h-0 tw:flex-1 tw:content-start tw:gap-4 tw:overflow-y-auto tw:p-5 tw:max-[640px]:p-4">
            <p className="tw:m-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
              {t(newProject ? "connections.projectSetupDescription" : "connections.environmentSetupDescription")}
            </p>
            {newProject ? (
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
            ) : (
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
            )}
            <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:@max-[520px]:grid-cols-1">
              <Field label={t("connections.environmentName")}>
                <TextInput
                  data-modal-initial-focus={newProject ? undefined : true}
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
                  onChange={(event) => {
                    setRiskClass(
                      event.target.value as KnowledgeEnvironment["riskClass"],
                    );
                    setProductionConfirmed(false);
                  }}
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
            {newProject ? (
              <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">
                {t("connections.projectSetupNextStep")}
              </p>
            ) : riskClass === "production" ? (
              <InlineNotice tone="warning" icon="alert">
                <CheckboxField
                  checked={productionConfirmed}
                  onChange={(event) =>
                    setProductionConfirmed(event.target.checked)
                  }
                  label={t("connections.environmentProductionConfirm")}
                />
              </InlineNotice>
            ) : null}
            {create.error ? (
              <InlineNotice tone="danger" icon="alert" role="alert">
                {errMessage(create.error)}
              </InlineNotice>
            ) : null}
          </div>
          <ModalFooter>
            <Button
              variant="ghost"
              disabled={create.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!canCreate || create.isPending}
            >
              {create.isPending
                ? t(newProject ? "connections.creatingProject" : "connections.creatingEnvironment")
                : t(newProject ? "connections.createProject" : "connections.addEnvironment")}
            </Button>
          </ModalFooter>
        </form>
      </ModalSurface>
    </ModalBackdrop>
  );
}
