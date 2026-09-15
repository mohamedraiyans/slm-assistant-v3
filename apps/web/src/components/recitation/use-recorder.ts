"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Speech louder than this RMS level (0-1) counts as the reciter speaking.
const SPEECH_LEVEL = 0.02;
// Silence this long after speech ends the recording: a pause between ayahs.
const PAUSE_TO_STOP_MS = 1500;
// Safety net if no speech is ever detected (muted mic, wrong input device).
const NO_SPEECH_TIMEOUT_MS = 10_000;

export type RecorderState = "idle" | "requesting" | "recording" | "denied" | "unsupported";

/**
 * Returned rather than read back from `state` afterwards: a caller awaiting `record()`
 * holds the `state` value from before the call, so it would never see "denied".
 */
export type RecordingOutcome =
  | { kind: "recorded"; blob: Blob }
  | { kind: "no-speech" }
  | { kind: "denied" }
  | { kind: "unsupported" };

/**
 * Records one ayah from the microphone and stops by itself when the reciter pauses.
 *
 * Levels are read from an AnalyserNode rather than trusting a fixed duration: an
 * ayah can take two seconds or two minutes, and a pause is the natural end marker.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [heardSpeech, setHeardSpeech] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const record = useCallback(async (): Promise<RecordingOutcome> => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return { kind: "unsupported" };
    }
    setState("requesting");
    setHeardSpeech(false);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      setState("denied");
      return { kind: "denied" };
    }

    const recorder = new MediaRecorder(stream);
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const chunks: Blob[] = [];

    return new Promise<RecordingOutcome>((resolve) => {
      let frame = 0;
      let spoke = false;
      let silentSince = performance.now();
      const startedAt = performance.now();

      let finished = false;
      // Runs from both a manual stop and the recorder's own onstop, so it must be
      // idempotent: closing an AudioContext twice rejects.
      const finish = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        cleanupRef.current = null;
      };
      cleanupRef.current = () => {
        if (recorder.state !== "inactive") recorder.stop();
        finish();
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        finish();
        setState("idle");
        resolve(
          spoke && chunks.length
            ? { kind: "recorded", blob: new Blob(chunks, { type: recorder.mimeType }) }
            : { kind: "no-speech" },
        );
      };

      const watch = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const level = Math.sqrt(sum / samples.length);
        const now = performance.now();

        if (level > SPEECH_LEVEL) {
          if (!spoke) setHeardSpeech(true);
          spoke = true;
          silentSince = now;
        }
        const paused = spoke && now - silentSince > PAUSE_TO_STOP_MS;
        const nothingSaid = !spoke && now - startedAt > NO_SPEECH_TIMEOUT_MS;
        if ((paused || nothingSaid) && recorder.state === "recording") {
          recorder.stop();
          return;
        }
        frame = requestAnimationFrame(watch);
      };

      recorder.start();
      setState("recording");
      frame = requestAnimationFrame(watch);
    });
  }, []);

  /** Ends the recording now, keeping what was captured. */
  const stop = useCallback(() => {
    cleanupRef.current?.();
  }, []);

  return { state, heardSpeech, record, stop };
}
