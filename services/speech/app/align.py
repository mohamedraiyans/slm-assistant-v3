"""Aligns what was heard against what should have been recited.

A global (Needleman-Wunsch) alignment of two word sequences, where substitution cost
comes from character-level similarity, so a near-miss spelling from the recognizer is
cheap and a genuinely different word is expensive. Recitation follows the text in
order, so the search is confined to a band around the diagonal: O(n * band) instead of
O(n * m), which is what makes a whole surah (thousands of words) practical.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Sequence

# A heard word at least this similar to the expected one counts as recited correctly
# (orthographic variation, e.g. a dagger alef written as a full alef).
FUZZY_THRESHOLD = 0.75
# Minimum band half-width in words; it also grows with length so long surahs with
# inserted phrases (an opening supplication, a repeated ayah) stay inside the band.
MIN_BAND = 40
BAND_FRACTION = 0.1

GAP_COST = 1.0
_INF = float("inf")

# Backpointer moves.
_DIAGONAL, _SKIP_EXPECTED, _SKIP_HEARD = 0, 1, 2


class Match(str, Enum):
    EXACT = "EXACT"
    FUZZY = "FUZZY"  # recited correctly, spelled differently by the recognizer
    SUBSTITUTED = "SUBSTITUTED"  # something else was heard in this word's place
    MISSING = "MISSING"  # nothing was heard for this word


@dataclass(frozen=True)
class HeardWord:
    key: str
    start: float
    end: float


@dataclass(frozen=True)
class AlignedWord:
    expected_index: int
    match: Match
    heard: HeardWord | None


@dataclass(frozen=True)
class Alignment:
    words: list[AlignedWord]  # exactly one per expected word, in order
    inserted: list[HeardWord]  # heard words with no expected counterpart


def similarity(a: str, b: str) -> float:
    """1 - normalized Levenshtein distance; 1.0 means identical."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    previous = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current = [i]
        for j, char_b in enumerate(b, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (char_a != char_b),
                )
            )
        previous = current
    return 1.0 - previous[-1] / max(len(a), len(b))


def band_half_width(expected_len: int, heard_len: int) -> int:
    return max(MIN_BAND, int(BAND_FRACTION * max(expected_len, heard_len)))


def align(
    expected: Sequence[str],
    heard: Sequence[HeardWord],
    band: int | None = None,
    skip_costs: Sequence[float] | None = None,
) -> Alignment:
    """
    `skip_costs` optionally overrides, per expected word, the cost of nothing being heard
    for it. A cost of 0 makes a word optional: matched if present, free to omit. That is
    how recitation openings (isti'adha, basmala) are modelled without being required.
    """
    n, m = len(expected), len(heard)
    if skip_costs is not None and len(skip_costs) != n:
        raise ValueError("skip_costs must have one entry per expected word")
    width = band_half_width(n, m) if band is None else band

    def window(i: int) -> tuple[int, int]:
        # The diagonal is scaled by m/n, so a length mismatch between the sequences
        # tilts the band rather than pushing the true path out of it.
        centre = round(i * m / n) if n else 0
        return max(0, centre - width), min(m, centre + width)

    windows = [window(i) for i in range(n + 1)]
    # The final cell must be reachable, and each row's window must overlap the
    # previous one's reach; widen the edges to guarantee a connected band.
    windows[0] = (0, windows[0][1])
    windows[n] = (windows[n][0], m)
    for i in range(1, n + 1):
        lo, hi = windows[i]
        prev_lo, prev_hi = windows[i - 1]
        windows[i] = (min(lo, prev_hi), max(hi, prev_lo))

    similarity_cache: dict[tuple[str, str], float] = {}

    def sim(a: str, b: str) -> float:
        pair = (a, b)
        if pair not in similarity_cache:
            similarity_cache[pair] = similarity(a, b)
        return similarity_cache[pair]

    costs: list[list[float]] = []
    moves: list[bytearray] = []
    for i in range(n + 1):
        lo, hi = windows[i]
        row_cost = [_INF] * (hi - lo + 1)
        row_move = bytearray(hi - lo + 1)
        prev_lo, prev_hi = windows[i - 1] if i else (0, -1)
        prev_cost = costs[i - 1] if i else None

        for j in range(lo, hi + 1):
            k = j - lo
            if i == 0:
                row_cost[k] = j * GAP_COST
                row_move[k] = _SKIP_HEARD
                continue

            best, move = _INF, _DIAGONAL
            if prev_cost is not None and prev_lo <= j - 1 <= prev_hi and j >= 1:
                diagonal = prev_cost[j - 1 - prev_lo] + (
                    1.0 - sim(expected[i - 1], heard[j - 1].key)
                )
                best, move = diagonal, _DIAGONAL
            if prev_cost is not None and prev_lo <= j <= prev_hi:
                skip = GAP_COST if skip_costs is None else skip_costs[i - 1]
                up = prev_cost[j - prev_lo] + skip
                if up < best:
                    best, move = up, _SKIP_EXPECTED
            if k >= 1:
                left = row_cost[k - 1] + GAP_COST
                if left < best:
                    best, move = left, _SKIP_HEARD
            row_cost[k], row_move[k] = best, move

        costs.append(row_cost)
        moves.append(row_move)

    words: list[AlignedWord] = []
    inserted: list[HeardWord] = []
    i, j = n, m
    while i > 0 or j > 0:
        lo = windows[i][0]
        move = moves[i][j - lo] if i > 0 else _SKIP_HEARD
        if move == _DIAGONAL:
            score = sim(expected[i - 1], heard[j - 1].key)
            kind = (
                Match.EXACT
                if score == 1.0
                else Match.FUZZY
                if score >= FUZZY_THRESHOLD
                else Match.SUBSTITUTED
            )
            words.append(AlignedWord(i - 1, kind, heard[j - 1]))
            i, j = i - 1, j - 1
        elif move == _SKIP_EXPECTED:
            words.append(AlignedWord(i - 1, Match.MISSING, None))
            i -= 1
        else:
            inserted.append(heard[j - 1])
            j -= 1

    words.reverse()
    inserted.reverse()
    return Alignment(words, inserted)
