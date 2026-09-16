// Canonical heading roles. A heading's document rank and its visual role are
// separate decisions: system.css gives each of h1/h2/h3 the role that normally
// matches its rank, and this primitive is how a screen selects a different role
// without re-deriving a size, weight and case combination of its own.
import type { ReactNode } from "react";

export type SectionTitleRole = "panel" | "section" | "group";

export function SectionTitle({
  level = 2,
  role = "panel",
  grow = false,
  truncate = false,
  id,
  children,
}: {
  level?: 1 | 2 | 3;
  role?: SectionTitleRole;
  grow?: boolean;
  truncate?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const Heading = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
  return (
    <Heading
      id={id}
      data-role={role}
      data-grow={grow || undefined}
      data-truncate={truncate || undefined}
      className="tw:m-0 tw:min-w-0 tw:text-title tw:leading-tight tw:font-semibold tw:tracking-[-0.01em] tw:text-foreground tw:normal-case tw:data-[grow=true]:flex-1 tw:data-[truncate=true]:truncate tw:data-[role=section]:text-sm tw:data-[role=section]:leading-ui tw:data-[role=section]:tracking-normal tw:data-[role=group]:text-xs tw:data-[role=group]:leading-ui tw:data-[role=group]:font-bold tw:data-[role=group]:tracking-[0.05em] tw:data-[role=group]:text-muted-foreground tw:data-[role=group]:uppercase"
    >
      {children}
    </Heading>
  );
}
