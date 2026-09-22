"use client";

// Saves the exact connection's durable team-sharing policy and only reports
// confirmed server state. Unmounting discards responses from a previous scope.
import { useEffect, useRef, useState } from "react";
import { ControlButton } from "../../app/components/Controls";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";
import { localizedProviderMessage } from "../../lib/workspace-provider-copy";

export function TeamReadAccess({ workspaceId, connectionId, enabled, disabled,
  canManage, onBusyChange, onSaved }: {
  workspaceId: string;
  connectionId: string;
  enabled: boolean;
  disabled: boolean;
  canManage: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].connectionAccess;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function save() {
    if (disabled || saving || !canManage) return;
    setSaving(true);
    setError("");
    onBusyChange(true);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/connections/${connectionId}/grants`,
        { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ teamReadEnabled: !enabled }) },
      ).catch(() => null);
      const body = await response?.json().catch(() => null);
      if (!mounted.current) return;
      if (!response?.ok || body?.teamReadEnabled !== !enabled) {
        setError(typeof body?.error === "string"
          ? localizedProviderMessage(body.error, locale, copy.teamReadError)
          : copy.teamReadError);
        return;
      }
      await onSaved();
    } finally {
      if (mounted.current) { setSaving(false); onBusyChange(false); }
    }
  }

  return (
    <section className="tw:grid tw:gap-2 tw:border-y tw:border-border tw:py-3">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
        <strong className="tw:text-xs tw:text-foreground">
          {copy.teamReadTitle} · {enabled ? copy.teamReadEnabled : copy.teamReadDisabled}
        </strong>
        {canManage ? <ControlButton disabled={disabled || saving} onClick={() => void save()}>
          {saving ? copy.teamReadSaving : enabled ? copy.teamReadDisable : copy.teamReadEnable}
        </ControlButton> : null}
      </div>
      <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
        {copy.teamReadDescription} {enabled ? copy.teamReadDisableDescription : ""}
      </p>
      {error ? <small className="tw:text-xs tw:text-danger" role="alert">{error}</small> : null}
    </section>
  );
}
