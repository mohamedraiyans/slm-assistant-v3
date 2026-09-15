"use client";

import { useEffect } from "react";

const RETRY_MS = 3000;

/** Shown while the api is still starting; reloads until the server page can render normally. */
export function ApiUnavailable() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), RETRY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center font-sans">
      <h1 className="text-xl font-semibold tracking-tight">Waiting for the API…</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The backend is still starting up. This page will reload automatically as soon as it&apos;s ready.
      </p>
    </div>
  );
}
