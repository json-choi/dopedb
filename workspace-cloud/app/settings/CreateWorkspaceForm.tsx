"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ControlButton,
  ControlInput,
} from "../components/Controls";
import { workspaceMessages } from "../../lib/workspace-messages";
import { useWorkspaceLocale } from "../components/WorkspaceLocale";
import { localizedProviderMessage } from "../../lib/workspace-provider-copy";

export function CreateWorkspaceForm() {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].createWorkspace;
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/v1/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setPending(false);
    if (!response?.ok) {
      const body = await response?.json().catch(() => null);
      setError(
        typeof body?.error === "string"
          ? localizedProviderMessage(body.error, locale, copy.error)
          : copy.error,
      );
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <form
      className="tw:sticky tw:top-[126px] tw:grid tw:gap-4 tw:rounded-surface tw:border tw:border-border tw:bg-surface tw:p-5 tw:max-[900px]:static"
      onSubmit={submit}
    >
      <header className="tw:grid tw:gap-1">
        <h3 className="tw:m-0 tw:text-base tw:font-semibold tw:text-foreground">
          {copy.title}
        </h3>
        <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {copy.description}
        </p>
      </header>
      <label
        className="tw:font-mono tw:text-2xs tw:font-medium tw:tracking-[0.06em] tw:text-muted-foreground"
        htmlFor="workspace-name"
      >
        {copy.label}
      </label>
      <div className="tw:grid tw:gap-2">
        <ControlInput
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          placeholder={copy.placeholder}
          required
        />
        <ControlButton
          type="submit"
          tone="primary"
          size="field"
          disabled={pending}
        >
          {pending ? copy.creating : copy.create}
        </ControlButton>
      </div>
      {error ? (
        <small className="tw:text-2xs tw:text-danger">{error}</small>
      ) : null}
    </form>
  );
}
