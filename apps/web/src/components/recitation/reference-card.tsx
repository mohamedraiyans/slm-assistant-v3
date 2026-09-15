"use client";

import { useEffect, useRef, useState } from "react";
import type {
  RecitationReferenceSummary,
  RecitationStatus,
  RecitationWordTiming,
} from "@slm/shared-types";
import { Button } from "@/components/ui/button";

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

function waitFor(audio: HTMLAudioElement, event: string): Promise<void> {
  return new Promise((resolve) => audio.addEventListener(event, () => resolve(), { once: true }));
}

interface ReferenceCardProps {
  reference: RecitationReferenceSummary;
  isAdmin: boolean;
  onDelete: (reference: RecitationReferenceSummary) => void;
  onReprocess: (reference: RecitationReferenceSummary) => void;
}

export function ReferenceCard({ reference, isAdmin, onDelete, onReprocess }: ReferenceCardProps) {
  const status = STATUS_STYLES[reference.status];
  const audioRef = useRef<HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const [words, setWords] = useState<RecitationWordTiming[] | null>(null);
  const [showWords, setShowWords] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

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

  // Follows playback on a frame-by-frame basis: timeupdate fires only ~4 times a
  // second, which is too coarse to highlight words that last a fraction of that.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !words) return;
    let frame = 0;

    const tick = () => {
      const time = audio.currentTime;
      if (stopAtRef.current !== null && time >= stopAtRef.current) {
        stopAtRef.current = null;
        audio.pause();
      }
      const index = words.findIndex((w) => time >= w.startSec && time < w.endSec);
      setActiveIndex(index === -1 ? null : index);
      if (!audio.paused) frame = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      setActiveIndex(null);
    };

    audio.addEventListener("play", start);
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("play", start);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("ended", stop);
    };
  }, [words]);

  async function playWord(word: RecitationWordTiming) {
    const audio = audioRef.current;
    if (!audio) return;
    // preload="none" means nothing is loaded yet on first click; seeking before
    // metadata arrives is silently ignored by browsers.
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      audio.preload = "auto";
      const loaded = waitFor(audio, "loadedmetadata");
      audio.load();
      await loaded;
    }
    stopAtRef.current = word.endSec;
    audio.currentTime = word.startSec;
    await audio.play().catch(() => undefined);
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
            {reference.matchRate !== null && ` · ${Math.round(reference.matchRate * 100)}% of words matched`}
          </span>
          {isAdmin && (reference.status === "READY" || reference.status === "FAILED") && (
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
                      onClick={() => void playWord(word)}
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
