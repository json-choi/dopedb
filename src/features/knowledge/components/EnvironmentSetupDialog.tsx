// One Environment creation dialog. The environment is one choice from the fixed list
// (development, staging, production, test), limited to the kinds the Project does not
// have yet. With a target Project it adds an Environment; with none it creates a new
// Project together with its first. Choosing production needs an explicit confirmation
// in both cases. Both return the revisioned Project.
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
import {
  ENVIRONMENT_KIND_CHOICES,
  environmentKindLabel,
  type EnvironmentKind,
} from "../../../lib/environmentKind";
import { useI18n } from "../../../lib/i18n";
import type { KnowledgeProject } from "../domain";
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
  const availableKinds = ENVIRONMENT_KIND_CHOICES.filter(
    (candidate) =>
      !selectedProject?.environments.some((environment) => environment.kind === candidate),
  );
  const [chosenKind, setChosenKind] = useState<EnvironmentKind>("development");
  // The choice follows the Project: a kind it already has is never selectable.
  const kind = availableKinds.includes(chosenKind) ? chosenKind : availableKinds[0] ?? null;
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      newProject
        ? createKnowledgeProject({
            name: projectName.trim(),
            environments: [{ kind: kind! }],
          })
        : createKnowledgeEnvironment({ projectId, kind: kind! }),
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
    kind !== null &&
    (newProject ? projectName.trim().length > 0 : selectedProject !== null) &&
    (kind !== "production" || productionConfirmed);

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
            {kind === null ? (
              <InlineNotice tone="warning" icon="alert">
                {t("connections.environmentKindsExhausted")}
              </InlineNotice>
            ) : (
              <Field label={t("connections.environment")}>
                <SelectInput
                  data-modal-initial-focus={newProject ? undefined : true}
                  density="compact"
                  value={kind}
                  onChange={(event) => {
                    setChosenKind(event.target.value as EnvironmentKind);
                    setProductionConfirmed(false);
                  }}
                >
                  {availableKinds.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {environmentKindLabel(t, candidate)}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            )}
            {kind === "production" ? (
              <InlineNotice tone="warning" icon="alert">
                <CheckboxField
                  checked={productionConfirmed}
                  onChange={(event) =>
                    setProductionConfirmed(event.target.checked)
                  }
                  label={t("connections.environmentProductionConfirm")}
                />
              </InlineNotice>
            ) : newProject ? (
              <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">
                {t("connections.projectSetupNextStep")}
              </p>
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
