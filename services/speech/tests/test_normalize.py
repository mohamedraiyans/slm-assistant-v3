import unicodedata

import pytest

from app.normalize import normalize_word


class TestVowelMarks:
    def test_strips_harakat_so_vowelled_and_plain_text_match(self):
        assert normalize_word("بِسْمِ") == normalize_word("بسم") == "بسم"

    def test_strips_the_dagger_alef(self):
        # الرَّحْمَـٰنِ carries a superscript alef and a tatweel the plain edition lacks.
        assert normalize_word("الرَّحْمَـٰنِ") == "الرحمن"

    def test_strips_tatweel(self):
        assert normalize_word("الرحمـن") == "الرحمن"


class TestLetterFolding:
    @pytest.mark.parametrize("seat", ["أ", "إ", "آ", "ٱ"])
    def test_every_alef_seat_matches_a_bare_alef(self, seat):
        assert normalize_word(f"{seat}لم") == "الم"

    def test_regression_hamza_seat_is_folded_not_merely_decomposed(self):
        # Naively stripping combining marks after NFD turns أ into ا + a *separate*
        # hamza mark: it happens to look right but only works by accident of which
        # marks are removed. The fold must hold for the precomposed form directly.
        assert normalize_word("إِيَّاكَ") == normalize_word("اياك") == "اياك"

    def test_decomposed_and_precomposed_input_normalize_identically(self):
        word = "آمنوا"
        assert normalize_word(unicodedata.normalize("NFD", word)) == normalize_word(word)

    @pytest.mark.parametrize(
        ("written", "folded"),
        [("هدى", "هدي"), ("رحمة", "رحمه"), ("مؤمن", "مومن"), ("بئس", "بيس"), ("السماء", "السما")],
    )
    def test_folds_letters_recognizers_write_inconsistently(self, written, folded):
        assert normalize_word(written) == folded


class TestNonWords:
    @pytest.mark.parametrize("mark", ["ۛ", "ۖ", "ۗ", "ۚ", "ۘ", "ۙ"])
    def test_pause_marks_are_not_words(self, mark):
        assert normalize_word(mark) == ""

    @pytest.mark.parametrize("token", ["", " ", "1", "،", ".", "(1)"])
    def test_punctuation_digits_and_blanks_are_not_words(self, token):
        assert normalize_word(token) == ""

    def test_strips_punctuation_attached_to_a_word(self):
        # Whisper emits punctuation glued to the word before it.
        assert normalize_word("العالمين،") == "العالمين"
