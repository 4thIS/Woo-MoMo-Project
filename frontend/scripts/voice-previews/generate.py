"""면접관 미리 듣기 OGG 생성기.

앱과 같은 합성 설정(스텝·속도·무음)으로 Supertonic 3를 CPU에서 돌려 OGG Vorbis로 저장한다.
모델 파일은 매니페스트와 같은 HF 고정 커밋에서 받아 --assets 폴더에 둔다(이미 있으면 건너뜀).
설계: docs/specs/frontend/2026-09-26-interviewer-personas-design.md 6.1
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

# 앱(frontend/src/workers/ttsProtocol.ts)과 같아야 한다 — src/interviewers/voices.test.ts가 대조한다
TOTAL_STEP = 4
SPEED = 1.05
SILENCE_SEC = 0.3
LANG = "ko"
HF_BASE = (
    "https://huggingface.co/Supertone/supertonic-3/resolve/"
    "3cadd1ee6394adea1bd021217a0e650ede09a323/"
)
ENGINE = [
    "onnx/text_encoder.onnx",
    "onnx/duration_predictor.onnx",
    "onnx/vector_estimator.onnx",
    "onnx/vocoder.onnx",
    "onnx/tts.json",
    "onnx/unicode_indexer.json",
]
ALL_VOICES = [f"{g}{i}" for g in "FM" for i in range(1, 6)]

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent.parent
VOICES_JSON = FRONTEND / "src" / "interviewers" / "voices.json"
OUT_DIR = FRONTEND / "public" / "voices" / "preview"
DEFAULT_ASSETS = Path.home() / ".cache" / "momo-supertonic" / "3cadd1ee"


def fetch(assets: Path, rel: str) -> Path:
    dst = assets / rel
    if not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        print(f"받는 중: {rel}")
        part = dst.with_name(dst.name + ".part")
        urllib.request.urlretrieve(HF_BASE + rel, part)
        part.replace(dst)
    return dst


def main() -> None:
    ap = argparse.ArgumentParser(description="면접관 미리 듣기 OGG 생성")
    ap.add_argument(
        "--supertonic",
        required=True,
        help="supertone-inc/supertonic 클론 경로 (py/helper.py를 쓴다, MIT)",
    )
    ap.add_argument(
        "--assets",
        default=str(DEFAULT_ASSETS),
        help="onnx/·voice_styles/를 둘 폴더 (없으면 HF 고정 커밋에서 받는다)",
    )
    ap.add_argument(
        "--candidates",
        help="이 폴더에 면접관 문장 × 목소리 10개 후보를 만든다 (커밋하지 않는다)",
    )
    args = ap.parse_args()

    sys.path.insert(0, str(Path(args.supertonic) / "py"))
    import soundfile as sf
    from helper import load_text_to_speech, load_voice_style

    assets = Path(args.assets)
    for rel in ENGINE:
        fetch(assets, rel)
    tts = load_text_to_speech(str(assets / "onnx"), False)
    spec = json.loads(VOICES_JSON.read_text(encoding="utf-8"))

    def render(voice: str, text: str, out: Path) -> None:
        style = load_voice_style([str(fetch(assets, f"voice_styles/{voice}.json"))])
        wav, dur = tts(text, LANG, style, TOTAL_STEP, SPEED, SILENCE_SEC)
        samples = wav[0, : int(tts.sample_rate * float(dur[0]))]
        out.parent.mkdir(parents=True, exist_ok=True)
        sf.write(out, samples, tts.sample_rate, format="OGG", subtype="VORBIS")
        print(f"{out.name}: {voice} {float(dur[0]):.1f}초 {out.stat().st_size // 1024}KB")

    if args.candidates:
        for iid, cfg in spec.items():
            for voice in ALL_VOICES:
                render(voice, cfg["text"], Path(args.candidates) / f"{iid}_{voice}.ogg")
        return
    for iid, cfg in spec.items():
        render(cfg["voice"], cfg["text"], OUT_DIR / f"{iid}.ogg")


if __name__ == "__main__":
    main()
