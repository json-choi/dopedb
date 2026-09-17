"use client";

import { createAuthClient } from "better-auth/react";
import {
  multiSessionClient,
  organizationClient,
} from "better-auth/client/plugins";
import { ac, workspaceRoles } from "./access";

export const authClient = createAuthClient({
  plugins: [
    multiSessionClient(),
    organizationClient({ ac, roles: workspaceRoles }),
  ],
});
