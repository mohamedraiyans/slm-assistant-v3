"""Speech recognition with word-level timestamps (faster-whisper on CTranslate2)."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from .align import HeardWord
from .clips import merge_speech, snap_to_speech
from .normalize import normalize_word

SAMPLE_RATE = 16_000
# A pause at least this long separates speech spans. Reciters pause between ayahs and
# to breathe inside long ones; shorter gaps are elongation or articulation.
MIN_PAUSE_MS = 400
# Upper bound for a decode clip, and for a single unbroken speech span. Whisper encodes
# 30 s windows; measured on Al-Fatiha, clips grouped up to 12-20 s matched best, while
# a single multi-ayah window dropped the opening basmala.
MAX_CLIP_SECONDS = 15


class AudioDecodeError(ValueError):
    """The bytes could not be decoded as audio (corrupt, truncated, or not audio)."""


@dataclass(frozen=True)
class Transcript:
    words: list[HeardWord]
    raw_text: str
    duration: float


class Transcriber:
    def __init__(self, model_dir: Path, beam_size: int = 5, cpu_threads: int = 0):
        # Imported here so the pure alignment code (and its tests) never needs the
        # native speech stack installed.
        from faster_whisper import WhisperModel

        self.provenance = json.loads((model_dir / "PROVENANCE.json").read_text("utf-8"))
        self.beam_size = beam_size
        self._model = WhisperModel(
            str(model_dir), device="cpu", compute_type="int8", cpu_threads=cpu_threads
        )
        # One recording at a time: decoding already uses every CPU thread, so running
        # two concurrently only makes both slower.
        self._lock = threading.Lock()

    def transcribe(
        self,
        source: Path | BinaryIO,
        beam_size: int | None = None,
        word_timestamps: bool = True,
    ) -> Transcript:
        """
        `source` is a file path, or an in-memory file for audio that is never stored.

        `word_timestamps=False` skips Whisper's extra alignment pass, which measured
        2.3-3x the cost of decoding itself on short clips. Words then carry their
        segment's time span instead of their own, which is fine when only the words
        and their order matter - as when checking a practice attempt.
        """
        from faster_whisper import decode_audio
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        try:
            audio = decode_audio(str(source) if isinstance(source, Path) else source, sampling_rate=SAMPLE_RATE)
        except Exception as error:  # PyAV raises a family of FFmpeg-specific errors
            raise AudioDecodeError(f"could not decode audio: {error}") from error
        duration = len(audio) / SAMPLE_RATE

        speech = [
            (span["start"] / SAMPLE_RATE, span["end"] / SAMPLE_RATE)
            for span in get_speech_timestamps(
                audio,
                VadOptions(
                    min_silence_duration_ms=MIN_PAUSE_MS,
                    speech_pad_ms=150,
                    max_speech_duration_s=MAX_CLIP_SECONDS,
                ),
            )
        ]
        if not speech:
            return Transcript(words=[], raw_text="", duration=duration)

        # Clips are decoded independently. faster-whisper's own vad_filter is not a
        # substitute: it rejoins speech into one stream before decoding, and measured
        # no better than no VAD at all.
        clips = [edge for clip in merge_speech(speech, MAX_CLIP_SECONDS) for edge in clip]

        with self._lock:
            segments, _ = self._model.transcribe(
                audio,
                language="ar",
                task="transcribe",
                beam_size=beam_size or self.beam_size,
                # Temperature 0 and no fallback sampling: identical input gives identical
                # timings, which ground-truth data and any evaluation of it depend on.
                # With fallback enabled, one word's result changed between runs.
                temperature=0.0,
                word_timestamps=word_timestamps,
                clip_timestamps=clips,
                # Recitation repeats phrases by design; conditioning on the previous
                # window invites Whisper's known repetition loops.
                condition_on_previous_text=False,
            )
            words: list[HeardWord] = []
            texts: list[str] = []
            for segment in segments:  # a generator: decoding happens while iterating
                texts.append(segment.text.strip())
                if not word_timestamps:
                    words.extend(
                        HeardWord(key=key, start=segment.start, end=segment.end)
                        for token in segment.text.split()
                        if (key := normalize_word(token))
                    )
                    continue
                for word in segment.words or []:
                    key = normalize_word(word.word)
                    if not key:
                        continue
                    start, end = snap_to_speech(word.start, word.end, speech)
                    words.append(HeardWord(key=key, start=start, end=end))
            return Transcript(words=words, raw_text=" ".join(texts), duration=duration)
