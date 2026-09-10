import { useId } from "react";
import { DopeDBMarkGraphic } from "./DopeDBMarkGraphic";

export function DopeDBMark({ size = "default" }: { size?: "default" | "compact" }) {
  const instanceId = useId();
  return (
    <DopeDBMarkGraphic
      instanceId={instanceId}
      size={size === "compact" ? 20 : 24}
      className={size === "compact" ? "tw:size-5 tw:shrink-0" : "tw:size-6 tw:shrink-0"}
    />
  );
}
