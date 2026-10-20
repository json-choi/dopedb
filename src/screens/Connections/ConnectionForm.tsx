// Compact connection and driver editor. Feature controllers own the
// workflow, including the unsaved-change decision this screen presents;
// this screen only composes grouped presentation models.
import { useRef } from "react";
import ConfirmDialog from "../../components/ConfirmDialog";
import {
  ModalBackdrop,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import {
  useConnectionEditorController,
  type ConnectionEditorProps,
} from "../../features/connections/useConnectionEditorController";
import {
  connectionEditorEnterCommand,
} from "../../features/connections/connectionEditorInteraction";
import { useI18n } from "../../lib/i18n";
import { ConnectionCatalogCompactSelector } from "./ConnectionCatalogCompactSelector";
import { ConnectionCatalogDetail } from "./ConnectionCatalogDetail";
import { ConnectionCatalogNavigation } from "./ConnectionCatalogNavigation";
import { ConnectionEditorDialogs } from "./ConnectionEditorDialogs";
import { ConnectionEditorFooter } from "./ConnectionEditorFooter";
import { ConnectionSourcePicker } from "./ConnectionSourcePicker";
import { ConnectionProfilePanel } from "./ConnectionProfilePanel";

export function ConnectionForm(props: ConnectionEditorProps) {
  const { t } = useI18n();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { profile, catalog, navigation, schema, credentialMethod, dialogs, commands } =
    useConnectionEditorController(props);
  const { creatingDemo, onCreateDemoDatabase } = props;

  return (
    <ModalBackdrop>
      <ModalSurface
        size="dataSources"
        aria-labelledby="connection-editor-title"
        aria-busy={commands.busy}
        onRequestClose={() => void commands.cancel()}
        dismissible={!commands.busy}
      >
        <div
          className="tw:flex tw:h-full tw:min-h-0 tw:flex-col tw:overflow-hidden tw:bg-background"
          onKeyDown={(event) => {
            const target = event.target;
            const input = target instanceof HTMLInputElement ? target : null;
            const command = connectionEditorEnterCommand({
              key: event.key,
              defaultPrevented: event.defaultPrevented,
              isComposing: event.nativeEvent.isComposing,
              busy: commands.busy,
              editorOwnsTarget:
                target instanceof Node && event.currentTarget.contains(target),
              nestedFormOwnsTarget:
                target instanceof Element && target.closest("form") !== null,
              inputType: input?.type ?? null,
              inputId: input?.id ?? null,
            });
            if (command === "normalizeUrl" && input) {
              event.preventDefault();
              profile.url.normalize(input.value);
            } else if (command === "save") {
              event.preventDefault();
              void commands.save(true);
            }
          }}
        >
          <ModalHeader
            title={props.preset?.source === "schemaAdmin"
              ? `${t("safety.adminConnectionTitle")} · ${t("safety.adminConnectionScope")}`
              : t("connections.dataSourcesAndDrivers")}
            titleId="connection-editor-title"
          />

          <div className="tw:flex tw:min-h-0 tw:flex-1 tw:@max-[760px]:flex-col">
            <ConnectionCatalogNavigation
              catalog={catalog}
              profile={profile}
              dialogs={dialogs}
              commands={commands}
              onEditConnection={navigation.editConnection}
            />

            <section className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
              <ConnectionCatalogCompactSelector
                catalog={catalog}
                profile={profile}
                dialogs={dialogs}
                commands={commands}
                onEditConnection={navigation.editConnection}
                onNewConnection={navigation.newConnection}
              />
              {catalog.navigation.view === "dataSources" ? (
                <ConnectionProfilePanel
                  nameInputRef={nameInputRef}
                  autoFocus={!catalog.addMenu.open}
                  profile={profile}
                  sources={catalog.sources}
                  drivers={catalog.drivers}
                  schema={schema}
                  problems={dialogs.problems}
                  workspaceDialog={dialogs.workspace}
                  credentialMethod={credentialMethod}
                  commands={commands}
                />
              ) : (
                <ConnectionCatalogDetail
                  catalog={catalog}
                  profile={profile}
                />
              )}
            </section>
          </div>

          <ConnectionEditorFooter
            view={catalog.navigation.view}
            canEditConnection={profile.flags.canEditConnection}
            flowActive={credentialMethod.flowActive}
            commands={commands}
            onCancel={() => void commands.cancel()}
          />
          {catalog.addMenu.open ? (
            <ConnectionSourcePicker
              catalog={catalog}
              nameInputRef={nameInputRef}
              creatingDemo={creatingDemo}
              onCreateDemoDatabase={onCreateDemoDatabase}
            />
          ) : null}
          <ConnectionEditorDialogs
            profile={profile}
            dialogs={dialogs}
            bindWorkspaceConnection={commands.bindWorkspaceConnection}
          />
          {commands.discard.pending ? (
            <ConfirmDialog
              title={t("connections.discardChangesTitle")}
              description={t("connections.discardChangesBody")}
              cancelLabel={t("connections.keepEditing")}
              confirmLabel={t("connections.discardChanges")}
              onCancel={commands.discard.keepEditing}
              onConfirm={commands.discard.confirm}
            />
          ) : null}
        </div>
      </ModalSurface>
    </ModalBackdrop>
  );
}
