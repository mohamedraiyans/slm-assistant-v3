"""Turns a transcript of a reference recitation into timed canonical words."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from .align import AlignedWord, Alignment, HeardWord, Match, align
from .normalize import normalize_word
from .quran import QuranWord

# Recited before the text but not part of it. Written out and normalized here rather
# than as match keys, so they go through exactly the same normalization as the text.
ISTIADHA = "أعوذ بالله من الشيطان الرجيم"
BASMALA = "بسم الله الرحمن الرحيم"
AT_TAWBAH = 9  # the one surah recited without a basmala


@dataclass(frozen=True)
class TimedWord:
    word: QuranWord
    match: Match
    start: float
    end: float
    heard: str | None
    estimated: bool  # timing interpolated from neighbours, not observed


@dataclass(frozen=True)
class ReferenceTiming:
    words: list[TimedWord]
    inserted_count: int
    match_rate: float  # share of expected words recited correctly (exact or fuzzy)


def opening_preamble(expected: list[QuranWord]) -> list[str]:
    """
    Match keys of what a reciter may say before the first expected word.

    These have to be modelled, not just tolerated as insertions: الرجيم (isti'adha)
    and الرحيم (basmala) differ by a single letter, so an unmodelled isti'adha can be
    aligned onto the basmala and hand its words wrong timings.
    """
    keys = [normalize_word(token) for token in ISTIADHA.split()]
    if not expected:
        return keys
    first = expected[0]
    starts_with_text_basmala = first.surah == 1 and first.ayah == 1
    if first.surah != AT_TAWBAH and not starts_with_text_basmala:
        keys += [normalize_word(token) for token in BASMALA.split()]
    return keys


def time_reference(
    expected: list[QuranWord], alignment: Alignment, duration: float
) -> ReferenceTiming:
    observed: list[tuple[float, float] | None] = [
        (w.heard.start, w.heard.end) if w.heard else None for w in alignment.words
    ]

    # A word the recognizer missed still needs a playable span: give it the gap
    # between the nearest observed neighbours.
    spans: list[tuple[float, float, bool]] = []
    for index, span in enumerate(observed):
        if span is not None:
            spans.append((span[0], span[1], False))
            continue
        before = next((observed[k] for k in range(index - 1, -1, -1) if observed[k]), None)
        after = next((observed[k] for k in range(index + 1, len(observed)) if observed[k]), None)
        start = before[1] if before else 0.0
        end = after[0] if after else duration
        spans.append((start, max(start, end), True))

    words = [
        TimedWord(
            word=expected[aligned.expected_index],
            match=aligned.match,
            start=round(start, 3),
            end=round(end, 3),
            heard=aligned.heard.key if aligned.heard else None,
            estimated=estimated,
        )
        for aligned, (start, end, estimated) in zip(alignment.words, spans)
    ]
    correct = sum(1 for w in words if w.match in (Match.EXACT, Match.FUZZY))
    return ReferenceTiming(
        words=words,
        inserted_count=len(alignment.inserted),
        match_rate=round(correct / len(words), 4) if words else 0.0,
    )


def align_recitation(expected: list[QuranWord], heard: Sequence[HeardWord]) -> Alignment:
    """
    Aligns heard words to canonical ones, letting an opening isti'adha/basmala be
    recited without counting as extra words. The result has exactly one entry per
    canonical word, indexed into `expected`; preamble entries are dropped.
    """
    preamble = opening_preamble(expected)
    keys = preamble + [w.key for w in expected]
    optional = [True] * len(preamble) + [False] * len(expected)
    full = align(keys, heard, optional=optional)

    offset = len(preamble)
    return Alignment(
        words=[
            AlignedWord(w.expected_index - offset, w.match, w.heard)
            for w in full.words
            if w.expected_index >= offset
        ],
        inserted=full.inserted,
    )


def build_reference_timing(
    expected: list[QuranWord], heard: Sequence[HeardWord], duration: float
) -> ReferenceTiming:
    return time_reference(expected, align_recitation(expected, heard), duration)
