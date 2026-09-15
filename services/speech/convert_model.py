"""Build-time conversion of the Quran-tuned Whisper model to CTranslate2 (int8).

Runs in a throwaway Docker build stage, so torch and transformers never ship in the
runtime image. Converting the official checkpoint ourselves, pinned to a commit,
rather than downloading a third-party pre-converted copy means the weights have a
known provenance.
"""

import argparse
import json
import shutil
import tempfile
from pathlib import Path

import ctranslate2
from huggingface_hub import hf_hub_download, snapshot_download
from transformers import WhisperTokenizerFast

MODEL_ID = "tarteel-ai/whisper-base-ar-quran"
MODEL_REVISION = "5c3c53fdf9272c4f6ee0bee09a1e5a4a615ee25c"
# The fine-tune was trained from openai/whisper-base but ships no generation config,
# without which the converter falls back to using every attention head in the back half
# of the decoder for word timing. Fine-tuning leaves the vocabulary and heads' roles in
# place, so the parent's tuned alignment heads and token-suppression lists apply.
BASE_ID = "openai/whisper-base"
BASE_REVISION = "e37978b90ca9030d5170a5c07aadb050351a65bb"
EXPECTED_ALIGNMENT_HEADS = [[3, 1], [4, 2], [4, 3], [4, 7], [5, 1], [5, 2], [5, 4], [5, 6]]

CHECKPOINT_FILES = [
    "config.json",
    "pytorch_model.bin",
    "vocab.json",
    "merges.txt",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "normalizer.json",
    "preprocessor_config.json",
]


def convert(output_dir: Path) -> None:
    with tempfile.TemporaryDirectory() as work_dir:
        work = Path(work_dir)
        snapshot_download(
            MODEL_ID, revision=MODEL_REVISION, allow_patterns=CHECKPOINT_FILES, local_dir=work
        )
        shutil.copy(
            hf_hub_download(BASE_ID, "generation_config.json", revision=BASE_REVISION),
            work / "generation_config.json",
        )
        generation = json.loads((work / "generation_config.json").read_text("utf-8"))
        if generation.get("alignment_heads") != EXPECTED_ALIGNMENT_HEADS:
            raise SystemExit("base generation_config.json changed: alignment heads differ")

        # faster-whisper reads tokenizer.json, which the fine-tune doesn't include; the
        # fast tokenizer builds it from vocab.json + merges.txt.
        WhisperTokenizerFast.from_pretrained(work).save_pretrained(work)

        converter = ctranslate2.converters.TransformersConverter(
            str(work), copy_files=["tokenizer.json", "preprocessor_config.json"]
        )
        converter.convert(str(output_dir), quantization="int8", force=True)

    converted = json.loads((output_dir / "config.json").read_text("utf-8"))
    if converted.get("alignment_heads") != EXPECTED_ALIGNMENT_HEADS:
        raise SystemExit(f"converted model has wrong alignment heads: {converted.get('alignment_heads')}")

    (output_dir / "PROVENANCE.json").write_text(
        json.dumps(
            {
                "modelId": MODEL_ID,
                "modelRevision": MODEL_REVISION,
                "generationConfigFrom": f"{BASE_ID}@{BASE_REVISION}",
                "format": f"ctranslate2-{ctranslate2.__version__}",
                "quantization": "int8",
            },
            indent=2,
        ),
        "utf-8",
    )
    print(f"converted {MODEL_ID}@{MODEL_REVISION[:8]} -> {output_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    convert(parser.parse_args().out)
