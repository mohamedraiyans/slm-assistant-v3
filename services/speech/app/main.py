"""HTTP API of the speech service. Stateless: the NestJS api owns storage and jobs."""

from __future__ import annotations

import io
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .attempt import check_attempt
from .quran import SURAH_COUNT, InvalidRangeError, QuranText
from .reference import build_reference_timing

AUDIO_DIR = Path(os.environ.get("AUDIO_DIR", "/data/recitations"))
MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/models/whisper-base-ar-quran"))
QURAN_PATH = Path(os.environ.get("QURAN_PATH", Path(__file__).parent.parent / "data" / "quran-simple.txt"))
# Beam 1 decodes roughly twice as fast; on Al-Fatiha it matched beam 5's accuracy, but
# one recording is not enough evidence to make it the default for ground-truth data.
BEAM_SIZE = int(os.environ.get("BEAM_SIZE", "5"))
# Someone is waiting on a practice check, so it defaults to greedy decoding: on
# Al-Fatiha, beam 1 matched beam 5's accuracy at about half the decode time.
ATTEMPT_BEAM_SIZE = int(os.environ.get("ATTEMPT_BEAM_SIZE", "1"))
# One ayah; even the longest recited slowly is a few MB of compressed audio.
MAX_ATTEMPT_BYTES = 10 * 1024 * 1024
# 0 lets CTranslate2 choose, which counts hyperthreads. Set it to the physical core
# count: on a 2-core/4-thread CPU, 2 threads decoded 2.2x faster than 4.
CPU_THREADS = int(os.environ.get("CPU_THREADS", "0"))

# Only names the api generates (uuid + audio extension). The path is joined onto
# AUDIO_DIR, so anything looser would allow reading arbitrary files.
_STORED_NAME = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp3|aac|wav|flac|ogg|m4a|webm)$")


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AlignRequest(CamelModel):
    stored_name: str
    surah: int = Field(ge=1, le=SURAH_COUNT)
    ayah_start: int | None = Field(default=None, ge=1)
    ayah_end: int | None = Field(default=None, ge=1)


class WordOut(CamelModel):
    ayah: int
    position: int
    text: str
    start: float
    end: float
    match: str
    heard: str | None
    estimated: bool


class AlignResponse(CamelModel):
    model_id: str
    model_revision: str
    duration_sec: float
    processing_sec: float
    match_rate: float
    inserted_count: int
    transcript: str
    words: list[WordOut]


class CheckedWordOut(CamelModel):
    position: int
    text: str
    match: str
    heard: str | None


class AttemptResponse(CamelModel):
    surah: int
    ayah: int
    processing_sec: float
    transcript: str
    words: list[CheckedWordOut]
    extra_words: list[str]


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .transcribe import Transcriber

    app.state.quran = QuranText.load(QURAN_PATH)
    app.state.transcriber = Transcriber(MODEL_DIR, beam_size=BEAM_SIZE, cpu_threads=CPU_THREADS)
    yield


app = FastAPI(title="SLM speech service", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model": app.state.transcriber.provenance,
        "quranVerses": app.state.quran.verse_count,
    }


# A plain `def` endpoint: FastAPI runs it in a worker thread, so a multi-minute
# transcription doesn't block the event loop (and /health keeps answering).
@app.post("/v1/references/align", response_model=AlignResponse, response_model_by_alias=True)
def align_reference(request: AlignRequest) -> AlignResponse:
    if not _STORED_NAME.fullmatch(request.stored_name):
        raise HTTPException(status_code=422, detail="storedName is not a generated audio filename")
    audio_path = AUDIO_DIR / request.stored_name
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found in the shared recitations folder")

    try:
        expected = app.state.quran.words(request.surah, request.ayah_start, request.ayah_end)
    except InvalidRangeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    started = time.perf_counter()
    transcript = app.state.transcriber.transcribe(audio_path)
    timing = build_reference_timing(expected, transcript.words, transcript.duration)
    provenance = app.state.transcriber.provenance

    return AlignResponse(
        model_id=provenance["modelId"],
        model_revision=provenance["modelRevision"],
        duration_sec=round(transcript.duration, 3),
        processing_sec=round(time.perf_counter() - started, 3),
        match_rate=timing.match_rate,
        inserted_count=timing.inserted_count,
        transcript=transcript.raw_text,
        words=[
            WordOut(
                ayah=w.word.ayah,
                position=w.word.position,
                text=w.word.text,
                start=w.start,
                end=w.end,
                match=w.match.value,
                heard=w.heard,
                estimated=w.estimated,
            )
            for w in timing.words
        ],
    )


@app.post("/v1/attempts/check", response_model=AttemptResponse, response_model_by_alias=True)
def check_recitation_attempt(
    audio: UploadFile = File(...),
    surah: int = Form(..., ge=1, le=SURAH_COUNT),
    ayah: int = Form(..., ge=1),
) -> AttemptResponse:
    """
    Checks a recording of one ayah. The audio is held in memory and never written to
    disk: a practice attempt is someone's voice, not data this service should keep.
    """
    from .transcribe import AudioDecodeError

    # Read one byte past the cap, so an oversized upload is rejected without being
    # buffered in full.
    data = audio.file.read(MAX_ATTEMPT_BYTES + 1)
    if len(data) > MAX_ATTEMPT_BYTES:
        raise HTTPException(status_code=413, detail="Recording is too large for a single ayah")
    if not data:
        raise HTTPException(status_code=422, detail="Recording is empty")

    try:
        expected = app.state.quran.words(surah, ayah, ayah)
    except InvalidRangeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    started = time.perf_counter()
    try:
        # Checking needs the words and their order, not per-word timings: the correction
        # clip comes from the reference. Skipping them measured 2.3-3x faster.
        transcript = app.state.transcriber.transcribe(
            io.BytesIO(data), beam_size=ATTEMPT_BEAM_SIZE, word_timestamps=False
        )
    except AudioDecodeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    result = check_attempt(expected, transcript.words)

    return AttemptResponse(
        surah=surah,
        ayah=ayah,
        processing_sec=round(time.perf_counter() - started, 3),
        transcript=transcript.raw_text,
        words=[
            CheckedWordOut(position=w.word.position, text=w.word.text, match=w.match.value, heard=w.heard)
            for w in result.words
        ],
        extra_words=result.extra_words,
    )
