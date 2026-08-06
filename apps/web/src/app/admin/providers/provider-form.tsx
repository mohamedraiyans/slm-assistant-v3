"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ProviderName } from "@slm/shared-types";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const PROVIDERS: ProviderName[] = ["GROQ", "AZURE_OPENAI", "ANTHROPIC"];

export function ProviderForm() {
  const router = useRouter();
  const [provider, setProvider] = useState<ProviderName>("GROQ");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <select
        value={provider}
        onChange={(event) => setProvider(event.target.value as ProviderName)}
        className="rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-800"
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
        className="rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-800"
      />
      <input
        placeholder="API key"
        type="password"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        required
        className="rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-800"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : "Add key"}
      </Button>
    </form>
  );
}
