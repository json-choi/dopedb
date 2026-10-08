// Opens a provider's own documentation or console page in the system browser.
import { openUrl } from "@tauri-apps/plugin-opener";

import { Icon } from "../../../../components/Icon";
import { useToast } from "../../../../components/Toast";
import { Button } from "../../../../design-system/components/Button";
import { errMessage } from "../../../../ipc/types";

export default function ExternalGuideButton({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  const toast = useToast();
  return (
    <Button
      size="compact"
      variant="ghost"
      onClick={() => {
        void openUrl(href).catch((error: unknown) => toast(errMessage(error), "error"));
      }}
    >
      <Icon name="externalLink" />
      {children}
    </Button>
  );
}
