from pathlib import Path

import pytest

from app.quran import InvalidRangeError, QuranText

DATA = Path(__file__).parent.parent / "data" / "quran-simple.txt"


@pytest.fixture(scope="module")
def quran() -> QuranText:
    return QuranText.load(DATA)


class TestCanonicalText:
    def test_contains_every_verse_of_the_quran(self, quran):
        assert quran.verse_count == 6236

    @pytest.mark.parametrize(("surah", "ayahs"), [(1, 7), (2, 286), (9, 129), (112, 4), (114, 6)])
    def test_knows_ayah_counts(self, quran, surah, ayahs):
        assert quran.ayah_count(surah) == ayahs

    def test_skips_the_license_block_rather_than_parsing_it_as_text(self, quran):
        assert all(word.key for word in quran.words(114))

    def test_opening_words_of_al_fatiha(self, quran):
        assert [w.key for w in quran.words(1, 1, 1)] == ["بسم", "الله", "الرحمن", "الرحيم"]

    def test_keeps_the_vowelled_text_for_display(self, quran):
        assert quran.words(1, 1, 1)[0].text == "بِسْمِ"


class TestPauseMarks:
    def test_regression_pause_marks_are_not_counted_as_words(self, quran):
        # Al-Baqarah 2:2 has two standalone ۛ marks in the text. If they counted as
        # words, a perfect recitation would report two missed words.
        words = quran.words(2, 2, 2)
        assert all(word.key for word in words)
        assert "ۛ" not in {word.text for word in words}

    def test_positions_count_spoken_words_only(self, quran):
        assert [w.position for w in quran.words(2, 2, 2)] == list(range(1, len(quran.words(2, 2, 2)) + 1))


class TestRanges:
    def test_whole_surah_when_no_range_given(self, quran):
        assert {w.ayah for w in quran.words(1)} == set(range(1, 8))

    def test_inclusive_range(self, quran):
        assert {w.ayah for w in quran.words(2, 255, 257)} == {255, 256, 257}

    @pytest.mark.parametrize(
        ("surah", "start", "end"),
        [(1, 1, 8), (1, 0, 3), (1, 5, 2), (115, None, None), (0, None, None)],
    )
    def test_rejects_ranges_outside_the_surah(self, quran, surah, start, end):
        with pytest.raises(InvalidRangeError):
            quran.words(surah, start, end)

    def test_rejects_a_half_specified_range(self, quran):
        with pytest.raises(InvalidRangeError):
            quran.words(1, 3, None)
