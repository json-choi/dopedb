"use client";

import { useId } from "react";
import { DopeDBMarkGraphic } from "../../src/design-system/components/DopeDBMarkGraphic";

export function DopeDBMark({ className = "tw:size-7", size = 28 }: { className?: string; size?: number }) {
  const instanceId = useId();
  return (
    <DopeDBMarkGraphic instanceId={instanceId} className={className} size={size} />
  );
}
