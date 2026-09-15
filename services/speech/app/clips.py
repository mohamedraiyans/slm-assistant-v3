"""Planning which audio spans to decode, and tidying word times against real speech.

Pure functions over (start, end) seconds, kept apart from the model so they can be
tested without audio.
"""

from __future__ import annotations

from typing import Sequence

Span = tuple[float, float]

# Overlap below this is VAD padding brushing a word, not the word's own speech.
MIN_OVERLAP_SECONDS = 0.15


def merge_speech(speech: Sequence[Span], max_clip_seconds: float) -> list[Span]:
    """
    Groups consecutive speech spans into decode clips no longer than `max_clip_seconds`.

    Each clip costs one full encoder pass (Whisper always encodes a 30 s window), so
    decoding every pause-separated span alone is slow; but one long multi-ayah window
    made this model drop words. Measured on Al-Fatiha: 5 separate spans matched 89.7%
    of words, the same audio grouped into 3 clips of <= 12-20 s matched 93.1%.
    """
    clips: list[list[float]] = []
    for start, end in speech:
        if clips and end - clips[-1][0] <= max_clip_seconds:
            clips[-1][1] = end
        else:
            clips.append([start, end])
    return [(start, end) for start, end in clips]


def snap_to_speech(start: float, end: float, speech: Sequence[Span]) -> Span:
    """
    Moves a word boundary that falls in silence onto the edge of the speech around it.

    Whisper's word timings absorb a preceding pause into the next word (measured:
    بسم reported at 2.73 s when voice activity resumes at 3.5 s), so playing a single
    word would start with dead air. A word is never moved outside its own span, and
    never collapsed: if no speech meaningfully overlaps it, it is returned unchanged.
    """
    # VAD pads each speech span, so a neighbouring span can graze a word by a few
    # hundredths of a second without the word being in it (the isti'adha's padding
    # overlapped بسم by 0.07 s). Such slivers must not count as the word's speech.
    min_overlap = min(MIN_OVERLAP_SECONDS, 0.5 * (end - start))
    overlapping = [
        (speech_start, speech_end)
        for speech_start, speech_end in speech
        if min(end, speech_end) - max(start, speech_start) >= min_overlap
    ]
    if not overlapping:
        return start, end
    new_start = max(start, overlapping[0][0])
    new_end = min(end, overlapping[-1][1])
    return (new_start, new_end) if new_start < new_end else (start, end)
