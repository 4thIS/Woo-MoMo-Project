# 면접관 고르기 · 페르소나 · 목소리 — 구현 계획 (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-26
- 기준 spec: `docs/specs/frontend/2026-09-26-interviewer-personas-design.md` (계약: `docs/specs/backend/2026-09-26-tts-voices-design.md`)
- 작성·구현: @ssenu (이번 기능 한정 역할 — spec 9절), 리뷰: @leemonta9482, 스프라이트 에셋: @leemonta9482

**Goal:** 모델을 받기 전에 면접관 3명(온화한 선배·기본·날카로운 압박) 중 한 명을 골라 목소리를 미리 듣고, 고른 면접관의 목소리·말투·리포트 말투·무대 스프라이트로 면접을 보게 한다.

**Architecture:**
- 면접관 정의(`src/interviewers/`)는 순수 데이터다. 목소리 ID와 미리 듣기 문장은 `voices.json` 하나로 TS 앱과 Python 생성 스크립트가 같이 쓴다.
- 선택 상태·미리 듣기·스프라이트 확인은 새 스토어 `stores/interviewer.ts`가 맡는다.
- 모델 스토어는 매니페스트 `tts.voices`에서 "엔진 + 고른 목소리"를 골라(`utils/ttsVoices.ts`) 받고, 바꾸면 워커에 `setVoice`로 목소리만 교체한다.
- 페르소나는 `prompts/personas.ts`의 네 자리만 시스템 프롬프트·리포트 지시문에 채운다. `standard`는 지금 문구와 글자까지 같다.

**Tech Stack:** Vue 3 + TypeScript + Vite + Pinia + Vitest(@vue/test-utils, jsdom), onnxruntime-web(워커), Python(uv) + onnxruntime + soundfile(미리 듣기 생성 스크립트만)

## Global Constraints

- 면접관 id는 `'gentle' | 'standard' | 'sharp'`, 이 순서로 보여 준다. 이름: `온화한 선배` / `기본 면접관` / `날카로운 압박 면접관`. 기본값 `DEFAULT_INTERVIEWER = 'standard'`
- `standard`는 목소리 `M2`, 스프라이트 `/sprites/interviewers/center_*.png`(지금 파일)다. 새 면접관 스프라이트 경로는 `/sprites/interviewers/{id}/center_{role}.png`이다.
- 가운데 동작 프레임 수(32×32 가로 스트립): idle 15, question 10, nod 11, watch 10, lookside 10, armscross 28
- 합성 설정은 앱과 미리 듣기가 같다: 스텝 `TOTAL_STEP=4`, 속도 `SPEED=1.05`, 무음 `SILENCE_SEC=0.3`(`src/workers/ttsProtocol.ts`)
- 미리 듣기: 카드 클릭·키보드 선택이면 **선택 + 포커스 + 무조건 재생**이다. 스피커 버튼과 미리 듣기 음소거는 두지 않고, `momo.muted`를 읽지 않는다. 면접 무대의 음소거 토글은 바꾸지 않는다.
- `localStorage` 키 `momo.interviewer`. 읽기·쓰기는 try/catch로 감싼다(기존 `momo.voice`·`momo.muted`와 같은 방식).
- 계층: `services/`는 스토어를 import하지 않는다. `views/`·`components/`는 스토어와 순수 데이터(`@/interviewers`, `interviewerAnims.ts`)만 import하고 `services/`는 import하지 않는다(`frontend/CLAUDE.md`).
- `tokens.css` 밖에서 색 리터럴(`#…`, `rgb(…)`)을 쓰지 않는다(`src/styles/tokens.test.ts`가 막는다). CSS 변수만 쓴다.
- 모델 출력은 텍스트 바인딩만 쓴다(`innerHTML` 금지).
- `src/prompts/`는 계층 규율 경로다. 바꾸는 PR에 **면접관 3명 각각 면접 1회 완주 + 리포트 JSON 파싱 확인**과 프롬프트 전후 비교를 붙인다.
- 게이트(frontend/): `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`
- 커밋: `feat(frontend): …` / `fix(frontend): …` / `docs: …`. `main`에서 `feature/` 브랜치를 만든다.
- 선행: 백엔드 계약 PR(`docs/plans/backend/2026-09-26-tts-voices.md`)을 먼저 머지·배포한다. 그 전에도 프론트는 `voices`가 없으면 기본 목소리로 대체하므로 깨지지 않는다.

## PR 묶음 · 이슈

| PR | Task | 내용 | 이슈 | 선행 |
|---|---|---|---|---|
| PR 1 | 1 | 미리 듣기 에셋·생성 스크립트·`voices.json` | (에셋) | 목소리 청취 결정 |
| PR 2 | 2–6 | 면접관 정의·선택 스토어·TTS 목소리 선택·`setVoice` | ③ + ② 일부 | PR 1, 백엔드 계약 배포 |
| PR 3 | 7–9 | `InterviewerPicker`·랜딩·준비 화면 | ② | PR 2 |
| PR 4 | 10 | 페르소나 프롬프트·리포트 말투 + 리허설 | ④ | PR 2 |
| PR 5 | 11–12 | 무대 가운데 스프라이트·태그·리포트 헤더, 문서 | ⑤ | PR 4(`sessionInterviewer`). 스프라이트 에셋은 없으면 기본으로 대체 |
| 에셋 PR | — | `gentle`·`sharp` 스프라이트 2세트 | ① @leemonta9482 | PR 1의 목소리 결정(겉모습 성별) |

## File Structure

| 파일 | 책임 |
|---|---|
| `frontend/src/interviewers/voices.json` (신규) | 면접관별 목소리 ID·미리 듣기 문장. TS와 Python 공용 단일 원천 |
| `frontend/src/interviewers/index.ts` (신규) | 면접관 정의(`INTERVIEWERS`, `interviewerById`, `CENTER_FRAMES`, 타입). 순수 데이터 |
| `frontend/scripts/voice-previews/generate.py`, `README.md` (신규) | 미리 듣기 OGG·후보 샘플 생성 |
| `frontend/public/voices/preview/{gentle,standard,sharp}.ogg` (신규) | 미리 듣기 오디오 |
| `frontend/src/services/preview.ts` (신규) | `HTMLAudioElement` 하나로 미리 듣기 재생·정지 |
| `frontend/src/services/sprites.ts` (신규) | 스프라이트 이미지가 뜨는지 확인 |
| `frontend/src/stores/interviewer.ts` (신규) | 선택 id·재생 중 id·미리 듣기 실패·깨진 스프라이트, 역할별 시트 대체 |
| `frontend/src/utils/ttsVoices.ts` (신규) | 매니페스트에서 엔진·고른 목소리 계산(순수) |
| `frontend/src/types/api.ts` | `TtsVoice`, `TtsManifest.voices` |
| `frontend/src/workers/ttsProtocol.ts`, `tts.worker.ts`, `services/tts.ts` | `setVoice` 메시지·`setTtsVoice` |
| `frontend/src/stores/model.ts` | 목소리 선택 반영(용량·캐시 키·재방문·미리 채우기·`syncVoice`·`chooseInterviewer`) |
| `frontend/src/components/InterviewerPicker.vue` (신규) | 면접관 카드 3장(선택·포커스·재생) |
| `frontend/src/views/LandingView.vue`, `PrepareView.vue` | 고르기 창, 동의 게이트, 면접관 칩·바꾸기 |
| `frontend/src/prompts/personas.ts` (신규), `interviewer.ts`, `report.ts` | 페르소나 네 자리, 리포트 말투 |
| `frontend/src/stores/interview.ts` | 면접관 스냅샷, 페르소나 적용 |
| `frontend/src/components/interview/interviewerAnims.ts`, `InterviewStage.vue`, `views/InterviewView.vue`, `views/ReportView.vue` | 가운데 스프라이트 교체, 태그 |

---

### Task 1: `voices.json` · 미리 듣기 생성 스크립트 · 목소리 결정 · OGG (PR 1)

**Files:**
- Create: `frontend/src/interviewers/voices.json`
- Create: `frontend/scripts/voice-previews/generate.py`
- Create: `frontend/scripts/voice-previews/README.md`
- Create: `frontend/public/voices/preview/gentle.ogg`, `standard.ogg`, `sharp.ogg` (스크립트 산출물)
- Test: `frontend/src/interviewers/voices.test.ts`

**Interfaces:**
- Produces: `voices.json` — `{ [id in 'gentle'|'standard'|'sharp']: { voice: string; text: string } }` (Task 2가 import). 미리 듣기 URL `/voices/preview/{id}.ogg`

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/interviewers/voices.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import voices from './voices.json'
import { SILENCE_SEC, SPEED, TOTAL_STEP } from '@/workers/ttsProtocol'

const PREVIEW = join(__dirname, '../../public/voices/preview')
const SCRIPT = join(__dirname, '../../scripts/voice-previews/generate.py')
const VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']

describe('voices.json', () => {
  it('면접관 3명(온화·기본·압박) — 기본 면접관은 지금 목소리 M2', () => {
    expect(Object.keys(voices)).toEqual(['gentle', 'standard', 'sharp'])
    expect(voices.standard.voice).toBe('M2')
  })
  it('목소리는 Supertonic 3 프리셋 10개 중 하나이고 세 면접관이 서로 다르며, 문장은 비어 있지 않다', () => {
    for (const v of Object.values(voices)) {
      expect(VOICE_IDS).toContain(v.voice)
      expect(v.text.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(Object.values(voices).map((v) => v.voice)).size).toBe(3)
  })
  it('면접관마다 미리 듣기 OGG가 있고 100KB 이하다', () => {
    for (const id of Object.keys(voices)) {
      const f = join(PREVIEW, `${id}.ogg`)
      expect(existsSync(f), f).toBe(true)
      expect(statSync(f).size).toBeLessThanOrEqual(100 * 1024)
    }
  })
  it('생성 스크립트의 합성 설정이 앱(ttsProtocol)과 같다 — 미리 듣기와 실제 목소리가 같아야 한다', () => {
    const py = readFileSync(SCRIPT, 'utf8')
    expect(py).toContain(`TOTAL_STEP = ${TOTAL_STEP}`)
    expect(py).toContain(`SPEED = ${SPEED}`)
    expect(py).toContain(`SILENCE_SEC = ${SILENCE_SEC}`)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run (`frontend/`): `pnpm test -- src/interviewers/voices.test.ts`
Expected: FAIL — `Failed to resolve import "./voices.json"`

- [ ] **Step 3: `voices.json` 작성**

`frontend/src/interviewers/voices.json`. `gentle`·`sharp`의 목소리는 **제안값**이고, Step 5에서 들어 보고 바꾼다.

```json
{
  "gentle": {
    "voice": "F1",
    "text": "안녕하세요, 오늘 면접을 맡은 선배예요. 긴장 푸시고 편하게 이야기해 주세요."
  },
  "standard": {
    "voice": "M2",
    "text": "안녕하세요, 오늘 면접을 진행하겠습니다. 준비되시면 시작하겠습니다."
  },
  "sharp": {
    "voice": "M4",
    "text": "시작하겠습니다. 답변은 근거와 수치로 구체적으로 말씀해 주세요."
  }
}
```

- [ ] **Step 4: 생성 스크립트와 README 작성**

`frontend/scripts/voice-previews/generate.py` (2026-09-26에 로컬에서 실행해 검증함: 3개 46~60KB)

```python
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
```

`frontend/scripts/voice-previews/README.md`

````markdown
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
````

- [ ] **Step 5: 목소리 후보를 듣고 결정 (사람 확인 지점)**

Run (`frontend/scripts/voice-previews/`):
`uv run --with onnxruntime==1.23.1 --with numpy --with soundfile python generate.py --supertonic <supertonic 클론> --candidates "$TEMP/momo-voice-candidates"`

Expected: `gentle_F1.ogg` … `sharp_M5.ogg` 30개 생성

@ssenu와 @leemonta9482가 들어 보고 `gentle`·`sharp`의 목소리를 정해 `voices.json`의 `voice`를 고친다. `standard`는 M2 고정이다. 결정 내용(두 목소리 ID)은 PR 본문에 적는다. 스프라이트 에셋(①)의 겉모습 성별이 이 결정을 따른다.

- [ ] **Step 6: 미리 듣기 생성 → 통과 확인**

Run: `uv run --with onnxruntime==1.23.1 --with numpy --with soundfile python generate.py --supertonic <supertonic 클론>`
Expected: `gentle.ogg`·`standard.ogg`·`sharp.ogg` 각 100KB 이하

Run (`frontend/`): `pnpm test -- src/interviewers/voices.test.ts && pnpm exec prettier --check .`
Expected: 4 passed(세 목소리가 서로 달라야 한다), prettier clean(README·JSON 포함)

- [ ] **Step 7: 커밋 · PR 1**

```bash
git add frontend/src/interviewers/voices.json frontend/src/interviewers/voices.test.ts frontend/scripts/voice-previews frontend/public/voices/preview
git commit -m "feat(frontend): 면접관 미리 듣기 OGG 3개와 생성 스크립트 — voices.json(목소리·문장 단일 원천), 앱과 같은 합성 설정"
```

PR 1 제목: `feat(frontend): 면접관 미리 듣기 에셋·생성 스크립트`. 본문에 두 목소리 결정, 파일 크기, 합성 설정 대조 테스트를 적는다. 리뷰어는 @leemonta9482다.

---

### Task 2: 면접관 정의 `src/interviewers/index.ts` (PR 2)

**Files:**
- Create: `frontend/src/interviewers/index.ts`
- Test: `frontend/src/interviewers/index.test.ts`

**Interfaces:**
- Consumes: `./voices.json` (Task 1)
- Produces:
  ```ts
  export type InterviewerId = 'gentle' | 'standard' | 'sharp'
  export type CenterRole = 'idle' | 'question' | 'nod' | 'watch' | 'lookside' | 'armscross'
  export interface CenterSheet { file: string; frames: number }
  export type CenterSprites = Record<CenterRole, CenterSheet>
  export interface Interviewer { id: InterviewerId; name: string; tagline: string; voiceId: string; preview: { text: string; src: string }; sprites: CenterSprites }
  export const CENTER_FRAMES: Record<CenterRole, number>
  export const CENTER_ROLES: CenterRole[]
  export const INTERVIEWERS: readonly Interviewer[]
  export const DEFAULT_INTERVIEWER: InterviewerId // 'standard'
  export function interviewerById(id: string | null | undefined): Interviewer | null
  ```

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/interviewers/index.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import voices from './voices.json'
import { ANIMS, type AnimName } from '@/components/interview/interviewerAnims'
import {
  CENTER_FRAMES,
  CENTER_ROLES,
  DEFAULT_INTERVIEWER,
  INTERVIEWERS,
  interviewerById,
} from './index'

const centerAnim = (r: string) => ANIMS[`center_${r}` as AnimName]

describe('interviewers', () => {
  it('3명: 온화한 선배 · 기본 면접관 · 날카로운 압박 면접관 순서, id 유일', () => {
    expect(INTERVIEWERS.map((i) => i.id)).toEqual(['gentle', 'standard', 'sharp'])
    expect(INTERVIEWERS.map((i) => i.name)).toEqual([
      '온화한 선배',
      '기본 면접관',
      '날카로운 압박 면접관',
    ])
    expect(new Set(INTERVIEWERS.map((i) => i.id)).size).toBe(3)
  })
  it('기본값은 standard이고, 지금 가운데 캐릭터(스프라이트)와 목소리 M2 그대로다', () => {
    expect(DEFAULT_INTERVIEWER).toBe('standard')
    const s = interviewerById('standard')!
    expect(s.voiceId).toBe('M2')
    for (const r of CENTER_ROLES) expect(s.sprites[r].file).toBe(centerAnim(r).file)
  })
  it('가운데 동작 프레임 수는 모든 면접관이 기존 가운데 캐릭터와 같다(타이밍 코드 재사용)', () => {
    for (const r of CENTER_ROLES) expect(CENTER_FRAMES[r]).toBe(centerAnim(r).frames)
    for (const iv of INTERVIEWERS)
      for (const r of CENTER_ROLES) expect(iv.sprites[r].frames).toBe(CENTER_FRAMES[r])
  })
  it('새 면접관 스프라이트 경로는 /sprites/interviewers/{id}/center_{role}.png', () => {
    for (const id of ['gentle', 'sharp'] as const)
      for (const r of CENTER_ROLES)
        expect(interviewerById(id)!.sprites[r].file).toBe(
          `/sprites/interviewers/${id}/center_${r}.png`,
        )
  })
  it('목소리·미리 듣기는 voices.json을 따른다', () => {
    for (const iv of INTERVIEWERS) {
      expect(iv.voiceId).toBe(voices[iv.id].voice)
      expect(iv.preview).toEqual({ text: voices[iv.id].text, src: `/voices/preview/${iv.id}.ogg` })
    }
  })
  it('interviewerById: 없는 id·null·undefined는 null', () => {
    expect(interviewerById('nope')).toBeNull()
    expect(interviewerById(null)).toBeNull()
    expect(interviewerById(undefined)).toBeNull()
  })
  it('스프라이트 에셋 폴더가 있으면 manifest.json이 규격(32×32, 프레임 수)과 같다 — 에셋 PR 전에는 건너뛴다', () => {
    for (const id of ['gentle', 'sharp']) {
      const m = join(__dirname, `../../public/sprites/interviewers/${id}/manifest.json`)
      if (!existsSync(m)) continue
      const man = JSON.parse(readFileSync(m, 'utf8')) as Record<
        string,
        { file: string; frames: number; w: number; h: number }
      >
      for (const r of CENTER_ROLES) {
        const e = man[`center_${r}`]
        expect(e, `${id}/center_${r}`).toBeDefined()
        expect(e.file).toBe(`center_${r}.png`)
        expect(e.frames).toBe(CENTER_FRAMES[r])
        expect([e.w, e.h]).toEqual([32, 32])
      }
    }
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/interviewers/index.test.ts`
Expected: FAIL — `Failed to resolve import "./index"`

- [ ] **Step 3: 구현**

`frontend/src/interviewers/index.ts`

```ts
import voices from './voices.json'

/** 면접관 정의 — 순수 데이터. 페르소나 문구는 prompts/personas.ts (spec 4.1) */
export type InterviewerId = 'gentle' | 'standard' | 'sharp'
export type CenterRole = 'idle' | 'question' | 'nod' | 'watch' | 'lookside' | 'armscross'
export interface CenterSheet {
  file: string
  frames: number
}
export type CenterSprites = Record<CenterRole, CenterSheet>
export interface Interviewer {
  id: InterviewerId
  name: string
  tagline: string
  /** manifest.tts.voices의 id */
  voiceId: string
  preview: { text: string; src: string }
  sprites: CenterSprites
}

/** 가운데 동작별 프레임 수 — 기존 center_*.png와 같다(스프라이트 규격, spec 6.2) */
export const CENTER_FRAMES: Record<CenterRole, number> = {
  idle: 15,
  question: 10,
  nod: 11,
  watch: 10,
  lookside: 10,
  armscross: 28,
}
export const CENTER_ROLES = Object.keys(CENTER_FRAMES) as CenterRole[]

const sheets = (dir: string): CenterSprites =>
  Object.fromEntries(
    CENTER_ROLES.map((r) => [r, { file: `${dir}/center_${r}.png`, frames: CENTER_FRAMES[r] }]),
  ) as CenterSprites

const make = (id: InterviewerId, name: string, tagline: string, dir: string): Interviewer => ({
  id,
  name,
  tagline,
  voiceId: voices[id].voice,
  preview: { text: voices[id].text, src: `/voices/preview/${id}.ogg` },
  sprites: sheets(dir),
})

export const INTERVIEWERS: readonly Interviewer[] = [
  make('gentle', '온화한 선배', '편하게 이야기해요', '/sprites/interviewers/gentle'),
  make('standard', '기본 면접관', '차분하게 진행합니다', '/sprites/interviewers'),
  make('sharp', '날카로운 압박 면접관', '근거를 보여 주세요', '/sprites/interviewers/sharp'),
]

export const DEFAULT_INTERVIEWER: InterviewerId = 'standard'

export function interviewerById(id: string | null | undefined): Interviewer | null {
  return INTERVIEWERS.find((iv) => iv.id === id) ?? null
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- src/interviewers && pnpm exec vue-tsc --noEmit`
Expected: PASS, 타입 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/interviewers/index.ts frontend/src/interviewers/index.test.ts
git commit -m "feat(frontend): 면접관 정의(온화·기본·압박) — 목소리·미리 듣기·가운데 스프라이트 규격"
```

---

### Task 3: 미리 듣기·스프라이트 서비스와 선택 스토어 `stores/interviewer.ts` (PR 2)

**Files:**
- Create: `frontend/src/services/preview.ts`, `frontend/src/services/sprites.ts`, `frontend/src/stores/interviewer.ts`
- Test: `frontend/src/services/preview.test.ts`, `frontend/src/stores/interviewer.test.ts`

**Interfaces:**
- Consumes: `INTERVIEWERS`, `interviewerById`, `CENTER_ROLES`, `DEFAULT_INTERVIEWER`, 타입 (Task 2)
- Produces:
  - `services/preview.ts`: `playPreview(src: string, onEnded?: () => void): Promise<boolean>` (재생 실패면 false, 다른 재생에 밀려난 경우는 true), `stopPreview(): void`, `__setAudioFactory(f: (() => HTMLAudioElement) | null): void`
  - `services/sprites.ts`: `probeImage(url: string): Promise<boolean>`
  - `stores/interviewer.ts`: `useInterviewerStore()`
    - state: `id: InterviewerId | null`, `playingId: InterviewerId | null`, `previewFailed: boolean`, `brokenFiles: string[]`
    - getters: `current: Interviewer | null`, `spritesFor(id: InterviewerId | null): CenterSprites`
    - actions: `select(id)`, `preview(id): Promise<void>`, `stopPreview()`, `probeSprites(): Promise<void>`
    - 테스트용 `__resetInterviewerProbe()`

- [ ] **Step 1: 실패하는 테스트 — 미리 듣기 서비스**

`frontend/src/services/preview.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setAudioFactory, playPreview, stopPreview } from './preview'

class FakeAudio {
  src = ''
  currentTime = 5
  onended: (() => void) | null = null
  paused = 0
  play = vi.fn(async () => undefined as void)
  pause() {
    this.paused++
  }
  end() {
    this.onended?.()
  }
}
let a: FakeAudio
beforeEach(() => {
  a = new FakeAudio()
  __setAudioFactory(() => a as unknown as HTMLAudioElement)
})
afterEach(() => __setAudioFactory(null))

describe('services/preview', () => {
  it('src를 처음부터 재생하고 성공이면 true, 끝나면 onEnded', async () => {
    const onEnded = vi.fn()
    expect(await playPreview('/voices/preview/gentle.ogg', onEnded)).toBe(true)
    expect(a.src).toBe('/voices/preview/gentle.ogg')
    expect(a.currentTime).toBe(0)
    a.end()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })
  it('새로 재생하면 이전 재생을 멈추고, 이전 onEnded는 부르지 않는다', async () => {
    const first = vi.fn()
    await playPreview('/voices/preview/gentle.ogg', first)
    const second = vi.fn()
    await playPreview('/voices/preview/sharp.ogg', second)
    expect(a.paused).toBeGreaterThanOrEqual(1)
    a.end()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
  it('play()가 거부되면 false(재생 실패)', async () => {
    a.play.mockRejectedValueOnce(new Error('NotSupportedError'))
    expect(await playPreview('/voices/preview/none.ogg')).toBe(false)
  })
  it('다른 재생에 밀려나 거부된 play()는 실패가 아니다(true)', async () => {
    let rejectFirst!: (e: unknown) => void
    a.play.mockImplementationOnce(() => new Promise<void>((_, rej) => (rejectFirst = rej)))
    const p1 = playPreview('/voices/preview/gentle.ogg')
    await playPreview('/voices/preview/sharp.ogg')
    rejectFirst(new DOMException('interrupted', 'AbortError'))
    expect(await p1).toBe(true)
  })
  it('stopPreview는 멈추고 onEnded를 부르지 않는다', async () => {
    const onEnded = vi.fn()
    await playPreview('/voices/preview/gentle.ogg', onEnded)
    stopPreview()
    a.end()
    expect(onEnded).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패하는 테스트 — 선택 스토어**

`frontend/src/stores/interviewer.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/preview', () => ({
  playPreview: vi.fn(async () => true),
  stopPreview: vi.fn(),
}))
vi.mock('@/services/sprites', () => ({ probeImage: vi.fn(async () => true) }))

import { playPreview, stopPreview } from '@/services/preview'
import { probeImage } from '@/services/sprites'
import { CENTER_ROLES, interviewerById } from '@/interviewers'
import { __resetInterviewerProbe, useInterviewerStore } from './interviewer'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  __resetInterviewerProbe()
  vi.clearAllMocks()
})

describe('stores/interviewer — 선택', () => {
  it('처음엔 선택 없음(null), select는 momo.interviewer에 기억한다', () => {
    const s = useInterviewerStore()
    expect(s.id).toBeNull()
    expect(s.current).toBeNull()
    s.select('gentle')
    expect(s.current?.name).toBe('온화한 선배')
    expect(localStorage.getItem('momo.interviewer')).toBe('gentle')
  })
  it('저장된 선택을 복원하고, 정의에 없는 값은 선택 안 됨으로 본다', () => {
    localStorage.setItem('momo.interviewer', 'sharp')
    expect(useInterviewerStore().id).toBe('sharp')
    setActivePinia(createPinia())
    localStorage.setItem('momo.interviewer', 'ghost')
    expect(useInterviewerStore().id).toBeNull()
  })
})

describe('stores/interviewer — 미리 듣기', () => {
  it('preview는 그 면접관 OGG를 재생하고 재생 중 id를 두며, 끝나면 비운다', async () => {
    let ended!: () => void
    vi.mocked(playPreview).mockImplementationOnce(async (_src, onEnded) => {
      ended = onEnded!
      return true
    })
    const s = useInterviewerStore()
    await s.preview('gentle')
    expect(playPreview).toHaveBeenCalledWith('/voices/preview/gentle.ogg', expect.any(Function))
    expect(s.playingId).toBe('gentle')
    ended()
    expect(s.playingId).toBeNull()
  })
  it('다른 면접관으로 넘어가면 앞 면접관의 끝 알림은 재생 중 id를 지우지 않는다', async () => {
    const ends: (() => void)[] = []
    vi.mocked(playPreview).mockImplementation(async (_src, onEnded) => {
      ends.push(onEnded!)
      return true
    })
    const s = useInterviewerStore()
    await s.preview('gentle')
    await s.preview('sharp')
    ends[0]()
    expect(s.playingId).toBe('sharp')
  })
  it('재생 실패면 previewFailed, 재생 중 id는 비운다', async () => {
    vi.mocked(playPreview).mockResolvedValueOnce(false)
    const s = useInterviewerStore()
    await s.preview('sharp')
    expect(s.previewFailed).toBe(true)
    expect(s.playingId).toBeNull()
  })
  it('stopPreview는 서비스를 멈추고 재생 중 id를 비운다', async () => {
    const s = useInterviewerStore()
    await s.preview('gentle')
    s.stopPreview()
    expect(stopPreview).toHaveBeenCalled()
    expect(s.playingId).toBeNull()
  })
})

describe('stores/interviewer — 스프라이트 대체', () => {
  it('probeSprites는 새 면접관 파일만 한 번 확인한다(기본 면접관 제외, 두 번 불러도 한 번)', async () => {
    const s = useInterviewerStore()
    await Promise.all([s.probeSprites(), s.probeSprites()])
    expect(probeImage).toHaveBeenCalledTimes(2 * CENTER_ROLES.length)
    expect(vi.mocked(probeImage).mock.calls.every(([u]) => !u.startsWith('/sprites/interviewers/center_'))).toBe(true)
  })
  it('안 뜨는 파일의 역할만 기본 면접관 시트로 바꾼다', async () => {
    vi.mocked(probeImage).mockImplementation(async (u) => !u.endsWith('gentle/center_nod.png'))
    const s = useInterviewerStore()
    await s.probeSprites()
    const sp = s.spritesFor('gentle')
    expect(sp.nod).toEqual(interviewerById('standard')!.sprites.nod)
    expect(sp.idle.file).toBe('/sprites/interviewers/gentle/center_idle.png')
  })
  it('spritesFor(null)은 기본 면접관 시트', () => {
    expect(useInterviewerStore().spritesFor(null)).toEqual(interviewerById('standard')!.sprites)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test -- src/services/preview.test.ts src/stores/interviewer.test.ts`
Expected: FAIL — 두 모듈을 찾을 수 없음

- [ ] **Step 4: 구현**

`frontend/src/services/preview.ts`

```ts
/**
 * 면접관 미리 듣기 — HTMLAudioElement 하나로 정적 OGG를 재생한다.
 * TTS 엔진·AudioContext·음소거(momo.muted)와 무관하게 호출되면 항상 소리를 낸다(spec 3.1·4.4).
 * 클릭 핸들러 안에서 불리므로 자동 재생 제한에 걸리지 않는다.
 */
let factory: () => HTMLAudioElement = () => new Audio()
let audio: HTMLAudioElement | null = null
let token = 0

/** 테스트에서 가짜 오디오를 꽂는다. null이면 실제 Audio */
export function __setAudioFactory(f: (() => HTMLAudioElement) | null): void {
  factory = f ?? (() => new Audio())
  audio = null
}

/** 재생 실패(파일 없음·디코딩 실패·거부)면 false. 다른 재생에 밀려나 거부된 경우는 실패가 아니다(true) */
export async function playPreview(src: string, onEnded?: () => void): Promise<boolean> {
  stopPreview()
  const my = ++token
  const a = (audio ??= factory())
  a.src = src
  a.currentTime = 0
  a.onended = () => {
    if (my === token) onEnded?.()
  }
  try {
    await a.play()
    return true
  } catch {
    return my !== token
  }
}

export function stopPreview(): void {
  token++
  if (!audio) return
  audio.onended = null
  audio.pause()
}
```

`frontend/src/services/sprites.ts`

```ts
/** 스프라이트 이미지가 실제로 뜨는지 확인한다(없는 파일·깨진 PNG면 false) */
export function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 0)
    img.onerror = () => resolve(false)
    img.src = url
  })
}
```

`frontend/src/stores/interviewer.ts`

```ts
import { defineStore } from 'pinia'
import {
  CENTER_ROLES,
  DEFAULT_INTERVIEWER,
  INTERVIEWERS,
  interviewerById,
  type CenterSprites,
  type Interviewer,
  type InterviewerId,
} from '@/interviewers'
import { playPreview, stopPreview } from '@/services/preview'
import { probeImage } from '@/services/sprites'

/** 고른 면접관(spec 4.2). 기존 momo.voice·momo.muted와 같은 방식으로 기억한다 */
const KEY = 'momo.interviewer'
function loadId(): InterviewerId | null {
  try {
    return interviewerById(localStorage.getItem(KEY))?.id ?? null
  } catch {
    return null
  }
}
let probing: Promise<void> | null = null
/** 테스트용: 스프라이트 확인을 다시 하게 한다 */
export function __resetInterviewerProbe(): void {
  probing = null
}

export const useInterviewerStore = defineStore('interviewer', {
  state: () => ({
    id: loadId(),
    /** 미리 듣기 재생 중인 면접관 — Picker가 이 캐릭터를 question 제스처로 바꾼다 */
    playingId: null as InterviewerId | null,
    previewFailed: false,
    /** 안 뜨는 스프라이트 파일(새 면접관 에셋이 아직 없을 때) */
    brokenFiles: [] as string[],
  }),
  getters: {
    current: (s): Interviewer | null => interviewerById(s.id),
    /** 역할별 시트. 새 면접관 파일이 안 뜨면 그 역할만 기본 면접관 시트로(spec 7절) */
    spritesFor:
      (s) =>
      (id: InterviewerId | null): CenterSprites => {
        const base = interviewerById(DEFAULT_INTERVIEWER)!.sprites
        const iv = interviewerById(id) ?? interviewerById(DEFAULT_INTERVIEWER)!
        return Object.fromEntries(
          CENTER_ROLES.map((r) => [
            r,
            s.brokenFiles.includes(iv.sprites[r].file) ? base[r] : iv.sprites[r],
          ]),
        ) as CenterSprites
      },
  },
  actions: {
    select(id: InterviewerId) {
      this.id = id
      try {
        localStorage.setItem(KEY, id)
      } catch {
        /* 사생활 모드 등 — 이번 세션만 유지 */
      }
    },
    /** 미리 듣기: 음소거와 무관하게 항상 재생한다(spec 3.1) */
    async preview(id: InterviewerId) {
      const iv = interviewerById(id)
      if (!iv) return
      this.previewFailed = false
      this.playingId = id
      const ok = await playPreview(iv.preview.src, () => {
        if (this.playingId === id) this.playingId = null
      })
      if (!ok) {
        if (this.playingId === id) this.playingId = null
        this.previewFailed = true
      }
    },
    stopPreview() {
      stopPreview()
      this.playingId = null
    },
    /** 새 면접관 스프라이트가 뜨는지 한 번만 확인한다(기본 면접관 파일은 이미 쓰고 있으니 제외) */
    probeSprites(): Promise<void> {
      probing ??= (async () => {
        const files = INTERVIEWERS.filter((iv) => iv.id !== DEFAULT_INTERVIEWER).flatMap((iv) =>
          CENTER_ROLES.map((r) => iv.sprites[r].file),
        )
        const results = await Promise.all(files.map(async (f) => [f, await probeImage(f)] as const))
        this.brokenFiles = results.filter(([, ok]) => !ok).map(([f]) => f)
      })()
      return probing
    },
  },
})
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test -- src/services/preview.test.ts src/stores/interviewer.test.ts && pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: PASS, 타입·린트 clean

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/services/preview.ts frontend/src/services/preview.test.ts frontend/src/services/sprites.ts frontend/src/stores/interviewer.ts frontend/src/stores/interviewer.test.ts
git commit -m "feat(frontend): 면접관 선택 스토어·미리 듣기 서비스(음소거 무관 항상 재생)·스프라이트 대체"
```

---

### Task 4: `utils/ttsVoices.ts` — 엔진 + 고른 목소리 계산 (PR 2)

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/utils/ttsVoices.ts`
- Test: `frontend/src/utils/ttsVoices.test.ts`

**Interfaces:**
- Produces:
  - `types/api.ts`: `export interface TtsVoice { id: string; path: string; size: number }`, `TtsManifest.voices?: TtsVoice[] | null`
  - `engineFiles(tts: TtsManifest): TtsFile[]`
  - `pickVoice(tts: TtsManifest, voiceId: string | null): TtsVoice | null` — `voices`가 없으면 null
  - `resolveTts(tts: TtsManifest, voiceId: string | null): TtsManifest` — `voices`가 없으면 **원본 객체 그대로**. 있으면 `{ ...tts, voice, files: [...엔진, 목소리 파일] }`(목소리 파일은 **맨 뒤**)
  - `voiceFiles(tts: TtsManifest): TtsFile[]` — `voices` 전부(없으면 [])

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/utils/ttsVoices.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import type { TtsManifest } from '@/types/api'
import { engineFiles, pickVoice, resolveTts, voiceFiles } from './ttsVoices'

const base: TtsManifest = {
  id: 'supertonic-3',
  baseUrl: 'https://huggingface.co/x/resolve/abc/',
  files: [
    { path: 'onnx/a.onnx', size: 60 },
    { path: 'onnx/tts.json', size: 30 },
    { path: 'voice_styles/M2.json', size: 10 },
  ],
  voice: 'M2',
  lang: 'ko',
}
const withVoices: TtsManifest = {
  ...base,
  voices: [
    { id: 'F1', path: 'voice_styles/F1.json', size: 11 },
    { id: 'M2', path: 'voice_styles/M2.json', size: 10 },
    { id: 'M4', path: 'voice_styles/M4.json', size: 12 },
  ],
}

describe('ttsVoices', () => {
  it('voices가 없으면(옛 매니페스트) 엔진 = files 전체, 목소리 선택 없음, 원본 그대로', () => {
    expect(engineFiles(base)).toEqual(base.files)
    expect(pickVoice(base, 'F1')).toBeNull()
    expect(resolveTts(base, 'F1')).toBe(base)
    expect(voiceFiles(base)).toEqual([])
  })
  it('엔진 = files 중 voices 경로가 아닌 것', () => {
    expect(engineFiles(withVoices).map((f) => f.path)).toEqual(['onnx/a.onnx', 'onnx/tts.json'])
  })
  it('고른 목소리가 목록에 있으면 그것, 없거나 null이면 기본 voice', () => {
    expect(pickVoice(withVoices, 'M4')?.id).toBe('M4')
    expect(pickVoice(withVoices, 'Z9')?.id).toBe('M2')
    expect(pickVoice(withVoices, null)?.id).toBe('M2')
  })
  it('resolveTts: 엔진 + 고른 목소리 파일(맨 뒤), voice는 고른 id', () => {
    const r = resolveTts(withVoices, 'F1')
    expect(r.voice).toBe('F1')
    expect(r.files).toEqual([
      { path: 'onnx/a.onnx', size: 60 },
      { path: 'onnx/tts.json', size: 30 },
      { path: 'voice_styles/F1.json', size: 11 },
    ])
    expect(r.baseUrl).toBe(withVoices.baseUrl)
    expect(r.id).toBe('supertonic-3')
  })
  it('voiceFiles는 목소리 전부(캐시 정리에서 남길 대상)', () => {
    expect(voiceFiles(withVoices).map((f) => f.path)).toEqual([
      'voice_styles/F1.json',
      'voice_styles/M2.json',
      'voice_styles/M4.json',
    ])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/utils/ttsVoices.test.ts`
Expected: FAIL — `./ttsVoices`를 찾을 수 없음(그리고 `voices` 타입 오류)

- [ ] **Step 3: 구현**

`frontend/src/types/api.ts` — `TtsFile` 아래에 `TtsVoice`를 추가하고 `TtsManifest`에 `voices`를 넣는다.

```ts
/** 받을 수 있는 목소리 하나(docs/API.md tts.voices, 2026-09-26). 파일 URL = baseUrl + path */
export interface TtsVoice {
  id: string
  path: string
  size: number
}

/** /api/manifest의 tts (docs/API.md). null이면 음성 단계 없음 */
export interface TtsManifest {
  id: string
  baseUrl: string
  files: TtsFile[]
  voice: string
  lang: string
  /** 없으면(옛 매니페스트) 기본 voice만 쓴다. 엔진 = files − voices 경로 */
  voices?: TtsVoice[] | null
}
```

`frontend/src/utils/ttsVoices.ts`

```ts
import type { TtsFile, TtsManifest, TtsVoice } from '@/types/api'

/** 엔진 파일 = files 중 경로가 voices에 없는 것. voices가 없으면 files 전체(옛 매니페스트) */
export function engineFiles(tts: TtsManifest): TtsFile[] {
  if (!tts.voices?.length) return tts.files
  const voicePaths = new Set(tts.voices.map((v) => v.path))
  return tts.files.filter((f) => !voicePaths.has(f.path))
}

/** 고른 목소리. 목록에 없거나 null이면 기본 voice. voices가 없으면 null(목소리 파일은 files 안에 있다) */
export function pickVoice(tts: TtsManifest, voiceId: string | null): TtsVoice | null {
  if (!tts.voices?.length) return null
  return (
    tts.voices.find((v) => v.id === voiceId) ?? tts.voices.find((v) => v.id === tts.voice) ?? null
  )
}

/** 워커에 넘길 TTS 설정: 엔진 + 고른 목소리 하나(맨 뒤), voice = 고른 id. voices가 없으면 원본 그대로 */
export function resolveTts(tts: TtsManifest, voiceId: string | null): TtsManifest {
  const v = pickVoice(tts, voiceId)
  if (!v) return tts
  return { ...tts, voice: v.id, files: [...engineFiles(tts), { path: v.path, size: v.size }] }
}

/** 캐시 정리에서 남길 목소리 파일 전부 — 한 번 받은 목소리는 지우지 않는다 */
export function voiceFiles(tts: TtsManifest): TtsFile[] {
  return (tts.voices ?? []).map((v) => ({ path: v.path, size: v.size }))
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- src/utils/ttsVoices.test.ts && pnpm exec vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/types/api.ts frontend/src/utils/ttsVoices.ts frontend/src/utils/ttsVoices.test.ts
git commit -m "feat(frontend): 매니페스트 tts.voices 소비 — 엔진 + 고른 목소리 계산(voices 없으면 원본 그대로)"
```

---

### Task 5: TTS 서비스·워커 `setVoice` (PR 2)

**Files:**
- Modify: `frontend/src/workers/ttsProtocol.ts`, `frontend/src/services/tts.ts`, `frontend/src/workers/tts.worker.ts`
- Test: `frontend/src/services/tts.test.ts`

**Interfaces:**
- Produces:
  - `MainToWorker`에 `{ type: 'setVoice'; voice: string; file: TtsLoadFile }` 추가
  - `WorkerToMain`에 `{ type: 'voiceSet'; voice: string }`, `{ type: 'voiceError'; voice: string; message: string }` 추가
  - `services/tts.ts`: `setTtsVoice(voice: string, file: TtsLoadFile): Promise<void>`
    - 로드 전이면 `not loaded`로 거부한다.
    - 새 요청이 오면 이전 요청을 `superseded`로 거부한다.
    - `voiceError`면 거부하되 워커는 살려 둔다(이전 목소리로 계속 합성).
    - dispose·워커 오류면 거부한다.

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/services/tts.test.ts` — import 줄에 `setTtsVoice`를 추가하고(`import { __setWorkerFactory, disposeTts, initTts, setTtsVoice, synthesize } from './tts'`) 맨 아래에 다음을 붙인다(파일 안의 `FakeWorker`, `startInit`, `w`를 그대로 쓴다).

```ts
const voiceFile = {
  path: 'voice_styles/F1.json',
  size: 11,
  url: '/models/tts/supertonic-3/voice_styles/F1.json',
  cacheKey: '/models-cache/supertonic-3/models/tts/supertonic-3/voice_styles/F1.json',
}
async function loadedWorker() {
  const { p } = await startInit()
  w.reply({ type: 'loaded' })
  await p
  return w
}

describe('setTtsVoice', () => {
  it('로드 전이면 거부한다', async () => {
    await expect(setTtsVoice('F1', voiceFile)).rejects.toThrow('not loaded')
  })
  it('워커에 setVoice를 보내고 voiceSet이면 끝난다', async () => {
    const worker = await loadedWorker()
    const p = setTtsVoice('F1', voiceFile)
    expect(worker.sent.at(-1)).toEqual({ type: 'setVoice', voice: 'F1', file: voiceFile })
    worker.reply({ type: 'voiceSet', voice: 'F1' })
    await expect(p).resolves.toBeUndefined()
  })
  it('voiceError면 거부하지만 워커는 살아 있고 합성은 계속된다', async () => {
    const worker = await loadedWorker()
    const p = setTtsVoice('F1', voiceFile)
    worker.reply({ type: 'voiceError', voice: 'F1', message: 'bad style' })
    await expect(p).rejects.toThrow('bad style')
    expect(worker.terminated).toBe(false)
    const s = synthesize('안녕하세요')
    const id = (worker.sent.at(-1) as { id: number }).id
    worker.reply({ type: 'audio', id, samples: new Float32Array(10), sampleRate: 10 })
    await expect(s).resolves.toMatchObject({ durationMs: 1000 })
  })
  it('새 setTtsVoice가 오면 이전 요청은 superseded로 거부된다', async () => {
    const worker = await loadedWorker()
    const first = setTtsVoice('F1', voiceFile)
    const second = setTtsVoice('M4', { ...voiceFile, path: 'voice_styles/M4.json' })
    await expect(first).rejects.toThrow('superseded')
    worker.reply({ type: 'voiceSet', voice: 'M4' })
    await expect(second).resolves.toBeUndefined()
  })
  it('disposeTts는 대기 중인 setTtsVoice를 거부한다', async () => {
    await loadedWorker()
    const p = setTtsVoice('F1', voiceFile)
    disposeTts()
    await expect(p).rejects.toThrow('disposed')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/services/tts.test.ts`
Expected: FAIL — `setTtsVoice is not a function`(그리고 프로토콜 타입 오류)

- [ ] **Step 3: 프로토콜 추가**

`frontend/src/workers/ttsProtocol.ts`의 두 유니온에 항목을 추가한다.

```ts
export type MainToWorker =
  | {
      type: 'load'
      baseUrl: string
      files: TtsLoadFile[]
      voice: string
      lang: string
      wasmPaths: string
    }
  | { type: 'synthesize'; id: number; text: string }
  | { type: 'cancel'; id: number }
  /** 면접관을 바꿀 때: 목소리 JSON만 다시 읽어 스타일을 교체한다. ONNX 세션은 그대로 둔다 */
  | { type: 'setVoice'; voice: string; file: TtsLoadFile }

export type WorkerToMain =
  | { type: 'loaded' }
  | { type: 'progress'; stage: string }
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number }
  | { type: 'error'; id?: number; message: string }
  | { type: 'voiceSet'; voice: string }
  | { type: 'voiceError'; voice: string; message: string }
```

- [ ] **Step 4: 서비스 구현**

`frontend/src/services/tts.ts`
- `pending` 선언 아래에 목소리 대기 상태를 추가한다.
- `fail()`이 목소리 대기도 거부하게 한다.
- `onmessage`에 두 분기를 추가한다.
- `setTtsVoice`를 export한다.

```ts
/** 진행 중인 setTtsVoice. 새 요청·dispose·워커 오류면 거부한다 */
let voicePending: { resolve: () => void; reject: (e: unknown) => void } | null = null
function failVoice(e: unknown) {
  voicePending?.reject(e)
  voicePending = null
}

function fail(e: unknown) {
  for (const p of pending.values()) p.reject(e)
  pending.clear()
  failVoice(e)
}
```

`w.onmessage` 안의 `else if (m.type === 'audio') { … }` 뒤에 추가한다.

```ts
          } else if (m.type === 'voiceSet') {
            voicePending?.resolve()
            voicePending = null
          } else if (m.type === 'voiceError') {
            failVoice(new Error(m.message)) // 워커는 이전 목소리로 살아 있다 — 종료하지 않는다
          }
```

파일 끝 `disposeTts` 위에 추가한다.

```ts
/** 준비된 워커의 목소리만 바꾼다(spec 4.3). 이전 목소리 요청은 superseded로 거부한다 */
export function setTtsVoice(voice: string, file: TtsLoadFile): Promise<void> {
  if (!worker || !loaded)
    return Promise.reject(new Error('TTS가 초기화되지 않았습니다 (not loaded)'))
  failVoice(new Error('TTS voice superseded'))
  const w = worker
  return new Promise<void>((resolve, reject) => {
    voicePending = { resolve, reject }
    w.postMessage({ type: 'setVoice', voice, file } satisfies MainToWorker)
  })
}
```

import 줄은 이미 `type MainToWorker, TtsLoadFile, WorkerToMain`을 가져온다(변경 없음).

- [ ] **Step 5: 워커 구현**

`frontend/src/workers/tts.worker.ts`
- 스타일 로드를 함수로 뺀다.
- `load()`가 그 함수를 쓰게 한다.
- `setVoice`를 합성 큐로 직렬화한다. 이미 큐에 있는 합성은 옛 목소리로 끝난다.

`byPath` 함수 아래에 추가한다.

```ts
type StyleJson = {
  style_ttl: { dims: number[]; data: number[][][] }
  style_dp: { dims: number[]; data: number[][][] }
}
/** 목소리 JSON → 스타일 텐서 2개 */
async function loadStyle(f: TtsLoadFile): Promise<Style> {
  const vs = (await (await fetchFile(f)).json()) as StyleJson
  const flat = (d: number[][][]) => Float32Array.from(d.flat(2))
  return {
    ttl: new ort.Tensor('float32', flat(vs.style_ttl.data), [
      1,
      vs.style_ttl.dims[1],
      vs.style_ttl.dims[2],
    ]),
    dp: new ort.Tensor('float32', flat(vs.style_dp.data), [
      1,
      vs.style_dp.dims[1],
      vs.style_dp.dims[2],
    ]),
  }
}
```

`load()` 안에서 `const vs = …`부터 `style = { … }`까지를 다음 한 줄로 바꾼다.

```ts
  style = await loadStyle(byPath(msg.files, `voice_styles/${msg.voice}.json`))
```

`self.onmessage`에서 `cancel` 분기 뒤에 추가한다.

```ts
  if (m.type === 'setVoice') {
    // 합성과 같은 큐로 직렬화: 이미 들어온 합성은 옛 목소리로 끝나고, 그 뒤부터 새 목소리
    queue = queue.then(async () => {
      try {
        style = await loadStyle(m.file)
        post({ type: 'voiceSet', voice: m.voice })
      } catch (err) {
        post({
          type: 'voiceError',
          voice: m.voice,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })
    return
  }
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm test -- src/services/tts.test.ts && pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: PASS(기존 initTts·synthesize 테스트 포함). 워커는 GPU라 CI 테스트가 없고, 타입 검사와 Task 12의 수동 확인으로 검증한다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/workers/ttsProtocol.ts frontend/src/workers/tts.worker.ts frontend/src/services/tts.ts frontend/src/services/tts.test.ts
git commit -m "feat(frontend): TTS 워커 setVoice — 목소리 JSON만 교체(세션 유지, 합성 큐 직렬화), setTtsVoice"
```

---

### Task 6: 모델 스토어 — 목소리 선택·캐시·재방문·진행률·`chooseInterviewer` (PR 2)

**Files:**
- Modify: `frontend/src/stores/model.ts`
- Test: `frontend/src/stores/model.test.ts`

**Interfaces:**
- Consumes: `useInterviewerStore` (Task 3), `resolveTts`·`pickVoice`·`voiceFiles` (Task 4), `setTtsVoice` (Task 5), `DEFAULT_INTERVIEWER`·`InterviewerId` (Task 2)
- Produces (모델 스토어):
  - state: `voiceCached: boolean | null`, `loadedVoice: string | null`, `voiceSwitching: boolean`, `voiceError: string | null`
  - getters
    - `wantedVoiceId: string | null`
    - `ttsSelection: TtsManifest | null` — 엔진 + 고른 목소리. 목소리 체크(`voiceWanted`)와 무관
    - `ttsSelectionSize: number`
    - `ttsVoiceSize: number`
    - `ttsSize` — 이제 `ttsSelectionSize` 기준
    - `ready` — `voiceSwitching` 중이면 false
  - actions
    - `checkVoiceCached()`
    - `syncVoice(): Promise<boolean>`
    - `chooseInterviewer(id: InterviewerId): Promise<void>`

- [ ] **Step 1: 기존 mock에 `setTtsVoice` 추가**

`frontend/src/stores/model.test.ts` 맨 위 `vi.mock('@/services/tts', …)`를 다음으로 바꾸고, import 줄에 `setTtsVoice`를 추가한다.

```ts
vi.mock('@/services/tts', () => ({
  initTts: vi.fn(),
  synthesize: vi.fn(),
  disposeTts: vi.fn(),
  setTtsVoice: vi.fn(async () => {}),
}))
```

```ts
import { disposeTts, initTts, setTtsVoice, synthesize } from '@/services/tts'
```

- [ ] **Step 2: 실패하는 테스트**

`frontend/src/stores/model.test.ts` 맨 아래에 추가한다. 목소리 ID는 `voices.json` 결정값을 따르므로 `interviewerById`에서 읽는다(하드코딩 금지).

```ts
import { interviewerById } from '@/interviewers'
import { useInterviewerStore } from './interviewer'

const VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']
/** 엔진 90 + 목소리(10 + 순번). M2 = 16 */
const ttsV = {
  id: 'supertonic-3',
  baseUrl: '/models/tts/supertonic-3/',
  files: [
    { path: 'onnx/a.onnx', size: 60 },
    { path: 'onnx/b.onnx', size: 30 },
    { path: 'voice_styles/M2.json', size: 16 },
  ],
  voice: 'M2',
  lang: 'ko',
  voices: VOICE_IDS.map((id, i) => ({ id, path: `voice_styles/${id}.json`, size: 10 + i })),
}
const voiceSize = (id: string) => ttsV.voices.find((v) => v.id === id)!.size
const gentleVoice = () => interviewerById('gentle')!.voiceId
const sharpVoice = () => interviewerById('sharp')!.voiceId

describe('model store — 면접관 목소리 (tts.voices)', () => {
  beforeEach(() => vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: ttsV }))

  it('선택이 없으면 기본 목소리(M2): 엔진 + M2, ttsSize = 90 + 16', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(s.ttsSelection?.voice).toBe('M2')
    expect(s.ttsSelection?.files.map((f) => f.path)).toEqual([
      'onnx/a.onnx',
      'onnx/b.onnx',
      'voice_styles/M2.json',
    ])
    expect(s.ttsSize).toBe(106)
    expect(s.ttsVoiceSize).toBe(16)
  })
  it('면접관을 고르면 그 목소리 파일로 바뀌고 용량도 따라간다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.chooseInterviewer('gentle')
    expect(s.ttsSelection?.voice).toBe(gentleVoice())
    expect(s.ttsSelection?.files.at(-1)?.path).toBe(`voice_styles/${gentleVoice()}.json`)
    expect(s.ttsSize).toBe(90 + voiceSize(gentleVoice()))
  })
  it('initTts에는 엔진 + 고른 목소리만 넘긴다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.chooseInterviewer('sharp')
    await s.download()
    const cfg = vi.mocked(initTts).mock.calls[0][0]
    expect(cfg.voice).toBe(sharpVoice())
    expect(cfg.files.map((f) => f.path)).toEqual([
      'onnx/a.onnx',
      'onnx/b.onnx',
      `voice_styles/${sharpVoice()}.json`,
    ])
  })
  it('캐시 정리는 목소리 10개를 모두 남긴다(중복 없이)', async () => {
    const s = useModelStore()
    await s.loadManifest()
    const keys = vi.mocked(pruneModels).mock.calls[0][0]
    for (const id of VOICE_IDS)
      expect(keys).toContain(`/models-cache/supertonic-3/models/tts/supertonic-3/voice_styles/${id}.json`)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('재방문 판정은 모델 + 엔진만 본다: 고른 목소리가 없어도 cached=true, voiceCached=false', async () => {
    localStorage.setItem('momo.interviewer', 'gentle')
    vi.mocked(hasModel).mockImplementation(async (_id, url) => !url.includes('voice_styles/'))
    const s = useModelStore()
    await s.loadManifest()
    expect(s.cached).toBe(true)
    expect(s.voiceCached).toBe(false)
  })
  it('재방문 + 고른 목소리 없음: 진행률은 엔진까지만 미리 채워 100% 미만에서 시작하고, 받으면 100%', async () => {
    localStorage.setItem('momo.interviewer', 'gentle')
    vi.mocked(hasModel).mockImplementation(async (_id, url) => !url.includes('voice_styles/'))
    let finish!: () => void
    vi.mocked(initTts).mockImplementation(async (cfg, onProgress) => {
      const total = cfg.files.reduce((n, f) => n + f.size, 0)
      onProgress?.(60, total) // 캐시 히트 파일도 누적으로 보고된다 — 뒤로 가면 안 된다
      await new Promise<void>((r) => (finish = r))
      onProgress?.(total, total)
    })
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    expect(s.ttsReceived).toBe(90) // 엔진만
    expect(s.overallProgress).toBeLessThan(100)
    await vi.waitFor(() => expect(initTts).toHaveBeenCalled())
    expect(s.ttsReceived).toBe(90) // 60을 보고받아도 뒤로 가지 않는다
    finish()
    await p
    expect(s.overallProgress).toBe(100)
  })
  it('재방문 + 목소리까지 캐시: 100%에서 시작', async () => {
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    void s.download()
    expect(s.ttsReceived).toBe(106)
  })
  it('재방문인데 저장된 선택이 없으면 기본 면접관을 자동 선택한다', async () => {
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    expect(useInterviewerStore().id).toBe('standard')
  })
  it('첫 방문(캐시 없음)이면 자동 선택하지 않는다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(useInterviewerStore().id).toBeNull()
  })
  it('TTS가 준비된 뒤 면접관을 바꾸면 목소리 파일만 받아 setTtsVoice로 교체한다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.loadedVoice).toBe('M2')
    vi.mocked(downloadModel).mockClear()
    await s.chooseInterviewer('gentle')
    const url = `/models/tts/supertonic-3/voice_styles/${gentleVoice()}.json`
    expect(downloadModel).toHaveBeenCalledWith(
      'supertonic-3',
      url,
      voiceSize(gentleVoice()),
      expect.any(Function),
    )
    expect(setTtsVoice).toHaveBeenCalledWith(gentleVoice(), {
      path: `voice_styles/${gentleVoice()}.json`,
      size: voiceSize(gentleVoice()),
      url,
      cacheKey: `/models-cache/supertonic-3${url}`,
    })
    expect(s.loadedVoice).toBe(gentleVoice())
    expect(s.ready).toBe(true)
  })
  it('바꾸는 동안에는 ready가 false', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    let release!: () => void
    vi.mocked(setTtsVoice).mockReturnValueOnce(new Promise<void>((r) => (release = r)))
    const p = s.chooseInterviewer('gentle')
    await vi.waitFor(() => expect(s.voiceSwitching).toBe(true))
    expect(s.ready).toBe(false)
    release()
    await p
    expect(s.ready).toBe(true)
  })
  it('교체에 실패하면 이전 목소리를 유지하고 선택도 되돌린다(voiceError)', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.chooseInterviewer('standard')
    await s.download()
    vi.mocked(setTtsVoice).mockRejectedValueOnce(new Error('bad style'))
    await s.chooseInterviewer('sharp')
    expect(s.loadedVoice).toBe('M2')
    expect(s.voiceError).toContain('bad style')
    expect(useInterviewerStore().id).toBe('standard')
  })
  it('텍스트 전용(목소리 해제)이면 면접관을 바꿔도 목소리 교체를 하지 않는다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    s.setVoiceWanted(false)
    await s.download()
    await s.chooseInterviewer('gentle')
    expect(setTtsVoice).not.toHaveBeenCalled()
  })
  it('TTS 로딩 중에 면접관을 바꾸면 로딩이 끝난 뒤 새 목소리로 맞춘다', async () => {
    let release!: () => void
    vi.mocked(initTts).mockReturnValueOnce(new Promise<void>((r) => (release = r)))
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    await vi.waitFor(() => expect(s.ttsStatus).toBe('initializing'))
    await s.chooseInterviewer('sharp')
    expect(setTtsVoice).not.toHaveBeenCalled()
    release()
    await p
    expect(setTtsVoice).toHaveBeenCalledWith(sharpVoice(), expect.anything())
    expect(s.loadedVoice).toBe(sharpVoice())
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test -- src/stores/model.test.ts`
Expected: 새 describe의 테스트들이 FAIL(`chooseInterviewer is not a function`, `ttsSelection` undefined 등). 기존 테스트는 PASS.

- [ ] **Step 4: 구현**

`frontend/src/stores/model.ts`

import에 추가한다.

```ts
import { disposeTts, initTts, setTtsVoice, synthesize } from '@/services/tts'
import type { Manifest, ModelRef, TtsManifest } from '@/types/api'
import { pickVoice, resolveTts, voiceFiles } from '@/utils/ttsVoices'
import { DEFAULT_INTERVIEWER, type InterviewerId } from '@/interviewers'
import { useInterviewerStore } from './interviewer'
```

`currentCacheKeys`를 교체한다(목소리 10개 포함, 중복 제거).

```ts
/** 현재 매니페스트가 가리키는 파일들의 캐시 키(모델·폴백·TTS 파일·목소리 전부). 한 번 받은 목소리는 남긴다 */
function currentCacheKeys(m: Manifest): string[] {
  const keys = [cacheKey(m.id, m.url)]
  if (m.fallback) keys.push(cacheKey(m.fallback.id, m.fallback.url))
  if (m.tts)
    for (const f of [...m.tts.files, ...voiceFiles(m.tts)])
      keys.push(cacheKey(m.tts.id, m.tts.baseUrl + f.path))
  return [...new Set(keys)]
}
```

state에 추가한다(`modelCached` 아래).

```ts
    /** 고른 목소리 파일이 캐시에 있는지 — 재방문 판정(cached)과 별개. 진행률 미리 채우기에만 쓴다 */
    voiceCached: null as boolean | null,
    /** 워커가 지금 쓰는 목소리 id */
    loadedVoice: null as string | null,
    /** 면접관을 바꿔 목소리를 교체하는 중 — 이 동안은 면접을 시작하지 않는다 */
    voiceSwitching: false,
    voiceError: null as string | null,
```

getters에서 `ttsSize`를 교체하고 새 getter를 추가한다.

```ts
    /** 고른 면접관의 목소리 id. 선택이 없으면 null → 매니페스트 기본 목소리 */
    wantedVoiceId(): string | null {
      return useInterviewerStore().current?.voiceId ?? null
    },
    /** 받을 TTS 설정(엔진 + 고른 목소리). 목소리 체크(voiceWanted)와 무관 — 동의 창 행 표시에도 쓴다 */
    ttsSelection(): TtsManifest | null {
      const t = this.manifest?.tts
      return t ? resolveTts(t, this.wantedVoiceId) : null
    },
    ttsSelectionSize(): number {
      return this.ttsSelection?.files.reduce((n, f) => n + f.size, 0) ?? 0
    },
    /** 고른 목소리 파일 크기. voices가 없으면 0(목소리 파일이 엔진 목록에 들어 있다) */
    ttsVoiceSize(): number {
      const t = this.manifest?.tts
      return t ? (pickVoice(t, this.wantedVoiceId)?.size ?? 0) : 0
    },
    /** 받을 TTS 합계(바이트). 목소리 해제면 0 — 동의 창·전체 진행률용 */
    ttsSize(): number {
      return this.ttsEnabled ? this.ttsSelectionSize : 0
    },
```

`ready`를 교체한다.

```ts
    /** 면접을 시작할 수 있는 상태: Gemma ready + (TTS가 있으면) TTS ready + 목소리 교체 중이 아님 */
    ready(): boolean {
      return (
        this.status === 'ready' &&
        (!this.ttsEnabled || this.ttsStatus === 'ready') &&
        !this.voiceSwitching
      )
    },
```

`loadManifest`의 `await this.checkCached()` 뒤에 추가한다.

```ts
        // 이 기능 배포 전에 모델을 받아 둔 사용자: 선택 저장값이 없으면 기본 면접관(M2 — 이미 캐시에 있다) (spec 3.3)
        const iv = useInterviewerStore()
        if (this.cached && !iv.id) {
          iv.select(DEFAULT_INTERVIEWER)
          await this.checkVoiceCached()
        }
```

`download()`의 `if (this.cached) this.ttsReceived = this.ttsSize`를 교체한다.

```ts
      // TTS는 실제로 캐시에 있는 만큼만 미리 채운다 — 고른 목소리가 없으면 그 몫은 실제 수신으로(spec 4.3)
      if (this.cached)
        this.ttsReceived = this.ttsEnabled
          ? this.ttsSize - (this.voiceCached ? 0 : this.ttsVoiceSize)
          : 0
```

`loadTts()`에서 다음을 바꾼다.
- 첫 줄: `const cfg = this.ttsEnabled ? this.ttsSelection : null`
- tick: `const tick = throttled(this.ttsTotal, (r) => (this.ttsReceived = Math.max(this.ttsReceived, r)))` — 미리 채운 값에서 뒤로 가지 않는다(캐시 히트 파일도 initTts가 0부터 누적 보고한다)
- 워밍업 뒤 `this.ttsStatus = 'ready'`를 다음으로 바꾼다.

```ts
        this.loadedVoice = cfg.voice
        this.ttsStatus = 'ready'
        await this.syncVoice() // 로딩 중에 면접관이 바뀌었으면 새 목소리로 맞춘다
```

`checkCached()`를 교체하고 `checkVoiceCached()`·`syncVoice()`·`chooseInterviewer()`를 추가한다(`setVoiceWanted` 앞).

```ts
    /** 재방문 판정: 모델 + TTS 엔진(목소리 해제면 모델만). 고른 목소리 파일은 따로 voiceCached로 본다 */
    async checkCached() {
      const m = this.manifest
      if (!m || !this.active) {
        this.cached = false
        this.modelCached = false
        this.voiceCached = false
        return
      }
      const sel = this.ttsEnabled ? this.ttsSelection : null
      const voicePath = m.tts ? pickVoice(m.tts, this.wantedVoiceId)?.path : undefined
      const wanted: [string, string][] = [[this.active.id, this.active.url]]
      if (sel)
        for (const f of sel.files)
          if (f.path !== voicePath) wanted.push([sel.id, sel.baseUrl + f.path])
      try {
        const hits = await Promise.all(wanted.map(([id, url]) => hasModel(id, url)))
        this.modelCached = hits[0]
        this.cached = hits.every(Boolean)
      } catch {
        this.modelCached = false
        this.cached = false
      }
      await this.checkVoiceCached()
    },
    /** 고른 목소리 파일이 캐시에 있는지. voices가 없으면(엔진에 포함) true */
    async checkVoiceCached() {
      const t = this.manifest?.tts
      const v = t ? pickVoice(t, this.wantedVoiceId) : null
      if (!t || !v) {
        this.voiceCached = true
        return
      }
      try {
        this.voiceCached = await hasModel(t.id, t.baseUrl + v.path)
      } catch {
        this.voiceCached = false
      }
    },
    /** 준비된 워커의 목소리를 고른 면접관 목소리로 맞춘다. 실패하면 false(이전 목소리 유지) */
    async syncVoice(): Promise<boolean> {
      const sel = this.ttsEnabled ? this.ttsSelection : null
      if (
        !sel ||
        this.ttsStatus !== 'ready' ||
        this.voiceSwitching ||
        sel.voice === this.loadedVoice
      )
        return true
      const file = sel.files[sel.files.length - 1] // resolveTts가 목소리 파일을 맨 뒤에 둔다
      const url = sel.baseUrl + file.path
      this.voiceSwitching = true
      this.voiceError = null
      try {
        if (!(await hasModel(sel.id, url))) await downloadModel(sel.id, url, file.size, () => {})
        await setTtsVoice(sel.voice, {
          path: file.path,
          size: file.size,
          url,
          cacheKey: cacheKey(sel.id, url),
        })
        this.loadedVoice = sel.voice
        this.voiceCached = true
      } catch (e) {
        this.voiceError = `목소리를 바꾸지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
        return false
      } finally {
        this.voiceSwitching = false
      }
      return this.syncVoice() // 바꾸는 동안 또 다른 면접관을 골랐으면 이어서 맞춘다
    },
    /** 면접관 고르기(랜딩·준비 화면 공용): 선택 → 목소리 캐시 확인 → 준비된 워커면 목소리 교체 */
    async chooseInterviewer(id: InterviewerId) {
      const iv = useInterviewerStore()
      const prev = iv.id
      iv.select(id)
      await this.checkVoiceCached()
      if (!(await this.syncVoice()) && prev) iv.select(prev) // 이전 목소리 유지 — 선택도 되돌린다(spec 7절)
    },
```

`clearCache()`의 끝에 추가한다.

```ts
      this.voiceCached = false
      this.loadedVoice = null
      this.voiceSwitching = false
      this.voiceError = null
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test && pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: 전체 PASS(기존 model·Landing·Prepare 테스트 포함 — `voices`가 없는 픽스처는 동작이 그대로다)

- [ ] **Step 6: 커밋 · PR 2**

```bash
git add frontend/src/stores/model.ts frontend/src/stores/model.test.ts
git commit -m "feat(frontend): 모델 스토어 면접관 목소리 — 엔진 + 고른 목소리 다운로드, 재방문은 엔진 기준, 진행률은 실제 캐시분만, chooseInterviewer·setVoice 교체"
```

PR 2 제목: `feat(frontend): 면접관 정의·선택 스토어·TTS 목소리 선택(setVoice)`
- 본문: Task 2–6 요약, 게이트 결과, "백엔드 `tts.voices` 배포 전에도 `voices`가 없으면 기본 목소리로 동작"
- 이슈 ③를 닫고 ②를 참조한다. 리뷰어 @leemonta9482

---

### Task 7: `InterviewerPicker.vue` (PR 3)

**Files:**
- Create: `frontend/src/components/InterviewerPicker.vue`
- Test: `frontend/src/components/InterviewerPicker.test.ts`

**Interfaces:**
- Consumes: `useInterviewerStore`(`id`, `playingId`, `previewFailed`, `spritesFor`, `preview`, `probeSprites`), `useModelStore().chooseInterviewer`, `INTERVIEWERS`
- Produces: props·emit 없는 컴포넌트 `<InterviewerPicker />`. `data-test="interviewer-{id}"` 카드(`role="radio"`), `data-test="preview-error"`, `data-test="ai-voice-preview"`

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/components/InterviewerPicker.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/preview', () => ({
  playPreview: vi.fn(async () => true),
  stopPreview: vi.fn(),
}))
vi.mock('@/services/sprites', () => ({ probeImage: vi.fn(async () => true) }))
vi.mock('@/services/api', () => ({ getManifest: vi.fn(), getQuestions: vi.fn() }))
vi.mock('@/services/llm', () => ({ initEngine: vi.fn(), disposeEngine: vi.fn() }))
vi.mock('@/services/tts', () => ({
  initTts: vi.fn(),
  synthesize: vi.fn(),
  disposeTts: vi.fn(),
  setTtsVoice: vi.fn(),
}))

import { playPreview } from '@/services/preview'
import { useInterviewerStore } from '@/stores/interviewer'
import InterviewerPicker from './InterviewerPicker.vue'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

const card = (w: ReturnType<typeof mount>, id: string) => w.find(`[data-test="interviewer-${id}"]`)

describe('InterviewerPicker', () => {
  it('면접관 3명 카드(이름·소개)를 라디오 그룹으로 보여 주고, 처음엔 아무도 선택되지 않는다', () => {
    const w = mount(InterviewerPicker)
    expect(w.find('[role="radiogroup"]').exists()).toBe(true)
    const radios = w.findAll('[role="radio"]')
    expect(radios).toHaveLength(3)
    expect(w.text()).toContain('온화한 선배')
    expect(w.text()).toContain('편하게 이야기해요')
    expect(radios.every((r) => r.attributes('aria-checked') === 'false')).toBe(true)
  })
  it('카드를 누르면 선택 + 포커스 강조 + 그 목소리 미리 듣기(음소거 저장값과 무관)', async () => {
    localStorage.setItem('momo.muted', '1')
    const w = mount(InterviewerPicker)
    await card(w, 'gentle').trigger('click')
    await flushPromises()
    expect(useInterviewerStore().id).toBe('gentle')
    expect(card(w, 'gentle').attributes('aria-checked')).toBe('true')
    expect(card(w, 'gentle').classes()).toContain('selected')
    expect(card(w, 'sharp').classes()).toContain('dim')
    expect(playPreview).toHaveBeenCalledWith('/voices/preview/gentle.ogg', expect.any(Function))
  })
  it('같은 카드를 다시 누르면 처음부터 다시 재생한다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'sharp').trigger('click')
    await card(w, 'sharp').trigger('click')
    expect(playPreview).toHaveBeenCalledTimes(2)
  })
  it('재생 중인 캐릭터는 question 시트, 끝나면 idle 시트', async () => {
    let ended!: () => void
    vi.mocked(playPreview).mockImplementationOnce(async (_s, onEnded) => {
      ended = onEnded!
      return true
    })
    const w = mount(InterviewerPicker)
    await card(w, 'standard').trigger('click')
    await flushPromises()
    expect(card(w, 'standard').find('.sprite').attributes('style')).toContain('center_question.png')
    ended()
    await flushPromises()
    expect(card(w, 'standard').find('.sprite').attributes('style')).toContain('center_idle.png')
  })
  it('방향키로 다음 면접관을 고르면 선택하고 재생한다', async () => {
    const w = mount(InterviewerPicker)
    await card(w, 'gentle').trigger('click')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(useInterviewerStore().id).toBe('standard')
    expect(playPreview).toHaveBeenLastCalledWith('/voices/preview/standard.ogg', expect.any(Function))
  })
  it('재생 실패면 안내 문구, 스피커 버튼은 없다, AI 합성 목소리 고지는 항상 있다', async () => {
    vi.mocked(playPreview).mockResolvedValueOnce(false)
    const w = mount(InterviewerPicker)
    expect(w.find('[data-test="ai-voice-preview"]').text()).toContain('AI로 합성한 목소리')
    await card(w, 'gentle').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="preview-error"]').text()).toContain('미리 듣기를 재생할 수 없습니다')
    expect(w.find('[data-test="speaker"]').exists()).toBe(false)
    expect(w.findAll('button').length).toBe(3) // 카드 3장뿐
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/components/InterviewerPicker.test.ts`
Expected: FAIL — `./InterviewerPicker.vue`를 찾을 수 없음

- [ ] **Step 3: 구현**

`frontend/src/components/InterviewerPicker.vue`

```vue
<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import SpriteFrame from '@/components/ui/SpriteFrame.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import { INTERVIEWERS, type InterviewerId } from '@/interviewers'
import { useInterviewerStore } from '@/stores/interviewer'
import { useModelStore } from '@/stores/model'

/**
 * 면접관 고르기(spec 3.1): 카드 클릭·키보드 선택 = 선택 + 포커스 + 미리 듣기(항상 재생).
 * 스피커 버튼·미리 듣기 음소거는 두지 않는다. 랜딩과 준비 화면 "바꾸기"에서 같이 쓴다.
 */
const iv = useInterviewerStore()
const model = useModelStore()
const cards = ref<HTMLButtonElement[]>([])
onMounted(() => void iv.probeSprites())

function pick(id: InterviewerId) {
  void model.chooseInterviewer(id)
  void iv.preview(id)
}
function onKey(e: KeyboardEvent) {
  const dir =
    e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : 0
  if (!dir) return
  e.preventDefault()
  const n = INTERVIEWERS.length
  const i = INTERVIEWERS.findIndex((p) => p.id === iv.id)
  const j = i === -1 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n
  pick(INTERVIEWERS[j].id)
  void nextTick(() => cards.value[j]?.focus())
}
const tabbable = (id: InterviewerId) => (iv.id === null ? id === INTERVIEWERS[0].id : iv.id === id)
const sheet = (id: InterviewerId) => {
  const s = iv.spritesFor(id)
  return iv.playingId === id ? s.question : s.idle
}
</script>

<template>
  <div class="picker-wrap">
    <div class="picker" role="radiogroup" aria-label="면접관 고르기" @keydown="onKey">
      <button
        v-for="p in INTERVIEWERS"
        :key="p.id"
        ref="cards"
        type="button"
        role="radio"
        class="card press"
        :class="{ selected: iv.id === p.id, dim: iv.id !== null && iv.id !== p.id }"
        :aria-checked="iv.id === p.id"
        :tabindex="tabbable(p.id) ? 0 : -1"
        :data-test="`interviewer-${p.id}`"
        @click="pick(p.id)"
      >
        <SpriteFrame
          :src="sheet(p.id).file"
          :frame-w="32"
          :frame-h="32"
          :frames="sheet(p.id).frames"
          :scale="4"
          :fps="8"
        />
        <span class="name">{{ p.name }}</span>
        <span class="tagline mono">{{ p.tagline }}</span>
        <PixelTag v-if="iv.id === p.id" tone="ok">선택됨</PixelTag>
      </button>
    </div>
    <p v-if="iv.previewFailed" class="mono err" data-test="preview-error">
      미리 듣기를 재생할 수 없습니다
    </p>
    <p class="mono note" data-test="ai-voice-preview">
      면접관 목소리는 AI로 합성한 목소리입니다 (Supertonic 3)
    </p>
  </div>
</template>

<style scoped>
.picker-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.picker {
  display: flex;
  justify-content: center;
  gap: var(--sp-5);
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--raise);
  color: var(--text);
  border: 2px solid var(--line);
  --press-shadow: var(--raise);
  box-shadow: 4px 4px 0 var(--press-shadow);
  cursor: pointer;
  transition:
    transform 120ms steps(2),
    opacity 120ms steps(2);
}
.card.selected {
  border-color: var(--accent);
  transform: scale(1.08);
}
.card.dim {
  opacity: 0.55;
}
.name {
  font-size: var(--fs-label);
}
.tagline {
  font-size: var(--fs-meta);
  color: var(--text-2);
}
.err {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-meta);
}
.note {
  margin: 0;
  color: var(--text-3);
  font-size: var(--fs-meta);
}
</style>
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- src/components/InterviewerPicker.test.ts src/styles && pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: PASS(`tokens.test.ts` 색 리터럴 검사 포함)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/InterviewerPicker.vue frontend/src/components/InterviewerPicker.test.ts
git commit -m "feat(frontend): InterviewerPicker — 카드 클릭·방향키로 선택 + 포커스 + 미리 듣기(스피커·음소거 없음)"
```

---

### Task 8: 랜딩 — 고르기 창·동의 게이트·면접관 이름 (PR 3)

**Files:**
- Modify: `frontend/src/views/LandingView.vue`
- Test: `frontend/src/views/LandingView.test.ts`

**Interfaces:**
- Consumes: `InterviewerPicker`(Task 7), `useInterviewerStore().id/current`, `useModelStore().ttsSelectionSize` (Task 6)

- [ ] **Step 1: 기존 테스트 정리 + 실패하는 테스트**

`frontend/src/views/LandingView.test.ts`
1. `vi.mock` 목록에 추가한다.
   ```ts
   vi.mock('@/services/preview', () => ({ playPreview: vi.fn(async () => true), stopPreview: vi.fn() }))
   vi.mock('@/services/sprites', () => ({ probeImage: vi.fn(async () => true) }))
   ```
2. `beforeEach`의 `localStorage.clear()` 바로 뒤에 `localStorage.setItem('momo.interviewer', 'standard')`를 넣는다. 기존 흐름 테스트는 면접관을 고른 상태가 전제다.
3. 동의 라디오 선택자를 좁힌다. Picker도 `role="radio"`를 쓰기 때문이다.
   - 파일 위쪽에 `const consentRadios = (w: ReturnType<typeof mountView>) => w.findAll('[aria-label="다운로드 동의"] [role=radio]')`를 추가한다.
   - `w.findAll('[role=radio]')[0]`를 모두 `consentRadios(w)[0]`로 바꾼다(7곳).
   - `w.find('[role=radio]').exists()`를 모두 `consentRadios(w).length > 0`로 바꾼다(2곳).
4. `#32` 테스트의 기대값 `'supertonic-3 (목소리 M2)'`를 `'supertonic-3 (목소리: 기본 면접관)'`으로 바꾼다.
5. 맨 아래에 추가한다.

```ts
describe('LandingView — 면접관 고르기', () => {
  it('고르기 창에 면접관 3명 카드가 있다', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.findAll('[data-test^="interviewer-"]')).toHaveLength(3)
  })
  it('첫 방문(선택 없음)에는 동의 선택지가 비활성이고 "면접관을 먼저 골라 주세요"', async () => {
    localStorage.removeItem('momo.interviewer')
    setActivePinia(createPinia())
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-test="pick-first"]').text()).toContain('면접관을 먼저 골라 주세요')
    await consentRadios(w)[0].trigger('click')
    await flushPromises()
    expect(w.find('[data-test="env"]').exists()).toBe(false)
    await w.find('[data-test="interviewer-gentle"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="pick-first"]').exists()).toBe(false)
    await consentRadios(w)[0].trigger('click')
    await flushPromises()
    expect(w.find('[data-test="env"]').exists()).toBe(true)
  })
  it('목소리 행: 고른 면접관 이름, 용량은 엔진 + 고른 목소리', async () => {
    vi.mocked(getManifest).mockResolvedValue({
      ...manifest,
      tts: {
        ...TTS,
        files: [...TTS.files, { path: 'voice_styles/M2.json', size: 300_000 }],
        voices: [
          { id: 'M2', path: 'voice_styles/M2.json', size: 300_000 },
          { id: 'F1', path: 'voice_styles/F1.json', size: 290_000 },
        ],
      },
    })
    const w = mountView()
    await flushPromises()
    const voiceRow = w.findAll('[data-test="model-row"]')[1]
    expect(voiceRow.text()).toContain('supertonic-3 (목소리: 기본 면접관)')
    expect(useModelStore().ttsSelectionSize).toBe(300_000_000 + 98_653_257 + 300_000)
  })
  it('재방문 한 줄에 면접관 이름이 붙는다', async () => {
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: TTS })
    vi.mocked(hasModel).mockResolvedValue(true)
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-test="revisit-consent"]').text()).toContain('면접관: 기본 면접관')
  })
  it('재방문인데 저장된 선택이 없으면 기본 면접관이 자동 선택되어 "바로 준비하기"가 열린다', async () => {
    localStorage.removeItem('momo.interviewer')
    setActivePinia(createPinia())
    vi.mocked(getManifest).mockResolvedValue({ ...manifest, tts: TTS })
    vi.mocked(hasModel).mockResolvedValue(true)
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-test="interviewer-standard"]').attributes('aria-checked')).toBe('true')
    expect(w.find('[data-test="go-prepare"]').attributes('disabled')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/views/LandingView.test.ts`
Expected: 새 테스트 FAIL(카드 없음, `pick-first` 없음, 이름 없음), `#32` 기대값 FAIL

- [ ] **Step 3: 구현**

`frontend/src/views/LandingView.vue`

script:
- import에서 `Avatar`를 빼고 다음을 추가한다.
  ```ts
  import InterviewerPicker from '@/components/InterviewerPicker.vue'
  import { useInterviewerStore } from '@/stores/interviewer'
  ```
- `const interview = useInterviewStore()` 아래에 `const iv = useInterviewerStore()`를 추가한다.
- `/* 동의 */` 절에 추가한다.
  ```ts
  /* 첫 방문은 면접관을 골라야 동의할 수 있다(spec 3.1). 재방문은 스토어가 기본 면접관을 자동 선택한다 */
  const needPick = computed(() => !iv.id)
  ```
- `revisitLine`을 교체한다.
  ```ts
  const revisitLine = computed(() => {
    const names = [model.active?.id, model.ttsEnabled ? model.manifest?.tts?.id : null]
      .filter(Boolean)
      .join(' · ')
    const voice = model.manifest?.tts && !model.ttsEnabled ? ' · 목소리 없음(텍스트만)' : ''
    const who = iv.current ? ` · 면접관: ${iv.current.name}` : ''
    return `${names}${voice}${who} — 이 브라우저에 저장됨`
  })
  ```
- `rows`의 목소리 행 `name`·`size`를 바꾼다.
  ```ts
          name: `${tts.value.id} (목소리: ${iv.current?.name ?? tts.value.voice})`,
          size: formatSize(model.ttsSelectionSize),
  ```

template — 2번 섹션(`<!-- 2. 면접관 소개 -->`) 안의 `<PixelWindow>…</PixelWindow>`를 교체한다.

```vue
        <PixelWindow title="오늘의 면접관을 골라 주세요">
          <div class="intro-text">
            <SpeechText
              text="반갑습니다. 저희 셋 중 한 명이 여러분의 이력서를 읽고 질문 다섯 개를 준비합니다. 카드를 누르면 목소리를 들어 볼 수 있어요. 끝나면 점수 대신 문항별 피드백을 드리겠습니다."
            />
            <InterviewerPicker />
            <p class="note">
              단, 저희는 서버가 아니라 이 브라우저 안에서 움직입니다. 그래서 처음 한 번은 몸(모델
              파일)을 내려받아야 합니다.
            </p>
          </div>
        </PixelWindow>
```

3번 섹션의 `<template v-if="!revisit">` 안을 교체한다.

```vue
          <template v-if="!revisit">
            <ChoiceMenu
              :items="consentItems"
              :model-value="consent"
              :disabled="needPick"
              aria-label="다운로드 동의"
              @update:model-value="onConsent"
            />
            <p v-if="needPick" class="mono meta err" data-test="pick-first">
              면접관을 먼저 골라 주세요
            </p>
            <p v-else class="mono meta">선택하면 아래 장비 확인 창으로 이동합니다.</p>
          </template>
```

style: 안 쓰는 `.intro` 규칙을 지운다. `.intro-text`는 그대로 쓴다(세로 간격).

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- src/views/LandingView.test.ts && pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/views/LandingView.vue frontend/src/views/LandingView.test.ts
git commit -m "feat(frontend): 랜딩 면접관 고르기 창 — 첫 방문은 선택 후 동의, 목소리 행·재방문 한 줄에 면접관 이름"
```

---

### Task 9: 준비 화면 — 면접관 칩·바꾸기·목소리 준비 줄 (PR 3)

**Files:**
- Modify: `frontend/src/views/PrepareView.vue`
- Test: `frontend/src/views/PrepareView.test.ts`

**Interfaces:**
- Consumes: `InterviewerPicker`, `useInterviewerStore().current`, `useModelStore().voiceSwitching / voiceError` (Task 6)

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/views/PrepareView.test.ts`
- `mountView`의 stubs에 `InterviewerPicker: true`를 추가한다: `global: { stubs: { PixelProgress: true, InterviewerPicker: true } }`
- 목소리 줄 문구가 바뀌므로 기존 기대값 두 개를 고친다(선택 없음 → 이름은 `기본 면접관`).
  - 316행 `'목소리 준비 (40%)'` → `'목소리 준비 · 기본 면접관 (40%)'`
  - 328행 `'목소리 준비 (실패)'` → `'목소리 준비 · 기본 면접관 (실패)'`
- 맨 아래에 추가한다(파일에 이미 있는 `manifestWithTts` 픽스처를 쓴다).

```ts
import { useInterviewerStore } from '@/stores/interviewer'

describe('PrepareView — 면접관', () => {
  it('시작 영역에 면접관 칩, "바꾸기"로 고르기 패널을 연다', async () => {
    useInterviewerStore().select('sharp')
    const w = mountView()
    expect(w.find('[data-test="interviewer-chip"]').text()).toContain('날카로운 압박 면접관')
    expect(w.findComponent({ name: 'InterviewerPicker' }).exists()).toBe(false)
    await w.find('[data-test="change-interviewer"]').trigger('click')
    expect(w.findComponent({ name: 'InterviewerPicker' }).exists()).toBe(true)
    expect(w.find('[data-test="change-interviewer"]').text()).toBe('닫기')
  })
  it('목소리 준비 줄에 면접관 이름, 교체 중이면 "바꾸는 중", 실패면 안내', async () => {
    useInterviewerStore().select('gentle')
    const model = useModelStore()
    model.manifest = manifestWithTts
    const w = mountView()
    expect(w.find('.checklist').text()).toContain('목소리 준비 · 온화한 선배')
    model.$patch({ status: 'ready', ttsStatus: 'ready', voiceSwitching: true })
    await w.vm.$nextTick()
    expect(w.find('.checklist').text()).toContain('바꾸는 중')
    model.$patch({ voiceSwitching: false, voiceError: '목소리를 바꾸지 못했습니다: x' })
    await w.vm.$nextTick()
    expect(w.find('[data-test="voice-error"]').text()).toContain('목소리를 바꾸지 못했습니다')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/views/PrepareView.test.ts`
Expected: FAIL — `interviewer-chip`·`change-interviewer`·`voice-error` 없음, 고친 두 기대값 불일치

- [ ] **Step 3: 구현**

`frontend/src/views/PrepareView.vue`

script에 추가한다.

```ts
import InterviewerPicker from '@/components/InterviewerPicker.vue'
import { useInterviewerStore } from '@/stores/interviewer'
```

```ts
const iv = useInterviewerStore()
/* 면접관 바꾸기(spec 3.4): 같은 고르기 패널을 연다. 바꾸면 목소리 파일(약 290KB)만 받아 교체한다 */
const pickerOpen = ref(false)
const interviewerName = computed(() => iv.current?.name ?? '기본 면접관')
```

template — `<div class="start-row">` 바로 위에 추가한다.

```vue
        <div class="interviewer-row">
          <span class="mono" data-test="interviewer-chip">면접관: {{ interviewerName }}</span>
          <button
            type="button"
            class="mono link press"
            data-test="change-interviewer"
            @click="pickerOpen = !pickerOpen"
          >
            {{ pickerOpen ? '닫기' : '바꾸기' }}
          </button>
        </div>
        <InterviewerPicker v-if="pickerOpen" />
```

체크리스트의 목소리 줄 문구를 교체한다.

```vue
              목소리 준비 · {{ interviewerName }} ({{
                model.voiceSwitching
                  ? '바꾸는 중'
                  : model.ttsStatus === 'ready'
                    ? '완료'
                    : model.ttsStatus === 'error'
                      ? '실패'
                      : `${model.ttsProgress}%`
              }})
```

`<p v-if="startError" …>` 바로 위에 추가한다.

```vue
          <p v-if="model.voiceError" class="mono start-error" data-test="voice-error">
            {{ model.voiceError }}
          </p>
```

style에 추가한다.

```css
.interviewer-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- src/views/PrepareView.test.ts && pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: PASS

- [ ] **Step 5: 커밋 · PR 3**

```bash
git add frontend/src/views/PrepareView.vue frontend/src/views/PrepareView.test.ts
git commit -m "feat(frontend): 준비 화면 면접관 칩·바꾸기 패널, 목소리 준비 줄에 이름·교체 중·실패 안내"
```

PR 3 제목: `feat(frontend): 면접관 고르기 화면 — Picker·랜딩·준비 화면`
- 본문: 스크린샷(랜딩 고르기 창, 동의 게이트, 준비 화면 바꾸기), 게이트 결과
- 이슈 ②를 닫는다. 리뷰어 @leemonta9482

---

### Task 10: 페르소나 프롬프트 · 리포트 말투 · 면접 스냅샷 (PR 4, 계층 규율)

**Files:**
- Create: `frontend/src/prompts/personas.ts`
- Modify: `frontend/src/prompts/interviewer.ts`, `frontend/src/prompts/report.ts`, `frontend/src/stores/interview.ts`
- Test: `frontend/src/prompts/interviewer.test.ts`, `frontend/src/prompts/report.test.ts`(신규), `frontend/src/stores/interview.test.ts`

**Interfaces:**
- Consumes: `InterviewerId`, `interviewerById`, `DEFAULT_INTERVIEWER`, `Interviewer` (Task 2), `useInterviewerStore` (Task 3)
- Produces:
  - `prompts/personas.ts`: `interface Persona { character: string | null; followUpRule: string; reaction: string; reportTone: string | null }`, `PERSONAS: Record<InterviewerId, Persona>`
  - `buildSystemPrompt(i: SystemPromptInput & { persona?: Persona })` — persona가 없으면 `PERSONAS.standard`
  - `buildReportInstruction(persona?: Persona | null): string`
  - interview 스토어
    - state `interviewerId: InterviewerId | null`(이 면접의 면접관, 시작 때 고정)
    - getter `sessionInterviewer: Interviewer`(없으면 기본 면접관)

- [ ] **Step 1: 실패하는 테스트 — 프롬프트**

`frontend/src/prompts/interviewer.test.ts`
- import를 `import { KICKOFF, buildSystemPrompt } from './interviewer'`와 `import { PERSONAS } from './personas'`로 바꾼다.
- 맨 아래에 추가한다. `legacy()`는 **변경 전 `buildSystemPrompt`를 글자 그대로 복사**한 것이다. 기본 면접관이 지금 문구와 같다는 것을 고정하는 기준이다.

```ts
/** 변경 전(2026-09-26) buildSystemPrompt — standard 페르소나가 글자까지 같아야 한다 */
function legacy(i: typeof base): string {
  const examples = i.fallbackQuestions.length
    ? `\n\n[참고용 질문 예시 — 이력서와 무관하면 쓰지 않아도 됩니다]\n${i.fallbackQuestions.map((q) => `- ${q}`).join('\n')}`
    : ''
  return `당신은 ${i.fieldLabel} 분야 기업의 채용 면접관입니다. 지원 직무는 "${i.job}"입니다.
지금부터 지원자와 1:1 모의 면접을 진행합니다.

[지원자 이력서]
${i.resumeText}

[진행 규칙]
1. 한국어 존댓말을 씁니다. 한 번에 질문을 하나만 합니다. 질문은 두 문장 이내로 짧게 합니다.
2. 이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다.
3. 지원자의 답변이 짧거나 구체성이 부족하거나 흥미로우면 꼬리질문을 할 수 있습니다. 한 질문당 꼬리질문은 최대 2개입니다.
4. 답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다. 짧은 반응("네, 알겠습니다." 정도)만 허용됩니다.
5. 질문 번호나 남은 질문 수를 말하지 않습니다.
6. 다섯 번째 질문의 답변(꼬리질문 포함)이 끝나면 정확히 이 문장으로 끝냅니다: "${END_PHRASE}."
7. 질문 외의 설명, 머리말, 이모지, 마크다운은 쓰지 않습니다.${examples}`
}

describe('buildSystemPrompt — 페르소나', () => {
  it('persona가 없거나 standard면 변경 전 문구와 글자까지 같다', () => {
    expect(buildSystemPrompt(base)).toBe(legacy(base))
    expect(buildSystemPrompt({ ...base, persona: PERSONAS.standard })).toBe(legacy(base))
  })
  it('gentle·sharp는 성격 문장이 둘째 줄 뒤에, 규칙 3·4에 자기 값이 들어간다', () => {
    for (const id of ['gentle', 'sharp'] as const) {
      const p = PERSONAS[id]
      const out = buildSystemPrompt({ ...base, persona: p })
      expect(out).toContain(`지금부터 지원자와 1:1 모의 면접을 진행합니다.\n${p.character}\n\n[지원자 이력서]`)
      expect(out).toContain(`\n3. ${p.followUpRule}\n`)
      expect(out).toContain(`짧은 반응("${p.reaction}" 정도)만 허용됩니다.`)
    }
  })
  it('세 페르소나 모두 공통 규칙(질문 5개·종료 문장·평가 금지)을 유지한다', () => {
    for (const p of Object.values(PERSONAS)) {
      const out = buildSystemPrompt({ ...base, persona: p })
      expect(out).toContain('이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다.')
      expect(out).toContain(`"${END_PHRASE}."`)
      expect(out).toContain('답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다.')
    }
  })
  it('override가 있으면 페르소나와 무관하게 그대로 쓴다', () => {
    expect(buildSystemPrompt({ ...base, override: 'OVERRIDE', persona: PERSONAS.sharp })).toBe('OVERRIDE')
  })
})
```

`frontend/src/prompts/report.test.ts` (신규)

```ts
import { describe, expect, it } from 'vitest'
import { REPORT_INSTRUCTION, buildReportInstruction } from './report'
import { PERSONAS } from './personas'

const jsonPart = (s: string) => s.slice(s.indexOf('\n\n[') + 2)

describe('buildReportInstruction', () => {
  it('페르소나가 없거나 standard면 지금 지시문 그대로', () => {
    expect(buildReportInstruction()).toBe(REPORT_INSTRUCTION)
    expect(buildReportInstruction(PERSONAS.standard)).toBe(REPORT_INSTRUCTION)
  })
  it('gentle·sharp는 말투 한 줄을 JSON 예시 바로 앞에 넣고, JSON 예시·분량은 그대로', () => {
    for (const id of ['gentle', 'sharp'] as const) {
      const out = buildReportInstruction(PERSONAS[id])
      expect(out).toContain(`\n${PERSONAS[id].reportTone}\n\n[`)
      expect(jsonPart(out)).toBe(jsonPart(REPORT_INSTRUCTION))
      expect(out.split('\n').length).toBe(REPORT_INSTRUCTION.split('\n').length + 1)
    }
  })
})
```

- [ ] **Step 2: 실패하는 테스트 — 면접 스토어**

`frontend/src/stores/interview.test.ts` 맨 아래에 추가한다. 파일에 이미 있는 `fakeSession(replies)`(보낸 텍스트를 `sent`에 모음)과 `readyStore()`(모델 ready + IT·백엔드·이력서 입력)를 그대로 쓴다.

```ts
import { useInterviewerStore } from './interviewer'
import { PERSONAS } from '@/prompts/personas'
import { buildReportInstruction } from '@/prompts/report'

describe('interview store — 면접관 페르소나', () => {
  it('시작할 때 고른 면접관을 고정하고 그 페르소나로 프롬프트를 만든다(이후 선택을 바꿔도 그대로)', async () => {
    useInterviewerStore().select('sharp')
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    expect(s.interviewerId).toBe('sharp')
    expect(s.sessionInterviewer.name).toBe('날카로운 압박 면접관')
    expect(startSession).toHaveBeenCalledWith(expect.stringContaining(PERSONAS.sharp.character!))
    useInterviewerStore().select('gentle')
    expect(s.sessionInterviewer.id).toBe('sharp')
  })
  it('선택이 없으면 기본 면접관 — 온화·압박 성격 문장이 없다', async () => {
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    expect(s.interviewerId).toBe('standard')
    const prompt = vi.mocked(startSession).mock.calls.at(-1)![0]
    expect(prompt).not.toContain(PERSONAS.gentle.character!)
    expect(prompt).not.toContain(PERSONAS.sharp.character!)
  })
  it('리포트는 면접관 말투 지시문으로 요청한다', async () => {
    useInterviewerStore().select('gentle')
    const json = JSON.stringify([{ question: 'Q', answerSummary: 'A', feedback: 'F' }])
    const sess = fakeSession(['q', json])
    vi.mocked(startSession).mockResolvedValue(sess)
    const s = await readyStore()
    await s.start()
    await s.finish()
    expect(sess.sent).toContain(buildReportInstruction(PERSONAS.gentle))
    expect(sess.sent).not.toContain(REPORT_INSTRUCTION)
  })
  it('시작하면 미리 듣기를 멈추고, reset은 면접관 스냅샷을 비운다', async () => {
    const iv = useInterviewerStore()
    iv.$patch({ playingId: 'gentle' })
    vi.mocked(startSession).mockResolvedValue(fakeSession(['q']))
    const s = await readyStore()
    await s.start()
    expect(iv.playingId).toBeNull()
    await s.reset()
    expect(s.interviewerId).toBeNull()
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test -- src/prompts src/stores/interview.test.ts`
Expected: FAIL — `./personas` 없음, `buildReportInstruction` 없음, `interviewerId` undefined

- [ ] **Step 4: 구현**

`frontend/src/prompts/personas.ts`

```ts
import type { InterviewerId } from '@/interviewers'

/**
 * 면접관 페르소나(spec 5절) — 시스템 프롬프트의 네 자리만 채운다. 나머지 진행 규칙은 공통.
 * standard는 2026-09-26 이전 문구와 글자까지 같다(prompts/interviewer.test.ts가 고정).
 * 계층 규율 경로: 바꾸면 면접관 3명 각각 면접 1회 완주 + 리포트 JSON 파싱을 확인한다.
 */
export interface Persona {
  /** 첫 문단 뒤에 들어갈 성격 문장. null이면 넣지 않는다 */
  character: string | null
  /** 진행 규칙 3번 전체 문장 */
  followUpRule: string
  /** 진행 규칙 4번의 허용 반응 예시 */
  reaction: string
  /** 리포트 지시문에 덧붙일 한 줄. null이면 없음 */
  reportTone: string | null
}

export const PERSONAS: Record<InterviewerId, Persona> = {
  gentle: {
    character:
      '지원자가 편하게 말할 수 있도록 부드럽고 따뜻한 존댓말을 씁니다. 경험을 떠올리기 쉽게 구체적인 상황으로 묻습니다.',
    followUpRule:
      '지원자의 답변이 너무 짧을 때만 꼬리질문을 할 수 있습니다. 한 질문당 꼬리질문은 최대 1개입니다.',
    reaction: '네, 잘 들었습니다.',
    reportTone: '잘한 점을 먼저 짚고, 고칠 점은 격려하는 말투로 구체적으로 적습니다.',
  },
  standard: {
    character: null,
    followUpRule:
      '지원자의 답변이 짧거나 구체성이 부족하거나 흥미로우면 꼬리질문을 할 수 있습니다. 한 질문당 꼬리질문은 최대 2개입니다.',
    reaction: '네, 알겠습니다.',
    reportTone: null,
  },
  sharp: {
    character:
      '논리와 근거를 엄격하게 확인합니다. 간결하고 건조한 존댓말을 쓰고, 수치·근거·본인의 기여·한계를 캐묻습니다. 모호한 표현은 구체적으로 되묻습니다. 무례하거나 인신공격적인 표현은 쓰지 않습니다.',
    followUpRule:
      '지원자의 답변에 근거·수치·본인의 기여가 부족하거나 모호하면 꼬리질문으로 구체적으로 되묻습니다. 한 질문당 꼬리질문은 최대 2개입니다.',
    reaction: '네.',
    reportTone: '칭찬은 생략하고 근거 부족·모호한 표현·빠진 수치를 직설적으로 짚습니다.',
  },
}
```

`frontend/src/prompts/interviewer.ts` 전체를 교체한다.

```ts
import { END_PHRASE } from '@/utils/endDetector'
import { PERSONAS, type Persona } from './personas'

export const KICKOFF = '면접을 시작해 주세요.'

export interface SystemPromptInput {
  fieldLabel: string
  job: string
  resumeText: string
  fallbackQuestions: string[]
  override?: string | null
  /** 없으면 기본 면접관(standard) — 변경 전 문구와 글자까지 같다 */
  persona?: Persona
}

export function buildSystemPrompt(i: SystemPromptInput): string {
  if (i.override) return i.override
  const p = i.persona ?? PERSONAS.standard
  const examples = i.fallbackQuestions.length
    ? `\n\n[참고용 질문 예시 — 이력서와 무관하면 쓰지 않아도 됩니다]\n${i.fallbackQuestions.map((q) => `- ${q}`).join('\n')}`
    : ''
  const character = p.character ? `\n${p.character}` : ''
  return `당신은 ${i.fieldLabel} 분야 기업의 채용 면접관입니다. 지원 직무는 "${i.job}"입니다.
지금부터 지원자와 1:1 모의 면접을 진행합니다.${character}

[지원자 이력서]
${i.resumeText}

[진행 규칙]
1. 한국어 존댓말을 씁니다. 한 번에 질문을 하나만 합니다. 질문은 두 문장 이내로 짧게 합니다.
2. 이력서 내용을 근거로 질문 5개를 준비해 순서대로 진행합니다. 첫 질문은 자기소개입니다.
3. ${p.followUpRule}
4. 답변에 대한 평가, 점수, 조언은 면접 중에는 절대 말하지 않습니다. 짧은 반응("${p.reaction}" 정도)만 허용됩니다.
5. 질문 번호나 남은 질문 수를 말하지 않습니다.
6. 다섯 번째 질문의 답변(꼬리질문 포함)이 끝나면 정확히 이 문장으로 끝냅니다: "${END_PHRASE}."
7. 질문 외의 설명, 머리말, 이모지, 마크다운은 쓰지 않습니다.${examples}`
}
```

`frontend/src/prompts/report.ts` 끝에 추가한다(`REPORT_INSTRUCTION`은 그대로).

```ts
import type { Persona } from './personas'

/** 리포트 지시문. 페르소나 말투 한 줄을 JSON 예시 바로 앞에 넣는다. 말투가 없으면 REPORT_INSTRUCTION 그대로 */
export function buildReportInstruction(persona?: Persona | null): string {
  const tone = persona?.reportTone
  return tone ? REPORT_INSTRUCTION.replace('\n\n[', `\n${tone}\n\n[`) : REPORT_INSTRUCTION
}
```

import는 파일 맨 위로 올린다.

`frontend/src/stores/interview.ts`
- import
  ```ts
  import { buildReportInstruction } from '@/prompts/report'
  import { PERSONAS } from '@/prompts/personas'
  import { DEFAULT_INTERVIEWER, interviewerById, type Interviewer, type InterviewerId } from '@/interviewers'
  import { useInterviewerStore } from './interviewer'
  ```
  `REPORT_INSTRUCTION` import는 더 쓰지 않으면 지운다.
- state에 `interviewerId: null as InterviewerId | null,`를 추가한다. 주석: `/** 이 면접의 면접관 — start()에서 고정(spec 3.5) */`
- getters에 추가한다.
  ```ts
    /** 진행 중·끝난 면접의 면접관. 시작 전이면 기본 면접관 */
    sessionInterviewer: (s): Interviewer =>
      interviewerById(s.interviewerId) ?? interviewerById(DEFAULT_INTERVIEWER)!,
  ```
- `start()`의 `const model = useModelStore()` 아래에 추가하고, `buildSystemPrompt` 인자에 `persona`를 넣는다.
  ```ts
        const ivStore = useInterviewerStore()
        ivStore.stopPreview() // 미리 듣기가 면접관 목소리와 겹치지 않게
        const chosen = ivStore.current ?? interviewerById(DEFAULT_INTERVIEWER)!
        this.interviewerId = chosen.id
  ```
  ```ts
          persona: PERSONAS[chosen.id],
  ```
- `finish()`의 `session.send(REPORT_INSTRUCTION, …)`를 `session.send(buildReportInstruction(PERSONAS[this.sessionInterviewer.id]), …)`로 바꾼다.
- `reset()`에 `this.interviewerId = null`을 추가한다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm test && pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: 전체 PASS. 기존 "리포트 지시문 한 번" 테스트는 선택 없음 → standard → `REPORT_INSTRUCTION` 그대로라 통과한다.

- [ ] **Step 6: 리허설 (계층 규율 — 사람 확인 지점)**

로컬(`cd backend && uv run uvicorn app.main:app` + `cd frontend && pnpm dev`)에서 실제 E4B로 면접관 3명 각각 면접 1회를 완주한다.
- 확인할 것: 5문항 진행, 종료 문장, 리포트 카드가 JSON 파싱으로 나오는지(원문 카드가 아닌지)
- PR 본문에 적을 것: 면접관별 대표 질문 2개, 짧은 반응 예시, 리포트 피드백 한 문장, 꼬리질문 수. 프롬프트 전후 비교(`git diff main -- frontend/src/prompts`)도 붙인다.
- 문구 조정이 필요하면 `personas.ts`만 고치고 Step 5를 다시 돌린다.

- [ ] **Step 7: 커밋 · PR 4**

```bash
git add frontend/src/prompts frontend/src/stores/interview.ts frontend/src/stores/interview.test.ts
git commit -m "feat(frontend): 면접관 페르소나 — 성격 문장·꼬리질문·짧은 반응·리포트 말투(standard는 기존 문구 그대로), 면접 시작 때 면접관 고정"
```

PR 4 제목: `feat(frontend): 면접관 페르소나 프롬프트·리포트 말투`
- 본문: Step 6 리허설 결과와 전후 비교(계층 규율 필수)
- 이슈 ④를 닫는다. 리뷰어 @leemonta9482

---

### Task 11: 무대 가운데 스프라이트·태그·리포트 헤더 (PR 5)

**Files:**
- Modify: `frontend/src/components/interview/interviewerAnims.ts`, `frontend/src/components/interview/InterviewStage.vue`, `frontend/src/views/InterviewView.vue`, `frontend/src/views/ReportView.vue`
- Test: `frontend/src/components/interview/interviewerAnims.test.ts`, `frontend/src/components/interview/InterviewStage.test.ts`, `frontend/src/views/ReportView.test.ts`

**Interfaces:**
- Consumes: `CenterSprites`·`CenterRole` (Task 2), `useInterviewerStore().spritesFor / probeSprites` (Task 3), `sessionInterviewer` (Task 10)
- Produces:
  - `sheetFor(name: AnimName, center?: CenterSprites): { file: string; frames: number; loop: boolean }`
  - `InterviewStage` props `centerSprites?: CenterSprites`, `interviewerName?: string`

- [ ] **Step 1: 실패하는 테스트**

`interviewerAnims.test.ts` 맨 아래에 추가한다(import에 `sheetFor` 추가).

```ts
import { interviewerById } from '@/interviewers'

describe('sheetFor', () => {
  it('센터 스프라이트가 없으면 기존 ANIMS 그대로', () => {
    expect(sheetFor('center_nod')).toEqual(ANIMS.center_nod)
  })
  it('가운데 동작은 고른 면접관 시트로, loop 규칙은 ANIMS를 따른다', () => {
    const sp = interviewerById('gentle')!.sprites
    expect(sheetFor('center_question', sp)).toEqual({
      file: sp.question.file,
      frames: sp.question.frames,
      loop: true,
    })
    expect(sheetFor('center_nod', sp).loop).toBe(false)
  })
  it('좌우 배석자는 센터 스프라이트와 무관하다', () => {
    const sp = interviewerById('sharp')!.sprites
    expect(sheetFor('left_idle', sp)).toEqual(ANIMS.left_idle)
    expect(sheetFor('right_writing', sp)).toEqual(ANIMS.right_writing)
  })
})
```

`InterviewStage.test.ts` 맨 아래에 추가한다.

```ts
import { interviewerById } from '@/interviewers'

describe('InterviewStage — 면접관', () => {
  it('centerSprites를 주면 가운데 자리는 그 면접관 시트, 좌우는 그대로', () => {
    const sp = interviewerById('gentle')!.sprites
    const w = mount(InterviewStage, { props: { ...base, centerSprites: sp } })
    expect(w.find('[data-char="center"]').attributes('style')).toContain('gentle/center_idle.png')
    expect(w.find('[data-char="left"]').attributes('style')).toContain('left_idle.png')
  })
  it('면접관 이름을 상단 태그에 붙인다', () => {
    const w = mount(InterviewStage, { props: { ...base, interviewerName: '온화한 선배' } })
    expect(w.text()).toContain('IT · 백엔드 · 면접관: 온화한 선배')
  })
})
```

`ReportView.test.ts` 맨 아래에 추가한다.

```ts
describe('ReportView — 면접관', () => {
  it('헤더 태그에 이 면접의 면접관 이름', () => {
    useInterviewStore().$patch({
      phase: 'report',
      reportStatus: 'writing',
      profile: { field: 'it', job: '백엔드' },
      interviewerId: 'sharp',
    })
    expect(mount(ReportView).text()).toContain('면접관: 날카로운 압박 면접관')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/components/interview src/views/ReportView.test.ts`
Expected: FAIL — `sheetFor` 없음, 가운데 style에 gentle 경로 없음, 태그 없음

- [ ] **Step 3: 구현**

`interviewerAnims.ts` 맨 아래에 추가하고, 맨 위에 `import type { CenterRole, CenterSprites } from '@/interviewers'`를 넣는다.

```ts
/** 동작 시트: 가운데 동작은 고른 면접관 스프라이트(역할별)로 푼다. loop는 동작 규칙이라 ANIMS를 따른다(spec 4.6) */
export function sheetFor(
  name: AnimName,
  center?: CenterSprites,
): { file: string; frames: number; loop: boolean } {
  const a = ANIMS[name]
  if (!center || !name.startsWith('center_')) return a
  const s = center[name.slice('center_'.length) as CenterRole]
  return { file: s.file, frames: s.frames, loop: a.loop }
}
```

`InterviewStage.vue`
- import 목록에서 `ANIMS`를 `sheetFor`로 바꾸고, `import type { CenterSprites } from '@/interviewers'`를 추가한다.
- props에 추가한다.
  ```ts
      /** 가운데(말하는) 면접관 시트 — 없으면 기본 면접관 */
      centerSprites?: CenterSprites
      interviewerName?: string
  ```
- `const sheet = (name: AnimName) => ANIMS[name]`를 `const sheet = (name: AnimName) => sheetFor(name, props.centerSprites)`로 바꾼다.
- 태그를 교체한다.
  ```vue
  <PixelTag tone="muted"
    >{{ fieldLabel }} · {{ job
    }}<template v-if="interviewerName"> · 면접관: {{ interviewerName }}</template></PixelTag
  >
  ```

`InterviewView.vue`
- import: `import { onMounted } from 'vue'`(기존 vue import에 추가), `import { useInterviewerStore } from '@/stores/interviewer'`
- `const model = useModelStore()` 아래에 추가한다.
  ```ts
  const iv = useInterviewerStore()
  onMounted(() => void iv.probeSprites()) // 새 면접관 스프라이트가 없으면 기본 면접관 시트로(spec 7절)
  ```
- `<InterviewStage …>`에 두 prop을 추가한다.
  ```vue
          :center-sprites="iv.spritesFor(s.sessionInterviewer.id)"
          :interviewer-name="s.sessionInterviewer.name"
  ```

`ReportView.vue` — 첫 태그를 교체한다.

```vue
        <PixelTag tone="muted"
          >{{ fieldLabel }} · {{ s.profile.job }} · 면접관: {{ s.sessionInterviewer.name }}</PixelTag
        >
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test && pnpm exec vue-tsc --noEmit && pnpm lint`
Expected: 전체 PASS(기존 "스프라이트 3장 + 지원자" 등 포함)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/interview frontend/src/views/InterviewView.vue frontend/src/views/ReportView.vue frontend/src/views/ReportView.test.ts
git commit -m "feat(frontend): 무대 가운데에 고른 면접관 스프라이트(없으면 기본으로 대체), 면접·리포트 태그에 면접관 이름"
```

---

### Task 12: 문서 · 전체 게이트 · 수동 확인 · PR 5 (PR 5)

**Files:**
- Modify: `docs/demo-checklist.md`, `frontend/CLAUDE.md`

- [ ] **Step 1: 데모 체크리스트**

`docs/demo-checklist.md`의 `## 면접 흐름` 절 끝에 추가한다.

```markdown
- [ ] 면접관 고르기(랜딩 두 번째 창): 카드 3장. 첫 방문은 고르기 전 동의 선택지가 비활성이고 "면접관을 먼저 골라 주세요"가 나온다. 카드를 누르면 강조되면서 그 목소리가 바로 나온다(면접 음소거를 켜 둬도 나온다). 같은 카드를 다시 누르면 처음부터, 다른 카드를 누르면 앞 소리가 멈춘다
- [ ] 첫 방문 다운로드: Network에 목소리 JSON이 **고른 면접관 것 1개만** 받아진다(`voice_styles/{ID}.json`)
- [ ] 준비 화면 "바꾸기"로 다른 면접관을 고르면 약 290KB만 받고(Gemma 재초기화 없음) 첫 질문이 새 목소리로 나온다
- [ ] 재방문(목소리만 캐시에 없음): 진행 장면이 100% 미만에서 시작해 목소리 수신과 함께 도착한다. 기능 배포 전 사용자(선택 저장값 없음)는 기본 면접관이 선택된 채 "바로 준비하기" 한 번이다
- [ ] 면접관 3명 각각 1회 완주: 온화한 선배는 꼬리질문이 적고 반응이 부드럽다, 압박 면접관은 근거·수치를 캐묻는다. 리포트가 카드로 나오고(원문 카드 아님) 말투가 면접관을 따른다. 무대 가운데·상단 태그·리포트 헤더가 고른 면접관이다
```

- [ ] **Step 2: `frontend/CLAUDE.md` 폴더 규칙**

`## 폴더 규칙`의 트리에 두 줄을 추가하고, `services/` 줄에 `preview.ts, sprites.ts`를, `stores/` 줄에 `interviewer.ts(면접관 선택)`를 덧붙인다.

```
├── interviewers/ # 면접관 정의(순수 데이터) + voices.json(목소리·미리 듣기 문장, 생성 스크립트와 공용)
├── workers/      # tts.worker.ts(Supertonic, onnxruntime-web) + ttsProtocol.ts
```

- [ ] **Step 3: 전체 게이트**

Run (`frontend/`): `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`
Expected: 전부 PASS·clean

- [ ] **Step 4: 수동 확인 (배포 전 로컬, 사람 확인 지점)**

Step 1의 체크리스트 5줄을 로컬(`pnpm dev` + 백엔드, 백엔드 `tts.voices` 포함)에서 확인한다. `setVoice`는 워커(GPU) 경로라 여기서만 검증된다.

- [ ] **Step 5: 커밋 · PR 5**

```bash
git add docs/demo-checklist.md frontend/CLAUDE.md
git commit -m "docs: 면접관 고르기·페르소나 데모 체크리스트, frontend 폴더 규칙(interviewers·workers)"
```

PR 5 제목: `feat(frontend): 무대 면접관 스프라이트·태그 + 데모 체크리스트`
- 이슈 ⑤를 닫는다. 리뷰어 @leemonta9482
- 머지 후 파이 web을 재배포한다: `ssh admin@webPi "cd /srv/apps/Woo-MoMo-Project && git pull && cd deploy && docker compose up -d --build web"`

## 이후

- 스프라이트 에셋 PR(①, @leemonta9482)이 머지되면 `index.test.ts`의 manifest 대조 테스트가 자동으로 켜지고, 무대·고르기 카드가 새 스프라이트로 바뀐다(코드 변경 없음).
- 면접관 표시 이름(사람 이름 붙이기)과 문구 조정은 spec 10절 열린 결정이다.

## Self-Review

- **스펙 커버리지**

  | spec | Task |
  |---|---|
  | 1절 결정(라인업·겉모습·무대·페르소나·시점·미리 듣기·다운로드·데이터 위치) | 2, 11 / 10 / 7·8 / 1·3·7 / 4·5·6 |
  | 2절 계약 소비 | 4, 6 |
  | 3.1 랜딩 | 7, 8 |
  | 3.2 동의 창 | 8 |
  | 3.3 재방문(엔진 기준, 기본 자동 선택) | 6, 8 |
  | 3.4 준비 화면 | 9 |
  | 3.5 면접·리포트 | 10, 11 |
  | 4.1 정의 | 2 |
  | 4.2 선택 상태·스냅샷 | 3, 10 |
  | 4.3 TTS 목소리(선택 다운로드·setVoice·캐시 정리·재방문·미리 채우기) | 4, 5, 6 |
  | 4.4 미리 듣기 | 3 |
  | 4.5 컴포넌트 | 7, 8, 9, 11 |
  | 4.6 무대 | 11 |
  | 5절 페르소나 | 10 |
  | 6.1 미리 듣기 에셋 | 1 |
  | 6.2 스프라이트 규격 | 2의 manifest 대조 테스트, 에셋은 @leemonta9482 |
  | 7절 에러 | 3(미리 듣기 실패·저장값 무효·스프라이트 대체), 4·6(voices 없음·모르는 id), 5·6(setVoice 실패 유지·선택 되돌림), 10(override 우선) |
  | 8절 테스트 | 각 Task Step 1, 수동은 Task 1·10·12 |
  | 9절 순서·역할 | PR 묶음 표 |

- **Placeholder:** 코드 단계는 모두 실제 코드다. 사람 확인 지점(Task 1 Step 5 목소리 결정, Task 10 Step 6 리허설, Task 12 Step 4)은 결정·확인 행동이다. 목소리 제안값(F1·M4)은 결정 전 기본값이고, 테스트는 `voices.json`을 읽어 결정에 따라가게 썼다.
- **타입 일관성**
  - `InterviewerId`·`CenterRole`·`CenterSprites`(Task 2) → Task 3·6·10·11
  - `useInterviewerStore().spritesFor(id)`(Task 3) → Task 7·11
  - `resolveTts`는 목소리 파일을 맨 뒤에 둔다(Task 4) → Task 6 `syncVoice`의 `files[length-1]`
  - `setTtsVoice(voice, file: TtsLoadFile)`(Task 5) → Task 6
  - `chooseInterviewer`(Task 6) → Task 7
  - `sessionInterviewer`(Task 10) → Task 11
- **함정 선제 회피**
  - Picker도 `role="radio"`라 기존 Landing 테스트의 동의 라디오 선택자를 좁혔다(Task 8).
  - `initTts`는 캐시 히트 파일도 0부터 누적 보고하므로 `Math.max`로 뒤로 가지 않게 했다(Task 6).
  - `playPreview`는 다른 재생에 밀려 거부된 `play()`를 실패로 보지 않는다(Task 3).
  - `voiceError`는 워커를 죽이지 않는다(Task 5). 옛 `error`(id 없음) 분기는 로드 실패 전용이라 쓰지 않는다.
  - 서비스 mock에서 빠진 export는 호출될 때만 터지므로, 호출하는 테스트 파일(model·Picker)에만 `setTtsVoice`를 추가했다.
