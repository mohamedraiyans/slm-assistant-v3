from pathlib import Path

import pytest

pytest.importorskip("fastapi", reason="API tests run in the Docker test stage")

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.align import HeardWord  # noqa: E402
from app.quran import QuranText  # noqa: E402
from app.transcribe import Transcript  # noqa: E402

STORED = "0b0e7a5c-1111-4222-8333-944455556666.mp3"
FATIHA_1 = ["بسم", "الله", "الرحمن", "الرحيم"]


class FakeTranscriber:
    provenance = {"modelId": "fake/model", "modelRevision": "abc123"}

    def __init__(self, keys: list[str]):
        self.keys = keys
        self.calls: list[Path] = []

    def transcribe(self, audio_path: Path) -> Transcript:
        self.calls.append(audio_path)
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
