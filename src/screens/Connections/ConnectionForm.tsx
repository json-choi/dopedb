// Compact connection and driver editor. Feature controllers own the
// workflow; this screen only composes grouped presentation models.
import { useRef, type KeyboardEvent } from "react";
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
import { ConnectionSourcePicker } from "./ConnectionSourcePicker";
import { ConnectionProfilePanel } from "./ConnectionProfilePanel";

export function ConnectionForm(props: ConnectionEditorProps) {
  const { t } = useI18n();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const { profile, catalog, schema, dialogs, commands } =
    useConnectionEditorController(props);
  const { creatingDemo, onCreateDemoDatabase } = props;

  /**
   * Enter saves only the editor's own form.
   *
   * A nested credential dialog or the source picker is a React child of this
   * editor even though it renders through a portal, so its Enter still bubbles
   * here as a synthetic event. Ownership is therefore decided by which dialog
   * surface the keystroke came from, not by where React mounted it. A Korean IME
   * also reports Enter while a candidate is still being composed; committing that
   * syllable must never save and close the editor behind it.
   */
  const ownsEnter = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return false;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.closest('[role="dialog"], [role="alertdialog"]') ===
      surfaceRef.current
    );
  };

  return (
    <ModalBackdrop>
      <ModalSurface
        ref={surfaceRef}
        size="dataSources"
        aria-labelledby="connection-editor-title"
        aria-busy={commands.busy}
        onRequestClose={() => void commands.cancel()}
        dismissible={!commands.busy}
      >
        <div
          className="tw:flex tw:h-full tw:min-h-0 tw:flex-col tw:overflow-hidden tw:bg-background"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || commands.busy || !ownsEnter(event)) {
              return;
            }
            const target = event.target as HTMLInputElement;
            if (target.id === "connection-url") {
              event.preventDefault();
              profile.url.normalize(target.value);
            } else if (
              target.tagName === "INPUT" &&
              target.type !== "search"
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
                  nameInputRef={nameInputRef}
                  autoFocus={!catalog.addMenu.open}
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
        </div>
      </ModalSurface>
    </ModalBackdrop>
  );
}
