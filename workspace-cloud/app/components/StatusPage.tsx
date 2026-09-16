// Shared chrome for the product's terminal states: a shared link that no longer
// resolves here and a page that failed to render. Both keep the reader inside
// the product and neither reports whether the underlying record exists.
import type { ReactNode } from "react";
import { Brand } from "./Brand";

export function StatusPage({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <main
      className="tw:relative tw:z-[1] tw:grid tw:min-h-[100dvh] tw:grid-rows-[auto_minmax(0,1fr)]"
      id="main-content"
    >
      <div className="tw:mx-auto tw:flex tw:min-h-16 tw:w-full tw:max-w-[1120px] tw:items-center tw:px-[clamp(20px,4vw,48px)]">
        <Brand destination="marketing" />
      </div>
      <section className="tw:mx-auto tw:grid tw:w-full tw:max-w-[620px] tw:content-center tw:gap-4 tw:px-[clamp(20px,4vw,48px)] tw:pb-24">
        <h1 className="tw:m-0 tw:text-[clamp(28px,4vw,38px)] tw:leading-tight tw:font-semibold tw:tracking-[-0.035em] tw:text-balance">
          {title}
        </h1>
        <p className="tw:m-0 tw:text-sm tw:leading-body tw:text-muted-foreground">
          {description}
        </p>
        {actions ? (
          <div className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            {actions}
          </div>
        ) : null}
      </section>
    </main>
  );
}
