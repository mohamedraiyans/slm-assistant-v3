"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Span {
  startSec: number;
  endSec: number;
}

function waitFor(audio: HTMLAudioElement, event: string): Promise<void> {
  return new Promise((resolve) => audio.addEventListener(event, () => resolve(), { once: true }));
}

/**
 * Plays exact time slices of an <audio> element (one word, or a whole ayah) and
 * reports which of `spans` is currently audible.
 *
 * Playback is followed frame by frame: `timeupdate` fires only ~4 times a second,
 * which is too coarse to stop at the end of a word lasting a fraction of that.
 */
export function useClipPlayer(spans: readonly Span[] | null) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !spans) return;
    let frame = 0;

    const tick = () => {
      const time = audio.currentTime;
      if (stopAtRef.current !== null && time >= stopAtRef.current) {
        stopAtRef.current = null;
        audio.pause();
      }
      const index = spans.findIndex((span) => time >= span.startSec && time < span.endSec);
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
  }, [spans]);

  /** Plays from `startSec` and pauses at `endSec`; resolves once playback has started. */
  const playSpan = useCallback(async (startSec: number, endSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    // With preload="none" nothing is loaded before the first play, and browsers
    // silently ignore a seek made before metadata has arrived.
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      audio.preload = "auto";
      const loaded = waitFor(audio, "loadedmetadata");
      audio.load();
      await loaded;
    }
    stopAtRef.current = endSec;
    audio.currentTime = startSec;
    await audio.play().catch(() => undefined);
  }, []);

  /** Resolves when the current clip finishes (or immediately if nothing is playing). */
  const whenStopped = useCallback((): Promise<void> => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return Promise.resolve();
    return waitFor(audio, "pause");
  }, []);

  return { audioRef, activeIndex, playSpan, whenStopped };
}
