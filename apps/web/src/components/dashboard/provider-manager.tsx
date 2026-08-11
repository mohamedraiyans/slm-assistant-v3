"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ProviderCredentialPublic, ProviderName } from "@slm/shared-types";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const PROVIDERS: ProviderName[] = ["GROQ", "AZURE_OPENAI", "ANTHROPIC"];

export function ProviderManager() {
  const [credentials, setCredentials] = useState<ProviderCredentialPublic[]>([]);
  const [provider, setProvider] = useState<ProviderName>("GROQ");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCredentials() {
    const res = await fetch(`${API_URL}/providers`, { credentials: "include" });
    if (res.ok) setCredentials(await res.json());
  }

  useEffect(() => {
    loadCredentials();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch(`${API_URL}/providers`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, label, value }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError("Could not save this key. Check the fields and try again.");
      return;
    }
    setLabel("");
    setValue("");
    loadCredentials();
  }

  async function handleDelete(id: string) {
    await fetch(`${API_URL}/providers/${id}`, { method: "DELETE", credentials: "include" });
    loadCredentials();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Provider keys</DialogTitle>
        <DialogDescription>
          Add API keys for the LLM providers your team can chat with.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value as ProviderName)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        >
          {PROVIDERS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          placeholder="Label (e.g. production)"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          required
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        />
        <input
          placeholder="API key"
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
          className="rounded-md border border-border bg-transparent px-2 py-1.5 text-sm"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Add key"}
        </Button>
      </form>

      <ul className="flex flex-col gap-2">
        {credentials.length === 0 && (
          <li className="text-sm text-muted-foreground">No provider keys added yet.</li>
        )}
        {credentials.map((credential) => (
          <li
            key={credential.id}
            className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
          >
            <span>
              <span className="font-medium">{credential.provider}</span> — {credential.label}
            </span>
            <div className="flex items-center gap-3">
              <span className={credential.isActive ? "text-green-400" : "text-muted-foreground"}>
                {credential.isActive ? "active" : "inactive"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void handleDelete(credential.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
