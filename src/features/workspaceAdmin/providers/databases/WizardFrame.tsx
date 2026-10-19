// Shared chrome of the inline add-database flows (and their review table): title with step counter, the step
// meter, the busy progress bar, the focused step question, the flow's error slot and a
// footer with Cancel on the left and the flow's own actions on the right. Each flow
// owns its steps, state and commands and passes localized text in.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "../../../../design-system/components/Button";
import { ProgressBar } from "../../../../design-system/components/Progress";
import { useI18n } from "../../../../lib/i18n";

export default function WizardFrame({
  title,
  description,
  stepsLabel,
  stepProgress,
  stepLabels,
  step,
  question,
  questionDescription,
  progressLabel,
  busy,
  error,
  actions,
  onCancel,
  children,
}: {
  title: string;
  description: string;
  stepsLabel: string;
  /** Localized "Step n of m" text. */
  stepProgress: string;
  stepLabels: readonly string[];
  /** One-based current step. */
  step: number;
  question: string;
  questionDescription: string;
  /** Present while a command runs: names it on the progress bar. */
  progressLabel: string | null;
  busy: boolean;
  error?: ReactNode;
  /** Back and the flow's single primary action. */
  actions: ReactNode;
  onCancel: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);

  // Each step announces itself; the first focus also brings the flow into view.
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy}
      data-primary-flow
      className="tw:grid tw:min-w-0 tw:rounded-sm tw:border tw:border-border-subtle"
    >
      <header className="tw:grid tw:min-w-0 tw:gap-3 tw:border-b tw:border-border-subtle tw:px-4 tw:py-3">
        <div className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3">
          <div className="tw:grid tw:min-w-0 tw:gap-0.5">
            <h4 id={titleId} className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground">
              {title}
            </h4>
            <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
              {description}
            </p>
          </div>
          <span className="tw:shrink-0 tw:text-xs tw:tabular-nums tw:text-muted-foreground">
            {stepProgress}
          </span>
        </div>
        <ol
          aria-label={stepsLabel}
          className="tw:m-0 tw:grid tw:list-none tw:grid-cols-3 tw:gap-2 tw:p-0"
        >
          {stepLabels.map((label, index) => {
            const state = index + 1 < step ? "done" : index + 1 === step ? "current" : "upcoming";
            return (
              <li
                key={label}
                data-state={state}
                aria-current={state === "current" ? "step" : undefined}
                className="tw:grid tw:min-w-0 tw:gap-1.5 tw:text-xs tw:text-muted-foreground tw:data-[state=current]:font-medium tw:data-[state=current]:text-foreground tw:data-[state=done]:text-foreground"
              >
                <span
                  aria-hidden="true"
                  data-state={state}
                  className="tw:h-0.5 tw:rounded-full tw:bg-border-subtle tw:data-[state=current]:bg-primary tw:data-[state=done]:bg-muted-foreground"
                />
                <span className="tw:truncate">{label}</span>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="tw:h-0.5">
        {progressLabel ? <ProgressBar value={null} density="compact" label={progressLabel} /> : null}
      </div>

      <div className="tw:grid tw:min-w-0 tw:content-start tw:gap-4 tw:p-4">
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          <h5
            ref={stepHeading}
            tabIndex={-1}
            className="tw:m-0 tw:text-ui tw:font-semibold tw:text-foreground tw:outline-none"
          >
            {question}
          </h5>
          <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
            {questionDescription}
          </p>
        </div>
        {children}
        {error}
      </div>

      <footer className="ds-control-row tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-border-subtle tw:px-4 tw:py-3">
        <Button size="compact" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">{actions}</div>
      </footer>
    </section>
  );
}

/** Two-column review table of what a flow is about to register. */
export function ReviewList({ children }: { children: ReactNode }) {
  return (
    <dl className="tw:m-0 tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,160px)_minmax(0,1fr)] tw:border-t tw:border-border-subtle tw:text-sm tw:@max-[520px]:grid-cols-1">
      {children}
    </dl>
  );
}

export function ReviewItem({
  term,
  monospace = false,
  children,
}: {
  term: string;
  monospace?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="tw:border-b tw:border-border-subtle tw:py-2 tw:pr-3 tw:text-muted-foreground tw:@max-[520px]:border-b-0 tw:@max-[520px]:pb-0">
        {term}
      </dt>
      <dd
        data-monospace={monospace}
        className="tw:m-0 tw:min-w-0 tw:border-b tw:border-border-subtle tw:py-2 tw:text-foreground tw:[overflow-wrap:anywhere] tw:data-[monospace=true]:font-mono"
      >
        {children}
      </dd>
    </>
  );
}
