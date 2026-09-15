"""Checks one recited ayah against its canonical words."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from .align import HeardWord, Match
from .quran import QuranWord
from .reference import align_recitation


@dataclass(frozen=True)
class CheckedWord:
    word: QuranWord
    match: Match
    heard: str | None


@dataclass(frozen=True)
class AttemptResult:
    words: list[CheckedWord]  # one per expected word, in order
    extra_words: list[str]  # heard but not part of the ayah (e.g. a repeated word)


def check_attempt(expected: list[QuranWord], heard: Sequence[HeardWord]) -> AttemptResult:
    """
    Aligns a recitation attempt to the ayah it should be. Someone practising often
    opens with the isti'adha or basmala; the shared preamble handling keeps those from
    counting as extra words or being mistaken for the ayah's own words.
    """
    alignment = align_recitation(expected, heard)
    return AttemptResult(
        words=[
            CheckedWord(
                word=expected[w.expected_index],
                match=w.match,
                heard=w.heard.key if w.heard else None,
            )
            for w in alignment.words
        ],
        extra_words=[w.key for w in alignment.inserted],
    )
