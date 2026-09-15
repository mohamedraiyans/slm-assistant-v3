"use client";

import { useEffect, useState } from "react";
import type {
  RecitationReferenceSummary,
  RecitationStatus,
  RecitationWordTiming,
} from "@slm/shared-types";
import { Button } from "@/components/ui/button";
import { useClipPlayer } from "./use-clip-player";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STATUS_STYLES: Record<RecitationStatus, { label: string; className: string }> = {
  PENDING: { label: "Queued for processing", className: "text-muted-foreground" },
  PROCESSING: { label: "Processing…", className: "text-amber-300" },
  READY: { label: "Ready", className: "text-emerald-400" },
  FAILED: { label: "Failed", className: "text-destructive" },
};

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function describeRange(ref: RecitationReferenceSummary): string {
  if (ref.ayahStart === null) return `Surah ${ref.surah} · whole surah`;
  return ref.ayahStart === ref.ayahEnd
    ? `Surah ${ref.surah} · ayah ${ref.ayahStart}`
    : `Surah ${ref.surah} · ayahs ${ref.ayahStart}–${ref.ayahEnd}`;
}

function wordClass(word: RecitationWordTiming, active: boolean): string {
  const base = "rounded px-1 transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-primary";
  if (active) return `${base} bg-primary text-primary-foreground hover:bg-primary`;
  if (word.match === "MISSING") return `${base} text-muted-foreground/60`;
  if (word.match === "SUBSTITUTED") return `${base} underline decoration-amber-400 decoration-dotted underline-offset-8`;
  return base;
}

function wordTitle(word: RecitationWordTiming): string {
  const span = `${word.startSec.toFixed(2)}–${word.endSec.toFixed(2)}s`;
  if (word.match === "MISSING") return `${span} · not recognised; timing estimated from neighbouring words`;
  if (word.match === "SUBSTITUTED") return `${span} · recognised as a different word; timing may be imprecise`;
  return span;
}

interface ReferenceCardProps {
  reference: RecitationReferenceSummary;
  isAdmin: boolean;
  onDelete: (reference: RecitationReferenceSummary) => void;
  onReprocess: (reference: RecitationReferenceSummary) => void;
  onPractice: (reference: RecitationReferenceSummary) => void;
}

export function ReferenceCard({ reference, isAdmin, onDelete, onReprocess, onPractice }: ReferenceCardProps) {
  const status = STATUS_STYLES[reference.status];
  const finished = reference.status === "READY" || reference.status === "FAILED";
  const [words, setWords] = useState<RecitationWordTiming[] | null>(null);
  const [showWords, setShowWords] = useState(false);
  const { audioRef, activeIndex, playSpan } = useClipPlayer(words);

  // Processed results can exist on a FAILED reference too (a low match rate keeps the
  // words for diagnosis), so this keys off processedAt rather than status.
  const hasWords = reference.processedAt !== null;

  useEffect(() => {
    if (!showWords || words !== null) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/recitation/references/${reference.id}/words`, { credentials: "include" });
      if (res.ok && !cancelled) setWords(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [showWords, words, reference.id]);

  // Reprocessing replaces the timings; drop the cached copy so it is fetched again.
  const [seenProcessedAt, setSeenProcessedAt] = useState(reference.processedAt);
  if (seenProcessedAt !== reference.processedAt) {
    setSeenProcessedAt(reference.processedAt);
    setWords(null);
  }

  const ayahs = new Map<number, { word: RecitationWordTiming; index: number }[]>();
  words?.forEach((word, index) => {
    const list = ayahs.get(word.ayah) ?? [];
    list.push({ word, index });
    ayahs.set(word.ayah, list);
  });

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{reference.title}</p>
          <p className="text-xs text-muted-foreground">
            {describeRange(reference)} · {formatSize(reference.sizeBytes)}
            {reference.durationSec !== null && ` · ${formatDuration(reference.durationSec)}`} · {reference.originalName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs ${status.className}`}>
            {status.label}
            {/* A reprocess keeps the previous run's score until it finishes; showing it
                beside "Processing…" would read as the score of the run in progress. */}
            {finished && reference.matchRate !== null && ` · ${Math.round(reference.matchRate * 100)}% of words matched`}
          </span>
          {reference.status === "READY" && (
            <Button size="sm" onClick={() => onPractice(reference)}>
              Practice
            </Button>
          )}
          {isAdmin && finished && (
            <Button variant="ghost" size="sm" onClick={() => onReprocess(reference)}>
              Reprocess
            </Button>
          )}
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(reference)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {reference.processingError && <p className="text-xs text-destructive">{reference.processingError}</p>}

      {/* preload="none": a page of whole-surah files shouldn't start downloading until played. */}
      <audio
        ref={audioRef}
        controls
        preload="none"
        src={`${API_URL}/recitation/references/${reference.id}/audio`}
        className="w-full"
      />

      {hasWords && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowWords((open) => !open)}
            aria-expanded={showWords}
            className="self-start text-xs text-primary hover:underline"
          >
            {showWords ? "Hide words" : "Show words (click one to hear it)"}
          </button>

          {showWords && words === null && <p className="text-xs text-muted-foreground">Loading words…</p>}

          {showWords && words !== null && (
            <div
              dir="rtl"
              lang="ar"
              className="rounded-lg border border-border bg-background/60 p-4 text-2xl leading-[2.4]"
            >
              {[...ayahs.entries()].map(([ayah, entries]) => (
                <span key={ayah}>
                  {entries.map(({ word, index }) => (
                    <button
                      key={`${word.ayah}:${word.position}`}
                      type="button"
                      onClick={() => void playSpan(word.startSec, word.endSec)}
                      title={wordTitle(word)}
                      className={wordClass(word, activeIndex === index)}
                    >
                      {word.text}
                    </button>
                  ))}
                  <span className="mx-1 text-lg text-primary" aria-label={`end of ayah ${ayah}`}>
                    ﴿{ayah.toLocaleString("ar-EG")}﴾
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
