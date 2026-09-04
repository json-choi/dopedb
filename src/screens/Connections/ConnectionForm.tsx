// Compact connection and driver editor. Feature controllers own the
// workflow; this screen only composes grouped presentation models.
import {
  ModalBackdrop,
  ModalHeader,
  ModalSurface,
} from "../../design-system/components/Modal";
import {
  useConnectionEditorController,
  type ConnectionEditorProps,
} from "../../features/connections/useConnectionEditorController";
import { useI18n } from "../../lib/i18n";
import { ConnectionCatalogCompactSelector } from "./ConnectionCatalogCompactSelector";
import { ConnectionCatalogDetail } from "./ConnectionCatalogDetail";
import { ConnectionCatalogNavigation } from "./ConnectionCatalogNavigation";
import { ConnectionEditorDialogs } from "./ConnectionEditorDialogs";
import { ConnectionEditorFooter } from "./ConnectionEditorFooter";
import { ConnectionProfilePanel } from "./ConnectionProfilePanel";

export function ConnectionForm(props: ConnectionEditorProps) {
  const { t } = useI18n();
  const { profile, catalog, schema, dialogs, commands } =
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
            const target = event.target as HTMLInputElement;
            if (
              event.key === "Enter" &&
              target.id === "connection-url" &&
              !commands.busy
            ) {
              event.preventDefault();
              profile.url.normalize(target.value);
            } else if (
              event.key === "Enter" &&
              target.tagName === "INPUT" &&
              target.type !== "search" &&
              !commands.busy
            ) {
              event.preventDefault();
              void commands.save(true);
            }
          }}
        >
          <ModalHeader
            title={t("connections.dataSourcesAndDrivers")}
            titleId="connection-editor-title"
          />

          <div className="tw:flex tw:min-h-0 tw:flex-1 tw:@max-[760px]:flex-col">
            <ConnectionCatalogNavigation
              catalog={catalog}
              profile={profile}
              dialogs={dialogs}
              commands={commands}
              creatingDemo={creatingDemo}
              onCreateDemoDatabase={onCreateDemoDatabase}
              onEditConnection={props.onEditConnection}
            />

            <section className="tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
              <ConnectionCatalogCompactSelector
                catalog={catalog}
                profile={profile}
                onEditConnection={props.onEditConnection}
                onNewConnection={props.onNewConnection}
              />
              {catalog.navigation.view === "dataSources" ? (
                <ConnectionProfilePanel
                  profile={profile}
                  sources={catalog.sources}
                  drivers={catalog.drivers}
                  schema={schema}
                  problems={dialogs.problems}
                  workspaceDialog={dialogs.workspace}
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
            hasBlockingProblems={dialogs.problems.hasBlocking}
            commands={commands}
            onCancel={() => void commands.cancel()}
          />
          <ConnectionEditorDialogs
            profile={profile}
            dialogs={dialogs}
            bindWorkspaceConnection={commands.bindWorkspaceConnection}
          />
        </div>
      </ModalSurface>
    </ModalBackdrop>
  );
}
