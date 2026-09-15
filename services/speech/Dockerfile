# syntax=docker/dockerfile:1

# ---- convert: build-time model conversion (torch/transformers stay in this stage) ----
FROM python:3.12-slim AS convert
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN pip install torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu
COPY requirements-convert.txt .
RUN pip install -r requirements-convert.txt
COPY convert_model.py .
RUN python convert_model.py --out /models/whisper-base-ar-quran

# ---- runtime: the service image ----
FROM python:3.12-slim AS runtime
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    MODEL_DIR=/models/whisper-base-ar-quran AUDIO_DIR=/data/recitations \
    HF_HUB_OFFLINE=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
# Baked in rather than downloaded at startup: the image is immutable and starts
# without network access, which is what a Kubernetes rollout wants.
COPY --from=convert /models /models
COPY data ./data
COPY app ./app
RUN useradd --system --uid 10001 speech
USER speech
EXPOSE 8000
# Generous on purpose: transcription saturates every core for minutes at a time, and on
# a 2-core laptop CPU even starting this probe took over 5 s under that load. A probe
# that fails during normal work would, under Kubernetes, restart the service mid-job.
HEALTHCHECK --interval=30s --timeout=20s --start-period=60s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ---- test: runtime image plus test tooling; `docker build --target test` runs the suite ----
FROM runtime AS test
USER root
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
COPY tests ./tests
USER speech
RUN python -m pytest -q -p no:cacheprovider tests
