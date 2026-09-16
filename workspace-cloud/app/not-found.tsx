// A revoked publication, a mistyped invitation, and a handoff for another
// account all end here. The wording is the same for every one of them so the
// page never confirms that a record exists.
import { ControlLink } from "./components/Controls";
import { StatusPage } from "./components/StatusPage";
import { localizedWorkspacePath } from "../lib/workspace-locale";
import { getWorkspaceLocale } from "../lib/workspace-locale-server";
import { workspaceMessages } from "../lib/workspace-messages";

export const dynamic = "force-dynamic";

export default async function WorkspaceNotFound() {
  const locale = await getWorkspaceLocale();
  const copy = workspaceMessages[locale].notFound;
  return (
    <StatusPage
      title={copy.title}
      description={copy.description}
      actions={
        <ControlLink href={localizedWorkspacePath("/settings", locale)}>
          {copy.action}
        </ControlLink>
      }
    />
  );
}
