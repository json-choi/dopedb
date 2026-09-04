import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { useI18n } from "../../lib/i18n";
import {
  gridExpressionIssue,
  type GridExpressionIssue,
  type GridExpressionKind,
} from "../../lib/sqlBuild";

type ExpressionFieldProps = {
  kind: GridExpressionKind;
  value: string;
  appliedValue: string;
  busy: boolean;
  onChange: (value: string) => void;
  onApply: (value: string) => void;
};

function ExpressionField({
  kind,
  value,
  appliedValue,
  busy,
  onChange,
  onApply,
}: ExpressionFieldProps) {
  const { t } = useI18n();
  const label = kind === "where" ? "WHERE" : "ORDER BY";
  const issue = gridExpressionIssue(kind, value);
  const dirty = value !== appliedValue;
  const hasExpression = Boolean(value || appliedValue);
  const issueLabel: Record<GridExpressionIssue, string> = {
    tooLong: t("tables.expressionTooLong"),
    statementBoundary: t("tables.expressionStatementBoundary"),
    unbalanced: t("tables.expressionUnbalanced"),
    clauseBoundary: t("tables.expressionClauseBoundary"),
  };
  const error = issue ? issueLabel[issue] : undefined;

  return (
    <div className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:border-r tw:border-border-subtle tw:last:border-r-0">
      <span className="tw:inline-flex tw:h-control-sm tw:shrink-0 tw:items-center tw:gap-1 tw:px-2 tw:text-xs tw:font-semibold tw:text-muted-foreground">
        <Icon name={kind === "where" ? "filter" : "sort"} />
        {label}
      </span>
      <input
        className="tw:mx-1 tw:h-[calc(var(--ds-control-sm)_-_6px)] tw:min-h-0 tw:min-w-0 tw:flex-1 tw:rounded-xs tw:border tw:border-input tw:bg-input tw:px-2 tw:font-mono tw:text-sm tw:text-foreground tw:shadow-none tw:data-[dirty=true]:border-ring tw:focus-visible:border-ring tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring/30 tw:aria-invalid:border-danger tw:aria-invalid:text-danger"
        value={value}
        data-dirty={dirty || undefined}
        disabled={busy}
        placeholder={t(
          kind === "where"
            ? "tables.whereExpressionPlaceholder"
            : "tables.orderByExpressionPlaceholder",
        )}
        aria-label={t(
          kind === "where"
            ? "tables.whereExpression"
            : "tables.orderByExpression",
        )}
        aria-invalid={Boolean(issue)}
        title={error}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onChange(appliedValue);
            return;
          }
          if (event.key !== "Enter" || issue || !dirty) return;
          event.preventDefault();
          onApply(value);
        }}
      />
      {issue ? (
        <span
          className="tw:inline-flex tw:size-control-sm tw:shrink-0 tw:items-center tw:justify-center tw:text-danger"
          title={error}
          aria-label={error}
        >
          <Icon name="alert" />
        </span>
      ) : dirty ? (
        <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={busy}
          title={t("tables.applyExpression", { label })}
          aria-label={t("tables.applyExpression", { label })}
          onClick={() => onApply(value)}
        >
          <Icon name="play" />
        </Button>
      ) : null}
      {hasExpression ? (
        <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={busy}
          title={t("tables.clearExpression", { label })}
          aria-label={t("tables.clearExpression", { label })}
          onClick={() => {
            onChange("");
            onApply("");
          }}
        >
          <Icon name="close" />
        </Button>
      ) : null}
    </div>
  );
}

export default function TableExpressionBar({
  whereExpression,
  appliedWhereExpression,
  orderByExpression,
  appliedOrderByExpression,
  busy,
  onWhereChange,
  onOrderByChange,
  onApplyWhere,
  onApplyOrderBy,
}: {
  whereExpression: string;
  appliedWhereExpression: string;
  orderByExpression: string;
  appliedOrderByExpression: string;
  busy: boolean;
  onWhereChange: (value: string) => void;
  onOrderByChange: (value: string) => void;
  onApplyWhere: (value: string) => void;
  onApplyOrderBy: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="tw:grid tw:shrink-0 tw:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] tw:border-b tw:border-border-subtle tw:bg-background tw:@max-[480px]:grid-cols-2"
      aria-label={t("tables.expressionBar")}
    >
      <ExpressionField
        kind="where"
        value={whereExpression}
        appliedValue={appliedWhereExpression}
        busy={busy}
        onChange={onWhereChange}
        onApply={onApplyWhere}
      />
      <ExpressionField
        kind="orderBy"
        value={orderByExpression}
        appliedValue={appliedOrderByExpression}
        busy={busy}
        onChange={onOrderByChange}
        onApply={onApplyOrderBy}
      />
    </div>
  );
}
