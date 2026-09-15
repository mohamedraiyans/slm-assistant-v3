"""HTTP API of the speech service. Stateless: the NestJS api owns storage and jobs."""

from __future__ import annotations

import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .quran import SURAH_COUNT, InvalidRangeError, QuranText
from .reference import build_reference_timing

AUDIO_DIR = Path(os.environ.get("AUDIO_DIR", "/data/recitations"))
MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/models/whisper-base-ar-quran"))
QURAN_PATH = Path(os.environ.get("QURAN_PATH", Path(__file__).parent.parent / "data" / "quran-simple.txt"))
# Beam 1 decodes roughly twice as fast; on Al-Fatiha it matched beam 5's accuracy, but
# one recording is not enough evidence to make it the default for ground-truth data.
BEAM_SIZE = int(os.environ.get("BEAM_SIZE", "5"))
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
