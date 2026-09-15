from pathlib import Path

import pytest

from app.align import HeardWord, Match
from app.attempt import check_attempt
from app.quran import QuranText

ISTIADHA = ["اعوذ", "بالله", "من", "الشيطان", "الرجيم"]
BASMALA = ["بسم", "الله", "الرحمن", "الرحيم"]


@pytest.fixture(scope="module")
def quran() -> QuranText:
    return QuranText.load(Path(__file__).parent.parent / "data" / "quran-simple.txt")


def spoken(*keys: str) -> list[HeardWord]:
    return [HeardWord(k, float(i), i + 0.9) for i, k in enumerate(keys)]


def keys_of(quran, surah, ayah):
    return [w.key for w in quran.words(surah, ayah, ayah)]


def test_a_correct_recitation_passes_every_word(quran):
    expected = quran.words(1, 2, 2)
    result = check_attempt(expected, spoken(*keys_of(quran, 1, 2)))

    assert [w.match for w in result.words] == [Match.EXACT] * len(expected)
    assert result.extra_words == []


def test_a_skipped_word_is_reported_as_missing_at_its_position(quran):
    # الحمد لله رب العالمين, reciting it without رب.
    expected = quran.words(1, 2, 2)
    heard = [k for k in keys_of(quran, 1, 2) if k != "رب"]
    result = check_attempt(expected, spoken(*heard))

    missing = [w for w in result.words if w.match == Match.MISSING]
    assert [(w.word.position, w.word.key) for w in missing] == [(3, "رب")]


def test_a_wrong_word_reports_what_was_heard_instead(quran):
    expected = quran.words(1, 4, 4)  # مالك يوم الدين
    result = check_attempt(expected, spoken("مالك", "يوم", "القيامه"))

    assert result.words[2].match == Match.SUBSTITUTED
    assert result.words[2].heard == "القيامه"


def test_a_repeated_word_is_an_extra_not_a_mistake_in_the_ayah(quran):
    result = check_attempt(quran.words(1, 4, 4), spoken("مالك", "مالك", "يوم", "الدين"))

    assert all(w.match == Match.EXACT for w in result.words)
    assert result.extra_words == ["مالك"]


def test_opening_with_istiadha_and_basmala_is_not_counted_as_extra(quran):
    result = check_attempt(quran.words(112, 1, 1), spoken(*ISTIADHA, *BASMALA, *keys_of(quran, 112, 1)))

    assert all(w.match == Match.EXACT for w in result.words)
    assert result.extra_words == []


def test_reciting_the_wrong_ayah_fails_most_words(quran):
    result = check_attempt(quran.words(1, 2, 2), spoken(*keys_of(quran, 1, 5)))
    correct = sum(1 for w in result.words if w.match in (Match.EXACT, Match.FUZZY))
    assert correct <= 1


def test_silence_reports_every_word_missing(quran):
    expected = quran.words(1, 2, 2)
    result = check_attempt(expected, [])
    assert [w.match for w in result.words] == [Match.MISSING] * len(expected)
