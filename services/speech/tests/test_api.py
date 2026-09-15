from pathlib import Path

import pytest

pytest.importorskip("fastapi", reason="API tests run in the Docker test stage")

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.align import HeardWord  # noqa: E402
from app.quran import QuranText  # noqa: E402
from app.transcribe import AudioDecodeError, Transcript  # noqa: E402

STORED = "0b0e7a5c-1111-4222-8333-944455556666.mp3"
FATIHA_1 = ["بسم", "الله", "الرحمن", "الرحيم"]


class FakeTranscriber:
    provenance = {"modelId": "fake/model", "modelRevision": "abc123"}

    def __init__(self, keys: list[str]):
        self.keys = keys
        self.calls: list[object] = []
        self.beam_sizes: list[int | None] = []
        self.word_timestamps: list[bool] = []
        self.fail_decode = False

    def transcribe(self, source, beam_size: int | None = None, word_timestamps: bool = True) -> Transcript:
        self.calls.append(source)
        self.beam_sizes.append(beam_size)
        self.word_timestamps.append(word_timestamps)
        if self.fail_decode:
            raise AudioDecodeError("could not decode audio: Invalid data found")
        words = [HeardWord(k, float(i), i + 0.8) for i, k in enumerate(self.keys)]
        return Transcript(words=words, raw_text=" ".join(self.keys), duration=len(self.keys) + 1.0)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "AUDIO_DIR", tmp_path)
    (tmp_path / STORED).write_bytes(b"ID3")
    main.app.state.quran = QuranText.load(main.QURAN_PATH)
    main.app.state.transcriber = FakeTranscriber(FATIHA_1)
    # Not used as a context manager, so the lifespan (real model load) never runs.
    return TestClient(main.app)


def post(client, **body):
    return client.post("/v1/references/align", json={"storedName": STORED, "surah": 1, **body})


def test_aligns_a_recording_to_the_requested_ayahs(client):
    response = post(client, ayahStart=1, ayahEnd=1)
    assert response.status_code == 200
    body = response.json()
    assert [w["match"] for w in body["words"]] == ["EXACT"] * 4
    assert body["matchRate"] == 1.0
    assert body["modelId"] == "fake/model" and body["modelRevision"] == "abc123"


def test_response_uses_camel_case_for_the_typescript_client(client):
    word = post(client, ayahStart=1, ayahEnd=1).json()["words"][0]
    assert set(word) == {"ayah", "position", "text", "start", "end", "match", "heard", "estimated"}


def test_returns_vowelled_text_for_display(client):
    assert post(client, ayahStart=1, ayahEnd=1).json()["words"][0]["text"] == "بِسْمِ"


def test_whole_surah_reports_unrecited_ayahs_as_missing(client):
    body = post(client).json()
    assert len({w["ayah"] for w in body["words"]}) == 7
    assert body["matchRate"] < 0.2


@pytest.mark.parametrize(
    "name",
    [
        "../../etc/passwd",
        "..%2F..%2Fetc%2Fpasswd",
        "/etc/passwd",
        "0b0e7a5c-1111-4222-8333-944455556666.mp3/../../x",
        "notes.txt",
        "0B0E7A5C-1111-4222-8333-944455556666.MP3",
    ],
)
def test_rejects_anything_but_a_generated_filename(client, name):
    response = client.post("/v1/references/align", json={"storedName": name, "surah": 1})
    assert response.status_code == 422
    assert main.app.state.transcriber.calls == []


def test_missing_audio_is_404_without_invoking_the_model(client):
    response = client.post(
        "/v1/references/align",
        json={"storedName": "ffffffff-1111-4222-8333-944455556666.mp3", "surah": 1},
    )
    assert response.status_code == 404
    assert main.app.state.transcriber.calls == []


@pytest.mark.parametrize(
    "body",
    [{"surah": 115}, {"surah": 0}, {"ayahStart": 1, "ayahEnd": 8}, {"ayahStart": 3}, {"ayahStart": 0, "ayahEnd": 2}],
)
def test_invalid_ranges_are_rejected_before_transcribing(client, body):
    assert post(client, **body).status_code == 422
    assert main.app.state.transcriber.calls == []


class TestAttemptCheck:
    AUDIO = b"\x1aE\xdf\xa3 webm bytes"

    def check(self, client, audio=AUDIO, **form):
        fields = {"surah": "1", "ayah": "1", **form}
        return client.post("/v1/attempts/check", files={"audio": ("attempt.webm", audio, "audio/webm")}, data=fields)

    def test_checks_the_requested_ayah(self, client):
        response = self.check(client)
        assert response.status_code == 200
        body = response.json()
        assert (body["surah"], body["ayah"]) == (1, 1)
        assert [w["match"] for w in body["words"]] == ["EXACT"] * 4
        assert body["extraWords"] == []

    def test_reports_a_missed_word_with_its_position(self, client):
        client.app.state.transcriber = FakeTranscriber(["بسم", "الرحمن", "الرحيم"])
        words = self.check(client).json()["words"]
        assert [(w["position"], w["match"]) for w in words if w["match"] != "EXACT"] == [(2, "MISSING")]

    def test_uses_the_fast_interactive_decode_settings(self, client):
        self.check(client)
        assert client.app.state.transcriber.beam_sizes == [main.ATTEMPT_BEAM_SIZE]
        # Word timestamps cost 2.3-3x the decode itself and checking never uses them.
        assert client.app.state.transcriber.word_timestamps == [False]

    def test_reference_alignment_still_uses_word_timestamps(self, client):
        post(client, ayahStart=1, ayahEnd=1)
        assert client.app.state.transcriber.word_timestamps == [True]

    def test_decodes_from_memory_and_never_writes_the_recording_to_disk(self, client, tmp_path):
        before = sorted(p.name for p in tmp_path.iterdir())
        self.check(client)
        assert not isinstance(client.app.state.transcriber.calls[0], Path)
        assert sorted(p.name for p in tmp_path.iterdir()) == before

    @pytest.mark.parametrize(("surah", "ayah"), [("1", "8"), ("115", "1"), ("1", "0")])
    def test_rejects_an_ayah_that_does_not_exist_before_transcribing(self, client, surah, ayah):
        assert self.check(client, surah=surah, ayah=ayah).status_code == 422
        assert client.app.state.transcriber.calls == []

    def test_rejects_an_empty_recording(self, client):
        assert self.check(client, audio=b"").status_code == 422

    def test_rejects_an_oversized_recording(self, client, monkeypatch):
        monkeypatch.setattr(main, "MAX_ATTEMPT_BYTES", 16)
        assert self.check(client, audio=b"x" * 17).status_code == 413
        assert client.app.state.transcriber.calls == []

    def test_undecodable_audio_is_a_client_error_not_a_crash(self, client):
        client.app.state.transcriber.fail_decode = True
        response = self.check(client)
        assert response.status_code == 422
        assert "could not decode audio" in response.json()["detail"]
