"""Loads the canonical Quran text (Tanzil, Simple edition) into matchable words."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .normalize import normalize_word

SURAH_COUNT = 114
_VERSE_LINE = re.compile(r"^(\d+)\|(\d+)\|(.+)$")


@dataclass(frozen=True)
class QuranWord:
    surah: int
    ayah: int
    position: int  # 1-based within the ayah, counting spoken words only
    text: str  # as written in the canonical text, with vowel marks
    key: str  # normalized form used for matching


class InvalidRangeError(ValueError):
    pass


class QuranText:
    def __init__(self, verses: dict[tuple[int, int], str]):
        self._verses = verses
        self._ayah_counts: dict[int, int] = {}
        for surah, ayah in verses:
            self._ayah_counts[surah] = max(self._ayah_counts.get(surah, 0), ayah)

    @classmethod
    def load(cls, path: Path) -> QuranText:
        verses: dict[tuple[int, int], str] = {}
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                match = _VERSE_LINE.match(line.rstrip("\r\n"))
                if match:  # skips the license block and blank lines
                    verses[(int(match[1]), int(match[2]))] = match[3]
        return cls(verses)

    @property
    def verse_count(self) -> int:
        return len(self._verses)

    def ayah_count(self, surah: int) -> int:
        if surah not in self._ayah_counts:
            raise InvalidRangeError(f"surah must be between 1 and {SURAH_COUNT}")
        return self._ayah_counts[surah]

    def words(
        self, surah: int, ayah_start: int | None = None, ayah_end: int | None = None
    ) -> list[QuranWord]:
        """Spoken words for a surah, or for an inclusive ayah range within it."""
        last = self.ayah_count(surah)
        if (ayah_start is None) != (ayah_end is None):
            raise InvalidRangeError("give both ayahStart and ayahEnd, or neither")
        start, end = (1, last) if ayah_start is None else (ayah_start, ayah_end)
        if not 1 <= start <= end <= last:
            raise InvalidRangeError(
                f"ayah range {start}-{end} is outside surah {surah}, which has {last} ayahs"
            )

        words: list[QuranWord] = []
        for ayah in range(start, end + 1):
            position = 0
            for token in self._verses[(surah, ayah)].split():
                key = normalize_word(token)
                # Pause marks appear as standalone tokens in the text; they are never
                # recited, so counting them would report every one as a missed word.
                if not key:
                    continue
                position += 1
                words.append(QuranWord(surah, ayah, position, token, key))
        return words
