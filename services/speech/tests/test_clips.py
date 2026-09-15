import pytest

from app.clips import merge_speech, snap_to_speech

# VAD output measured on a real Al-Fatiha recording.
FATIHA_SPEECH = [(0.2, 2.8), (3.5, 6.2), (6.4, 21.7), (21.8, 30.6), (30.8, 32.7)]


class TestMergeSpeech:
    def test_groups_the_real_recording_into_three_clips(self):
        assert merge_speech(FATIHA_SPEECH, 15) == [(0.2, 6.2), (6.4, 21.7), (21.8, 32.7)]

    def test_never_exceeds_the_clip_limit_when_merging(self):
        for start, end in merge_speech(FATIHA_SPEECH, 15):
            assert end - start <= 15 or (start, end) in FATIHA_SPEECH

    def test_a_single_span_longer_than_the_limit_is_kept_whole_not_dropped(self):
        assert merge_speech([(0.0, 40.0)], 15) == [(0.0, 40.0)]

    def test_keeps_every_speech_span_covered(self):
        clips = merge_speech(FATIHA_SPEECH, 10)
        for start, end in FATIHA_SPEECH:
            assert any(c_start <= start and end <= c_end for c_start, c_end in clips)

    def test_no_speech(self):
        assert merge_speech([], 15) == []


class TestSnapToSpeech:
    def test_regression_trims_the_pause_absorbed_into_the_next_word(self):
        # بسم was reported from 2.73 s, but speech only resumes at 3.5 s.
        assert snap_to_speech(2.73, 4.03, FATIHA_SPEECH) == (3.5, 4.03)

    def test_ignores_a_neighbouring_spans_padding_brushing_the_word(self):
        # (0.2, 2.8) overlaps 2.73-4.03 by only 0.07 s: padding, not this word's speech.
        start, _ = snap_to_speech(2.73, 4.03, FATIHA_SPEECH)
        assert start == 3.5

    def test_trims_trailing_silence(self):
        assert snap_to_speech(2.0, 3.2, FATIHA_SPEECH) == (2.0, 2.8)

    def test_a_word_inside_speech_is_unchanged(self):
        assert snap_to_speech(7.0, 7.6, FATIHA_SPEECH) == (7.0, 7.6)

    def test_a_word_spanning_a_short_breath_keeps_both_sides(self):
        assert snap_to_speech(21.5, 22.3, FATIHA_SPEECH) == (21.5, 22.3)

    def test_a_word_entirely_in_silence_is_left_alone_rather_than_collapsed(self):
        assert snap_to_speech(2.9, 3.4, FATIHA_SPEECH) == (2.9, 3.4)

    def test_no_speech_detected(self):
        assert snap_to_speech(1.0, 2.0, []) == (1.0, 2.0)

    @pytest.mark.parametrize(("start", "end"), [(0.0, 40.0), (2.73, 4.03), (6.3, 6.5), (30.7, 33.0)])
    def test_never_moves_a_word_outside_its_own_span(self, start, end):
        new_start, new_end = snap_to_speech(start, end, FATIHA_SPEECH)
        assert start <= new_start < new_end <= end
