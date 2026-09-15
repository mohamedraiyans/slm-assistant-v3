"""Measures whether live recitation checking can keep up on the current machine.

Replays a reference recording as if it were arriving from a microphone in real time,
runs a streaming recognition loop over it, and reports - per word - how long after the
word was spoken it was confirmed. Ground-truth word end times come from the phase-2
alignment of the same recording, which is what makes per-word latency measurable.

The clock is simulated but honest: audio "arrives" at 1x speed, and every decode and
VAD pass advances the clock by its real measured duration, so a configuration that is
too slow falls visibly behind instead of looking fine.

Streaming policy (the standard approach for Whisper, which has no native streaming):
  - every STEP seconds, re-decode the current utterance buffer
  - confirm words once two consecutive hypotheses agree on them (LocalAgreement-2)
  - when voice activity shows the reciter paused, finalize the utterance and start
    a fresh buffer; recitation pauses between ayahs, so buffers stay short

Usage (inside the speech container):
  python -m benchmarks.live_latency /tmp/reference.json --beam 1 --step 1.0
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel, decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps

from app.align import HeardWord, Match
from app.normalize import normalize_word
from app.quran import QuranText
from app.reference import build_reference_timing

SAMPLE_RATE = 16_000
PAUSE_SECONDS = 0.4  # silence after speech that ends an utterance
MAX_BUFFER_SECONDS = 15.0  # force-finalize an utterance with no pause


@dataclass
class Session:
    committed: list[str] = field(default_factory=list)  # confirmed word keys, in order
    commit_times: list[float] = field(default_factory=list)  # clock time of each confirmation
    buffer_start: float = 0.0  # audio time where the current utterance buffer begins
    in_buffer_committed: int = 0  # how many of the buffer's hypothesis words are confirmed
    previous: list[str] = field(default_factory=list)  # last hypothesis for this buffer

    def commit(self, words: list[str], clock: float) -> None:
        self.committed.extend(words)
        self.commit_times.extend([clock] * len(words))


def decode(model: WhisperModel, audio: np.ndarray, beam: int) -> list[str]:
    segments, _ = model.transcribe(
        audio,
        language="ar",
        beam_size=beam,
        temperature=0.0,
        condition_on_previous_text=False,
        without_timestamps=True,  # checking needs words in order, not their timings
        vad_filter=False,
    )
    return [key for s in segments for token in s.text.split() if (key := normalize_word(token))]


def common_prefix(a: list[str], b: list[str]) -> int:
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return n


def run(reference: dict, beam: int, step: float, threads: int) -> dict:
    model = WhisperModel("/models/whisper-base-ar-quran", device="cpu", compute_type="int8", cpu_threads=threads)
    audio = decode_audio(f"/data/recitations/{reference['storedName']}", sampling_rate=SAMPLE_RATE)
    duration = len(audio) / SAMPLE_RATE
    model.transcribe(audio[: SAMPLE_RATE * 3], language="ar", beam_size=1)  # warm-up, not timed

    session = Session()
    clock = 0.0
    decode_times: list[float] = []
    max_lag = 0.0
    finished = False

    while not finished:
        available = min(clock, duration)
        buffer = audio[int(session.buffer_start * SAMPLE_RATE) : int(available * SAMPLE_RATE)]

        # Was the utterance ended by a pause (or the recording ending)?
        started = time.perf_counter()
        # Small padding: the default 400 ms pad would require ~800 ms of real silence
        # before a 400 ms pause registers, delaying every utterance boundary.
        speech = get_speech_timestamps(
            buffer, VadOptions(min_silence_duration_ms=int(PAUSE_SECONDS * 1000), speech_pad_ms=100)
        )
        clock += time.perf_counter() - started
        paused = bool(speech) and (len(buffer) - speech[-1]["end"]) / SAMPLE_RATE >= PAUSE_SECONDS
        at_end = available >= duration
        too_long = len(buffer) / SAMPLE_RATE >= MAX_BUFFER_SECONDS
        finalize = (paused or at_end or too_long) and bool(speech)

        if speech:
            started = time.perf_counter()
            hypothesis = decode(model, buffer, beam)
            elapsed = time.perf_counter() - started
            decode_times.append(elapsed)
            clock += elapsed
            max_lag = max(max_lag, clock - available)

            if finalize:
                session.commit(hypothesis[session.in_buffer_committed :], clock)
            else:
                agreed = common_prefix(hypothesis, session.previous)
                if agreed > session.in_buffer_committed:
                    session.commit(hypothesis[session.in_buffer_committed : agreed], clock)
                    session.in_buffer_committed = agreed
                session.previous = hypothesis

        if finalize or (not speech and len(buffer) / SAMPLE_RATE > PAUSE_SECONDS):
            # Start the next utterance after the detected speech (or skip pure silence).
            end = speech[-1]["end"] / SAMPLE_RATE if speech else len(buffer) / SAMPLE_RATE
            session.buffer_start += end
            session.in_buffer_committed = 0
            session.previous = []

        if at_end and (finalize or not speech):
            finished = True
        else:
            # Wait for the next step's audio unless decoding already overran it.
            clock = max(clock, available + step)

    # Map confirmed words onto the canonical text to measure accuracy and latency.
    quran = QuranText.load(Path("/srv/data/quran-simple.txt"))
    expected = quran.words(reference["surah"])
    heard = [HeardWord(key, t, t) for key, t in zip(session.committed, session.commit_times)]
    timing = build_reference_timing(expected, heard, duration)

    truth = {(w["ayah"], w["position"]): w for w in reference["words"]}
    latencies, per_word = [], []
    for word in timing.words:
        spoken = truth[(word.word.ayah, word.word.position)]
        confirmed = word.match in (Match.EXACT, Match.FUZZY) and not word.estimated
        # heard.start holds the confirmation clock time for committed words.
        latency = word.start - spoken["end"] if confirmed else None
        if latency is not None:
            latencies.append(latency)
        per_word.append((word.word.ayah, word.word.position, word.match.value, None if latency is None else round(latency, 2)))

    return {
        "beam": beam,
        "step": step,
        "threads": threads,
        "duration": round(duration, 2),
        "matchRate": timing.match_rate,
        "decodes": len(decode_times),
        "meanDecodeSec": round(statistics.mean(decode_times), 3) if decode_times else None,
        "maxLagSec": round(max_lag, 2),
        "latencyMedianSec": round(statistics.median(latencies), 2) if latencies else None,
        "latencyP90Sec": round(sorted(latencies)[int(0.9 * (len(latencies) - 1))], 2) if latencies else None,
        "latencyMaxSec": round(max(latencies), 2) if latencies else None,
        "words": per_word,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path, help="JSON with storedName, surah and ground-truth words")
    parser.add_argument("--beam", type=int, default=1)
    parser.add_argument("--step", type=float, default=1.0)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    result = run(json.loads(args.reference.read_text("utf-8")), args.beam, args.step, args.threads)
    words = result.pop("words")
    print(json.dumps(result))
    print("per word (ayah, position, match, latency s):", words)
