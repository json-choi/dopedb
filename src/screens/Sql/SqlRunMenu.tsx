// Projects revision-pinned run choices into the shared caret-anchored menu.
// Hover/keyboard focus previews exact ranges; confirmation delegates to the
// controller's existing execution path rather than executing SQL here.
import { PopupMenu, PopupMenuItem } from "../../design-system/components/PopupMenu";
import type { useSqlRunChooser } from "../../features/queries/useSqlRunChooser";
import { useI18n } from "../../lib/i18n";

export default function SqlRunMenu({
  chooser,
}: {
  chooser: ReturnType<typeof useSqlRunChooser>;
}) {
  const { t } = useI18n();
  const pending = chooser.current;
  if (!pending) return null;
  return (
    <PopupMenu
      anchorRef={chooser.anchorRef}
      getAnchorRect={pending.getAnchorRect}
      placement="bottom-start"
      ariaLabel={t("sql.chooseExecution")}
      initialFocus="first"
      onRequestClose={chooser.close}
      onReferenceHidden={chooser.close}
    >
      <div className="tw:px-2 tw:py-1 tw:text-xs tw:text-muted-foreground">
        {t("sql.chooseExecution")}
      </div>
      {pending.choices.map((choice, index) => (
        <PopupMenuItem
          key={choice.kind}
          data-selected={pending.previewIndex === index}
          onFocus={() => chooser.preview(index)}
          onMouseEnter={(event) => {
            // Hover and keyboard confirmation must refer to the same candidate.
            event.currentTarget.focus({ preventScroll: true });
            chooser.preview(index);
          }}
          onClick={() => chooser.confirm(index)}
        >
          <span className="tw:grid tw:min-w-0 tw:flex-1 tw:py-1">
            <span className="tw:text-xs tw:text-muted-foreground">
              {t(choice.kind === "statement" ? "sql.currentStatement" : "sql.wholeScript")}
            </span>
            <span className="tw:truncate tw:font-mono" title={choice.source.sql}>
              {choice.source.sql.replace(/\s+/g, " ").slice(0, 160)}
            </span>
          </span>
        </PopupMenuItem>
      ))}
    </PopupMenu>
  );
}
