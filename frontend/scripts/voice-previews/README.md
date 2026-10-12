# 면접관 미리 듣기 생성

면접관을 고르는 화면(랜딩)은 모델을 받기 **전**이라 브라우저에 TTS 엔진이 없다. 그래서 면접관별 한 문장을 개발 중에 미리 합성해 `public/voices/preview/{id}.ogg`로 둔다.

- 목소리 ID와 문장의 원천: `src/interviewers/voices.json` (앱도 같은 파일을 읽는다)
- 합성 설정: 앱과 같다(`TOTAL_STEP=4`, `SPEED=1.05`, `SILENCE_SEC=0.3`). `src/interviewers/voices.test.ts`가 대조한다.
- 라이선스: 모델은 Supertone Supertonic 3(OpenRAIL-M), `helper.py`는 supertone-inc/supertonic의 MIT 코드다. 이 리포에 복사하지 않고 클론 경로로 import한다. 합성 음성이라는 사실은 화면에 표시한다.

## 준비

1. [uv](https://docs.astral.sh/uv/) 설치
2. `git clone https://github.com/supertone-inc/supertonic <클론 경로>`
3. 모델 파일(약 398MB)은 처음 실행할 때 HF 고정 커밋에서 `~/.cache/momo-supertonic/3cadd1ee/`로 받는다. 이미 받아 둔 폴더가 있으면 `--assets`로 지정한다.

## 목소리 후보 듣기 (커밋하지 않음)

```
cd frontend/scripts/voice-previews
uv run --with onnxruntime==1.23.1 --with numpy --with soundfile python generate.py --supertonic <클론 경로> --candidates <임시 폴더>
```

`<임시 폴더>/{gentle,standard,sharp}_{F1..M5}.ogg` 30개가 생긴다. 들어 보고 `voices.json`의 `voice`를 고친다.

## 미리 듣기 생성 (커밋함)

```
uv run --with onnxruntime==1.23.1 --with numpy --with soundfile python generate.py --supertonic <클론 경로>
```

`public/voices/preview/{gentle,standard,sharp}.ogg`를 덮어쓴다(각 100KB 이하). 문장이나 목소리를 바꾸면 다시 실행하고 커밋한다.
