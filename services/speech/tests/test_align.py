import random

import pytest

from app.align import (
    FUZZY_THRESHOLD,
    GAP_COST,
    Alignment,
    HeardWord,
    Match,
    align,
    similarity,
)


def heard(*keys: str) -> list[HeardWord]:
    """Heard words one second apart, so each word's timing identifies it."""
    return [HeardWord(key=k, start=float(i), end=i + 0.9) for i, k in enumerate(keys)]


def matches(result: Alignment) -> list[Match]:
    return [w.match for w in result.words]


def alignment_cost(expected: list[str], result: Alignment) -> float:
    cost = GAP_COST * len(result.inserted)
    for word in result.words:
        cost += GAP_COST if word.heard is None else 1 - similarity(expected[word.expected_index], word.heard.key)
    return cost


def optimal_cost(expected: list[str], heard_words: list[HeardWord]) -> float:
    """Unbanded O(n*m) edit distance: the oracle the banded search must agree with."""
    n, m = len(expected), len(heard_words)
    table = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        table[i][0] = i * GAP_COST
    for j in range(m + 1):
        table[0][j] = j * GAP_COST
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            table[i][j] = min(
                table[i - 1][j - 1] + 1 - similarity(expected[i - 1], heard_words[j - 1].key),
                table[i - 1][j] + GAP_COST,
                table[i][j - 1] + GAP_COST,
            )
    return table[n][m]


class TestSimilarity:
    def test_identical(self):
        assert similarity("الرحمن", "الرحمن") == 1.0

    def test_one_letter_off_in_a_long_word_stays_above_the_fuzzy_threshold(self):
        # الرحمان (full alef) vs الرحمن: a spelling variant, not a different word.
        assert similarity("الرحمان", "الرحمن") >= FUZZY_THRESHOLD

    def test_different_words_fall_below_the_fuzzy_threshold(self):
        assert similarity("الرحيم", "العالمين") < FUZZY_THRESHOLD

    def test_empty(self):
        assert similarity("", "الله") == 0.0

    def test_symmetric(self):
        assert similarity("مالك", "ملك") == similarity("ملك", "مالك")


class TestMistakes:
    EXPECTED = ["بسم", "الله", "الرحمن", "الرحيم"]

    def test_perfect_recitation(self):
        result = align(self.EXPECTED, heard(*self.EXPECTED))
        assert matches(result) == [Match.EXACT] * 4
        assert result.inserted == []

    def test_missed_word_is_reported_and_neighbours_keep_their_own_timing(self):
        result = align(self.EXPECTED, heard("بسم", "الله", "الرحيم"))
        assert matches(result) == [Match.EXACT, Match.EXACT, Match.MISSING, Match.EXACT]
        assert result.words[3].heard.start == 2.0  # الرحيم keeps its real timing

    def test_wrong_word_is_a_substitution_not_a_miss_plus_an_extra(self):
        result = align(self.EXPECTED, heard("بسم", "الله", "العالمين", "الرحيم"))
        assert matches(result)[2] == Match.SUBSTITUTED
        assert result.words[2].heard.key == "العالمين"
        assert result.inserted == []

    def test_extra_word_is_an_insertion(self):
        result = align(self.EXPECTED, heard("بسم", "الله", "الله", "الرحمن", "الرحيم"))
        assert matches(result) == [Match.EXACT] * 4
        assert [w.key for w in result.inserted] == ["الله"]

    def test_opening_supplication_before_the_text_is_inserted_not_misaligned(self):
        # Reciters often begin with أعوذ بالله من الشيطان الرجيم, which isn't in the text.
        result = align(self.EXPECTED, heard("اعوذ", "بالله", "من", "الشيطان", "الرجيم", *self.EXPECTED))
        assert matches(result) == [Match.EXACT] * 4
        assert len(result.inserted) == 5

    def test_spelling_variant_counts_as_recited(self):
        result = align(self.EXPECTED, heard("بسم", "الله", "الرحمان", "الرحيم"))
        assert matches(result)[2] == Match.FUZZY

    def test_one_result_per_expected_word_in_order(self):
        result = align(self.EXPECTED, heard("الله", "xyz"))
        assert [w.expected_index for w in result.words] == [0, 1, 2, 3]


class TestOptionalWords:
    def test_a_zero_skip_cost_word_is_matched_when_heard(self):
        result = align(["اعوذ", "بسم"], heard("اعوذ", "بسم"), skip_costs=[0.0, 1.0])
        assert matches(result) == [Match.EXACT, Match.EXACT]

    def test_a_zero_skip_cost_word_is_omitted_rather_than_forced_onto_the_next_word(self):
        # With a normal skip cost this is a tie between "optional word missing" and
        # "optional word substituted by بسم"; a free skip makes omission strictly better.
        result = align(["اعوذ", "بسم"], heard("بسم"), skip_costs=[0.0, 1.0])
        assert matches(result) == [Match.MISSING, Match.EXACT]
        assert result.words[1].heard.key == "بسم"

    def test_rejects_mismatched_skip_costs(self):
        with pytest.raises(ValueError):
            align(["بسم", "الله"], heard("بسم"), skip_costs=[0.0])


class TestEdgeCases:
    def test_nothing_heard(self):
        result = align(["بسم", "الله"], [])
        assert matches(result) == [Match.MISSING, Match.MISSING]

    def test_nothing_expected(self):
        result = align([], heard("بسم", "الله"))
        assert result.words == [] and len(result.inserted) == 2

    def test_both_empty(self):
        assert align([], []) == Alignment([], [])


class TestBand:
    @pytest.mark.parametrize("seed", range(40))
    def test_banded_search_finds_the_optimal_alignment(self, seed):
        rng = random.Random(seed)
        vocabulary = ["قال", "الله", "رب", "العالمين", "الذين", "امنوا", "يوم", "الدين", "نعبد", "نستعين"]
        expected = [rng.choice(vocabulary) for _ in range(rng.randint(1, 60))]
        # A plausible recitation: the text with random misses, substitutions and extras.
        spoken = []
        for word in expected:
            roll = rng.random()
            if roll < 0.08:
                continue
            spoken.append(rng.choice(vocabulary) if roll < 0.16 else word)
            if rng.random() < 0.05:
                spoken.append(rng.choice(vocabulary))
        heard_words = heard(*spoken)

        result = align(expected, heard_words)
        assert alignment_cost(expected, result) == pytest.approx(optimal_cost(expected, heard_words))

    def test_a_narrow_band_still_connects_very_different_lengths(self):
        # Far more heard than expected tilts the diagonal steeply; the band must still
        # reach the final cell rather than returning a broken alignment.
        expected = ["الله"] * 5
        heard_words = heard(*(["رب"] * 200 + ["الله"] * 5))
        result = align(expected, heard_words, band=2)
        assert len(result.words) == 5
        # Every heard word is accounted for exactly once: aligned to a word, or inserted.
        assert sum(1 for w in result.words if w.heard) + len(result.inserted) == len(heard_words)

    def test_scales_to_a_long_surah(self):
        # Al-Baqarah is ~6,000 words; unbanded that is ~36M cells.
        rng = random.Random(0)
        expected = [f"w{rng.randint(0, 500)}" for _ in range(6000)]
        result = align(expected, heard(*expected))
        assert matches(result).count(Match.EXACT) == 6000
