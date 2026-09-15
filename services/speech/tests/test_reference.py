from pathlib import Path

import pytest

from app.align import HeardWord, Match
from app.quran import QuranText, QuranWord
from app.reference import build_reference_timing, opening_preamble

ISTIADHA = ["اعوذ", "بالله", "من", "الشيطان", "الرجيم"]
BASMALA = ["بسم", "الله", "الرحمن", "الرحيم"]


def words(*keys: str, surah: int = 1, ayah: int = 1) -> list[QuranWord]:
    return [QuranWord(surah, ayah, i + 1, key, key) for i, key in enumerate(keys)]


def spoken(*keys: str, start: float = 0.0) -> list[HeardWord]:
    return [HeardWord(k, start + i, start + i + 0.9) for i, k in enumerate(keys)]


@pytest.fixture(scope="module")
def quran() -> QuranText:
    return QuranText.load(Path(__file__).parent.parent / "data" / "quran-simple.txt")


class TestOpeningPreamble:
    def test_regression_istiadha_does_not_steal_the_basmalas_timing(self, quran):
        # Real failure on a Mishary Al-Fatiha recording: الرجيم and الرحيم differ by one
        # letter, so an unmodelled isti'adha was aligned onto the basmala.
        expected = quran.words(1, 1, 1)
        timing = build_reference_timing(expected, spoken(*ISTIADHA, *BASMALA), duration=10)

        assert [w.match for w in timing.words] == [Match.EXACT] * 4
        assert [w.start for w in timing.words] == [5.0, 6.0, 7.0, 8.0]
        assert timing.inserted_count == 0

    def test_a_recitation_without_any_opening_is_still_perfect(self, quran):
        timing = build_reference_timing(quran.words(112), spoken(*[w.key for w in quran.words(112)]), 20)
        assert timing.match_rate == 1.0 and timing.inserted_count == 0

    def test_basmala_before_a_surah_is_accepted_without_being_reported(self, quran):
        expected = quran.words(112)
        timing = build_reference_timing(expected, spoken(*BASMALA, *[w.key for w in expected]), 20)
        assert len(timing.words) == len(expected)
        assert timing.match_rate == 1.0 and timing.inserted_count == 0

    def test_at_tawbah_has_no_basmala_preamble(self, quran):
        assert opening_preamble(quran.words(9, 1, 1)) == ISTIADHA

    def test_al_fatiha_does_not_duplicate_its_own_basmala(self, quran):
        assert opening_preamble(quran.words(1)) == ISTIADHA

    def test_mid_surah_ranges_allow_a_basmala(self, quran):
        assert opening_preamble(quran.words(2, 255, 255)) == ISTIADHA + BASMALA


def test_observed_words_keep_their_recognizer_timing():
    timing = build_reference_timing(
        words("بسم", "الله"),
        [HeardWord("بسم", 0.5, 1.0), HeardWord("الله", 1.2, 1.8)],
        duration=3.0,
    )
    assert [(w.start, w.end, w.estimated) for w in timing.words] == [(0.5, 1.0, False), (1.2, 1.8, False)]


def test_missing_word_gets_the_gap_between_its_neighbours():
    timing = build_reference_timing(
        words("بسم", "الله", "الرحمن"),
        [HeardWord("بسم", 0.5, 1.0), HeardWord("الرحمن", 2.0, 2.6)],
        duration=3.0,
    )
    missing = timing.words[1]
    assert missing.match == Match.MISSING
    assert (missing.start, missing.end, missing.estimated) == (1.0, 2.0, True)


def test_missing_words_at_the_edges_extend_to_the_recording_bounds():
    timing = build_reference_timing(words("بسم", "الله", "الرحمن"), [HeardWord("الله", 1.0, 1.5)], duration=4.0)
    assert (timing.words[0].start, timing.words[0].end) == (0.0, 1.0)
    assert (timing.words[2].start, timing.words[2].end) == (1.5, 4.0)


def test_nothing_heard_never_produces_an_inverted_span():
    timing = build_reference_timing(words("بسم", "الله"), [], duration=0.0)
    assert all(w.start <= w.end for w in timing.words)


def test_match_rate_counts_exact_and_fuzzy_but_not_substitutions():
    timing = build_reference_timing(
        words("بسم", "الله", "الرحمن", "الرحيم"),
        [
            HeardWord("بسم", 0, 1),
            HeardWord("الله", 1, 2),
            HeardWord("الرحمان", 2, 3),  # fuzzy: counts
            HeardWord("العالمين", 3, 4),  # substitution: doesn't
        ],
        duration=4.0,
    )
    assert timing.match_rate == 0.75


def test_match_rate_exposes_a_recording_of_the_wrong_surah():
    timing = build_reference_timing(
        words("قل", "هو", "الله", "احد"),
        [HeardWord(k, i, i + 1) for i, k in enumerate(["الحمد", "لله", "رب", "العالمين"])],
        duration=4.0,
    )
    assert timing.match_rate < 0.5
