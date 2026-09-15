"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PracticeAttemptResult,
  PracticeWordResult,
  RecitationReferenceSummary,
  RecitationWordTiming,
} from "@slm/shared-types";
import { Button } from "@/components/ui/button";
import { useClipPlayer } from "./use-clip-player";
import { useRecorder } from "./use-recorder";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
// If a check takes longer than this, the service is probably busy with an upload.
const SLOW_CHECK_MS = 12_000;

type Phase = "ready" | "recording" | "checking" | "result";

function extensionFor(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
  return typeof message === "string" ? message : `Check failed (${res.status})`;
}

function verdictClass(word: PracticeWordResult, active: boolean): string {
  const base = "rounded px-1 transition-colors";
  if (active) return `${base} bg-primary text-primary-foreground`;
  if (word.verdict === "MISTAKE")
    return `${base} bg-destructive/15 text-destructive underline decoration-2 underline-offset-8 hover:bg-destructive/25`;
  if (word.verdict === "UNCHECKED") return `${base} text-muted-foreground`;
  return `${base} text-emerald-300`;
}

function verdictTitle(word: PracticeWordResult): string {
  if (word.verdict === "MISTAKE") return "Not recited correctly - click to hear it";
  if (word.verdict === "UNCHECKED")
    return "Not checked: the recognizer also struggles with this word in the reference recording";
  return "Recited correctly - click to hear it";
}

interface PracticeViewProps {
  reference: RecitationReferenceSummary;
  onExit: () => void;
}

export function PracticeView({ reference, onExit }: PracticeViewProps) {
  const [words, setWords] = useState<RecitationWordTiming[] | null>(null);
  const [index, setIndex] = useState(0);
  const [showText, setShowText] = useState(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<PracticeAttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [completed, setCompleted] = useState(false);
  const recorder = useRecorder();
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${API_URL}/recitation/references/${reference.id}/words`, { credentials: "include" });
      if (res.ok && !cancelled) setWords(await res.json());
    })();
    return () => {
      cancelled = true;
    };
  }, [reference.id]);

  const ayahs = useMemo(() => [...new Set((words ?? []).map((w) => w.ayah))], [words]);
  const ayah = ayahs[index];
  const ayahWords = useMemo(() => (words ?? []).filter((w) => w.ayah === ayah), [words, ayah]);
  // Spans drive both word playback and the "now playing" highlight.
  const spans = result?.words ?? ayahWords;
  const { audioRef, activeIndex, playSpan, whenStopped } = useClipPlayer(spans.length ? spans : null);

  async function playWholeAyah() {
    if (!ayahWords.length) return;
    await playSpan(ayahWords[0].startSec, ayahWords[ayahWords.length - 1].endSec);
  }

  async function recordAttempt() {
    setError(null);
    setResult(null);
    setPhase("recording");
    const outcome = await recorder.record();
    if (outcome.kind !== "recorded") {
      setPhase("ready");
      // denied/unsupported have their own messages, driven by recorder.state.
      if (outcome.kind === "no-speech") {
        setError("No recitation was heard. Check that the right microphone is selected and try again.");
      }
      return;
    }
    const blob = outcome.blob;

    setPhase("checking");
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_CHECK_MS);
    try {
      const form = new FormData();
      form.append("audio", blob, `attempt.${extensionFor(blob.type)}`);
      form.append("ayah", String(ayah));
      const res = await fetch(`${API_URL}/recitation/references/${reference.id}/attempts`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error(await readError(res));
      const checked = (await res.json()) as PracticeAttemptResult;
      setResult(checked);
      setPhase("result");

      if (checked.passed) {
        requestAnimationFrame(() => nextButtonRef.current?.focus());
      } else {
        // Stop and correct: play the first mistake in the reciter's own voice.
        const first = checked.words.find((w) => w.verdict === "MISTAKE");
        if (first) {
          await whenStopped();
          await playSpan(first.startSec, first.endSec);
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase("ready");
    } finally {
      clearTimeout(slowTimer);
    }
  }

  function goToNextAyah() {
    setResult(null);
    setError(null);
    setPhase("ready");
    if (index + 1 < ayahs.length) setIndex(index + 1);
    else setCompleted(true);
  }

  function tryAgain() {
    setResult(null);
    setError(null);
    setPhase("ready");
  }

  const mistakes = result?.words.filter((w) => w.verdict === "MISTAKE") ?? [];
  const busy = phase === "recording" || phase === "checking";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Practice</p>
            <h2 className="text-lg font-semibold">{reference.title}</h2>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showText}
                onChange={(e) => setShowText(e.target.checked)}
                className="accent-primary"
              />
              Show text
            </label>
            <Button variant="outline" size="sm" onClick={onExit} disabled={busy}>
              Back to recitations
            </Button>
          </div>
        </div>

        {/* Hidden: used only to play reference clips. */}
        <audio ref={audioRef} preload="none" src={`${API_URL}/recitation/references/${reference.id}/audio`} />

        {words === null && <p className="text-sm text-muted-foreground">Loading…</p>}

        {completed && (
          <section className="flex flex-col items-center gap-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-6 py-10 text-center">
            <p className="text-lg font-semibold text-emerald-300">Surah complete</p>
            <p className="text-sm text-muted-foreground">You recited every ayah of this recording.</p>
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  setCompleted(false);
                  setIndex(0);
                }}
              >
                Start again
              </Button>
              <Button variant="outline" onClick={onExit}>
                Back to recitations
              </Button>
            </div>
          </section>
        )}

        {words !== null && ayah !== undefined && !completed && (
          <section className="flex flex-col gap-5 rounded-xl border border-border bg-card/60 p-5">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Ayah {ayah} · {index + 1} of {ayahs.length}
              </span>
              <span>{ayahWords.length} words</span>
            </div>

            <div
              dir="rtl"
              lang="ar"
              className="min-h-24 rounded-lg border border-border bg-background/60 p-4 text-2xl leading-[2.4]"
              aria-live="polite"
            >
              {result
                ? result.words.map((word, i) => (
                    <button
                      key={word.position}
                      type="button"
                      onClick={() => void playSpan(word.startSec, word.endSec)}
                      title={verdictTitle(word)}
                      className={verdictClass(word, activeIndex === i)}
                    >
                      {word.text}
                    </button>
                  ))
                : ayahWords.map((word, i) =>
                    showText ? (
                      <span
                        key={word.position}
                        className={`rounded px-1 ${activeIndex === i ? "bg-primary text-primary-foreground" : ""}`}
                      >
                        {word.text}
                      </span>
                    ) : (
                      <span key={word.position} className="px-2 text-muted-foreground" aria-hidden>
                        •
                      </span>
                    ),
                  )}
              {!showText && !result && <span className="sr-only">Text hidden for memorization</span>}
            </div>

            {result && (
              <div
                role="status"
                className={`rounded-lg px-4 py-3 text-sm ${
                  result.passed ? "bg-emerald-500/10 text-emerald-300" : "bg-destructive/10 text-destructive"
                }`}
              >
                {result.passed
                  ? "Correct. Well done."
                  : `${mistakes.length} word${mistakes.length === 1 ? "" : "s"} to correct. Listen to the highlighted word${mistakes.length === 1 ? "" : "s"}, then try again.`}
                {result.extraWords.length > 0 && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Also heard, not part of this ayah: {result.extraWords.join(" · ")}
                  </span>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {recorder.state === "denied" && (
              <p role="alert" className="text-sm text-destructive">
                Microphone access was blocked. Allow it in the browser&apos;s address bar, then try again.
              </p>
            )}
            {recorder.state === "unsupported" && (
              <p role="alert" className="text-sm text-destructive">This browser can&apos;t record audio.</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {phase === "ready" && (
                <Button onClick={() => void recordAttempt()}>Record ayah {ayah}</Button>
              )}
              {phase === "recording" && (
                <>
                  <Button variant="outline" onClick={recorder.stop}>
                    Stop
                  </Button>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
                    {recorder.state === "requesting"
                      ? "Waiting for microphone…"
                      : recorder.heardSpeech
                        ? "Listening… pause when you finish the ayah"
                        : "Listening… start reciting"}
                  </span>
                </>
              )}
              {phase === "checking" && (
                <span className="text-sm text-muted-foreground">
                  {slow
                    ? "Still checking… the speech service may be busy processing an upload."
                    : "Checking your recitation…"}
                </span>
              )}
              {phase === "result" && result && !result.passed && (
                <>
                  <Button onClick={tryAgain}>Try again</Button>
                  <Button variant="outline" onClick={() => void playWholeAyah()}>
                    Hear the whole ayah
                  </Button>
                </>
              )}
              {phase === "result" && result?.passed && (
                <>
                  <Button ref={nextButtonRef} onClick={goToNextAyah}>
                    {index + 1 < ayahs.length ? "Next ayah" : "Finish"}
                  </Button>
                  <Button variant="outline" onClick={tryAgain}>
                    Recite again
                  </Button>
                </>
              )}
              {phase === "ready" && (
                <Button variant="ghost" onClick={() => void playWholeAyah()}>
                  Hear this ayah first
                </Button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
