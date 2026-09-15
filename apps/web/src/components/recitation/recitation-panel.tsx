"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RecitationReferenceSummary } from "@slm/shared-types";
import { Button } from "@/components/ui/button";
import { PracticeView } from "./practice-view";
import { ReferenceCard } from "./reference-card";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ACCEPTED_AUDIO = ".mp3,.aac,.wav,.flac,.ogg,.opus,.m4a,.webm,audio/*";
const POLL_MS = 3000;

/** Nest errors carry `message` as a string or, for validation, a string array. */
function errorMessage(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join(", ");
  if (typeof message === "string") return message;
  return status === 413 ? "File is too large (max 100 MB)" : `Upload failed (${status})`;
}

/**
 * XHR rather than fetch: a whole-surah recording can be tens of megabytes, and fetch
 * still can't report upload progress in browsers.
 */
function uploadWithProgress(form: FormData, onProgress: (percent: number) => void) {
  return new Promise<RecitationReferenceSummary>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/recitation/references`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.response as RecitationReferenceSummary)
        : reject(new Error(errorMessage(xhr.response, xhr.status)));
    xhr.onerror = () => reject(new Error("Network error — is the API running?"));
    xhr.send(form);
  });
}

export function RecitationPanel({ isAdmin }: { isAdmin: boolean }) {
  const [references, setReferences] = useState<RecitationReferenceSummary[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wholeSurah, setWholeSurah] = useState(true);
  const [practicing, setPracticing] = useState<RecitationReferenceSummary | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API_URL}/recitation/references`, { credentials: "include" });
    if (res.ok) setReferences(await res.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/recitation/references`, { credentials: "include" });
      if (res.ok && !cancelled) setReferences(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Processing happens in a background job, so poll while anything is unfinished and
  // stop as soon as nothing is, rather than polling forever.
  const hasUnfinished = references.some((ref) => ref.status === "PENDING" || ref.status === "PROCESSING");
  useEffect(() => {
    if (!hasUnfinished) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasUnfinished, load]);

  async function handleReprocess(ref: RecitationReferenceSummary) {
    setError(null);
    const res = await fetch(`${API_URL}/recitation/references/${ref.id}/reprocess`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) setError(`Couldn't reprocess "${ref.title}" (${res.status})`);
    await load();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (wholeSurah) {
      form.delete("ayahStart");
      form.delete("ayahEnd");
    }

    setError(null);
    setProgress(0);
    try {
      await uploadWithProgress(form, setProgress);
      formRef.current?.reset();
      setWholeSurah(true);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  async function handleDelete(ref: RecitationReferenceSummary) {
    if (!window.confirm(`Delete "${ref.title}"? The audio file is removed too.`)) return;
    const res = await fetch(`${API_URL}/recitation/references/${ref.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) setError(`Couldn't delete "${ref.title}" (${res.status})`);
    await load();
  }

  const uploading = progress !== null;
  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50";

  if (practicing) {
    return <PracticeView reference={practicing} onExit={() => setPracticing(null)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <section className="rounded-xl border border-border bg-card/60 p-5">
          <h2 className="text-base font-semibold">Add a reference recitation</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a correct recitation and say which surah it covers. It becomes the ground truth your own
            recitation is checked against, and its audio is what plays back when you make a mistake.
          </p>

          <form ref={formRef} onSubmit={handleSubmit} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              Audio file
              <input
                name="file"
                type="file"
                accept={ACCEPTED_AUDIO}
                required
                disabled={uploading}
                className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-foreground`}
              />
              <span className="text-xs text-muted-foreground">MP3, WAV, FLAC, OGG/Opus, M4A, AAC or WebM · up to 100 MB</span>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              Surah number
              <input name="surah" type="number" min={1} max={114} required disabled={uploading} className={inputClass} placeholder="1–114" />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              Title <span className="sr-only">(optional)</span>
              <input name="title" type="text" maxLength={120} disabled={uploading} className={inputClass} placeholder="Defaults to the filename" />
            </label>

            <fieldset className="flex flex-col gap-3 sm:col-span-2" disabled={uploading}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wholeSurah} onChange={(e) => setWholeSurah(e.target.checked)} className="accent-primary" />
                Covers the whole surah
              </label>
              {!wholeSurah && (
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1.5 text-sm">
                    From ayah
                    <input name="ayahStart" type="number" min={1} required className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    To ayah
                    <input name="ayahEnd" type="number" min={1} required className={inputClass} />
                  </label>
                </div>
              )}
            </fieldset>

            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={uploading}>
                {uploading ? `Uploading… ${progress}%` : "Upload"}
              </Button>
              {uploading && (
                <div className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          </form>

          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Reference recitations</h2>
          {references.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No recitations yet. Upload one above to get started.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {references.map((ref) => (
                <ReferenceCard
                  key={ref.id}
                  reference={ref}
                  isAdmin={isAdmin}
                  onDelete={(r) => void handleDelete(r)}
                  onReprocess={(r) => void handleReprocess(r)}
                  onPractice={setPracticing}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
