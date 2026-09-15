"use client";

import { useEffect, useState } from "react";
import type { FeatureKey, FeatureState } from "@slm/shared-types";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function FeatureManager({ onChanged }: { onChanged: (features: FeatureState[]) => void }) {
  const [features, setFeatures] = useState<FeatureState[]>([]);
  const [pending, setPending] = useState<FeatureKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${API_URL}/features`, { credentials: "include" });
      if (res.ok) setFeatures(await res.json());
    })();
  }, []);

  async function toggle(feature: FeatureState) {
    setPending(feature.key);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/features/${feature.key}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !feature.enabled }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const updated: FeatureState = await res.json();
      const next = features.map((f) => (f.key === updated.key ? updated : f));
      setFeatures(next);
      onChanged(next);
    } catch (err) {
      setError(`Couldn't update "${feature.label}": ${(err as Error).message}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Features</DialogTitle>
        <DialogDescription>
          Turn optional features on or off for everyone. A disabled feature is hidden in the app and its API is
          switched off too.
        </DialogDescription>
      </DialogHeader>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {features.map((feature) => (
          <li key={feature.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p id={`feature-${feature.key}`} className="text-sm font-medium">
                {feature.label}
              </p>
              <p className="text-xs text-muted-foreground">{feature.description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={feature.enabled}
              aria-labelledby={`feature-${feature.key}`}
              disabled={pending === feature.key}
              onClick={() => void toggle(feature)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors disabled:opacity-50 ${
                feature.enabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block size-4 rounded-full bg-foreground transition-transform ${
                  feature.enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}
