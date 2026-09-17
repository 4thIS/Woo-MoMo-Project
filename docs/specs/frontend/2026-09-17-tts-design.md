# 면접관 음성(TTS) — 설계 (spec)

- 생성일시: 2026-09-17
- 상태: 승인됨 (브레인스토밍 완료)
- 담당: 백엔드·배포 @ssenu / 프론트 @leemonta9482 (이슈 2건으로 분할)
- 상위 문서: `docs/superpowers/specs/2026-09-15-mock-interview-design.md`, `docs/specs/frontend/2026-09-15-screens-design.md` 4.3, `docs/specs/frontend/2026-09-16-prompts-design.md`
- 계약: `docs/API.md` (이 spec은 `tts` 필드를 **additive**로 추가한다)

## 0. 배경

면접관이 질문을 텍스트로만 보여준다. 면접관 목소리를 내어 "면접을 본다"는 체감을 높인다. Gemma 4는 음성을 생성하지 못하므로 별도 TTS 엔진이 필요하다. 프로젝트 원칙(이력서·대화가 기기를 떠나지 않음)에 따라 **온디바이스**여야 한다.

## 1. 결정 사항

| 항목 | 결정 |
|---|---|
| 엔진 | **Supertonic 3** (Supertone 공개, ONNX 4개 약 398MB), `onnxruntime-web` **WebGPU 실행 프로바이더**(스파이크 결과 WASM은 실시간보다 느려 부적합 — 아래 6절 측정). 스텝 수 **4**. 목소리 프리셋 **M2**, 언어 `ko`. Gemma 생성이 끝난 뒤에만 합성하므로 GPU 연산은 겹치지 않는다 |
| 실행 위치 | **Web Worker**. 메인 스레드는 얇은 프록시. 합성 중에도 애니·입력이 멈추지 않는다 |
| 타이밍 | 생성 완료 → 합성 완료 뒤 **텍스트와 음성을 동시에 시작**. 대기 중 말풍선은 "…" + 면접관 nod, 재생 중 talk 애니 + 음성 길이에 맞춘 타이핑 |
| 마이크 | 재생 중 말하기 토글·전송 비활성. 재생이 끝나면 **사용자가 직접** 다시 켠다 |
| 다운로드 | Gemma 다음 단계로 **필수**. Gemma와 TTS 둘 다 준비돼야 "면접 시작" 활성. 준비 실패 시 재시도만(폴백 없음) |
| 런타임 실패 | 합성 실패·15초 초과 시 텍스트를 즉시 표시하고 면접은 계속(준비 단계의 "폴백 없음"과 다른 층위) |
| 제어 | 음소거 토글 하나(무대 우상단, `localStorage`에 기억). 끄면 소리만 0, 타이밍·타이핑 유지 |
| 범위 | 면접 중 모델 발화 전부(짧은 반응 포함). 리포트 지시문 응답은 읽지 않음 |
| 라이선스 | 예제 코드 MIT, 모델 OpenRAIL-M. `docs/licenses/SUPERTONIC-OpenRAIL-M.txt`와 고지 추가 |

**제외**: 문장 단위 스트리밍 합성, 다시 듣기, 목소리 선택 UI, 서버 TTS, 브라우저 내장 음성 합성 폴백.

## 2. 계약 (백엔드, lockstep 먼저)

`GET /api/manifest`에 optional 필드 `tts`를 추가한다. 기존 필드 불변.

```json
"tts": {
  "id": "supertonic-3",
  "baseUrl": "/models/tts/supertonic-3/",
  "files": [
    { "path": "onnx/text_encoder.onnx", "size": 36416150 },
    { "path": "onnx/duration_predictor.onnx", "size": 3700147 },
    { "path": "onnx/vector_estimator.onnx", "size": 256534781 },
    { "path": "onnx/vocoder.onnx", "size": 101424195 },
    { "path": "onnx/tts.json", "size": 8253 },
    { "path": "onnx/unicode_indexer.json", "size": 277676 },
    { "path": "voice_styles/M2.json", "size": 292055 }
  ],
  "voice": "M2",
  "lang": "ko"
}
```

- `tts: null`이면 프론트는 음성 단계를 건너뛰고 텍스트만으로 동작한다(계약상 optional). 현재 배포값은 항상 채운다.
- `id`는 Cache API 키에 포함(모델 교체 시 캐시 갈림). `size`는 진행률과 수신 무결성 확인(Gemma와 동일 규칙).
- `baseUrl`은 `/models/`로 시작해야 한다(기존 url 규칙과 동일). `files[].path`는 `..` 금지.
- 서빙: 파이 볼륨 `/srv/momo/models/tts/supertonic-3/{onnx,voice_styles}/`. 기존 nginx `/models/` 규칙(Range·immutable·gzip off) 그대로. nginx 변경 없음.
- onnxruntime-web의 WASM 런타임은 프론트가 `public/ort-wasm/`에 복사해 같은 오리진에서 서빙(LiteRT-LM과 같은 방식). CDN 요청 0 유지.

## 3. 프론트 — 서비스와 워커 (이슈 #1)

### `workers/tts.worker.ts`
onnxruntime-web은 이 파일에서만 import한다. 스토어를 모른다.

| 메시지 (main → worker) | 응답 (worker → main) |
|---|---|
| `{ type: 'load', baseUrl, files, voice, lang, wasmPaths }` | `{ type: 'loaded' }` / `{ type: 'error', message }` |
| `{ type: 'synthesize', id, text }` | `{ type: 'audio', id, samples: Float32Array(transfer), sampleRate }` / `{ type: 'error', id, message }` |
| `{ type: 'cancel', id }` | 없음 (해당 id 결과를 폐기. ONNX run은 중단 불가) |

- 로드: `files`를 `caches.match(url)` 우선, 없으면 `fetch` → 세션 4개 생성(`executionProviders: ['webgpu']`, `wasm.wasmPaths = wasmPaths` — onnxruntime-web의 WebGPU 백엔드도 WASM 글루 파일을 쓴다) → `tts.json`·`unicode_indexer.json`·스타일 JSON 로드. WebGPU가 없으면 `error`(Gemma도 WebGPU 필수라 새 요구사항은 아님). 워커 안에서 `navigator.gpu`가 있어야 하므로 dedicated worker에서 WebGPU를 쓴다(Chrome 지원).
- 합성 파이프라인(예제 `helper.js` 이식): 텍스트 정규화 → `<ko>…</ko>` 태그 + 유니코드 인덱싱 → `duration_predictor` → `text_encoder` → `vector_estimator` 반복 → `vocoder` → Float32 파형. 120자 넘는 텍스트는 문장 단위로 나눠 합성 후 이어 붙인다.
- 스텝 수(`totalStep`)는 **4**로 고정(6절 측정). `speed` 1.05, `silenceDuration` 0.3(예제 기본값).

### `services/tts.ts` (메인 스레드 프록시)
```ts
export interface TtsManifest { id: string; baseUrl: string; files: { path: string; size: number }[]; voice: string; lang: string }
export interface AudioClip { samples: Float32Array; sampleRate: number; durationMs: number }
initTts(cfg: TtsManifest, onProgress?: (received: number, total: number) => void): Promise<void>
synthesize(text: string, signal?: AbortSignal): Promise<AudioClip>
disposeTts(): void
```
- 다운로드는 `services/modelCache.ts`를 파일별로 재사용(캐시 키 `/models-cache/${id}${path}`, 수신 바이트 ≠ 선언 크기면 저장 안 함).
- `synthesize`는 요청마다 `id`를 발급해 응답을 매칭한다. `signal` abort 시 워커에 `cancel`을 보내고 `AbortError`로 reject. 15초 타임아웃은 호출자(스토어)가 건다.

### `services/audio.ts`
```ts
playClip(clip: AudioClip, opts: { muted: boolean }): { done: Promise<void>; stop(): void }
warmUpAudio(): void   // 사용자 제스처 안에서 AudioContext.resume()
```
- `AudioContext` 하나를 모듈에서 재사용. `muted`는 `GainNode` 0 (타이밍 유지).

### 테스트 (Vitest, CI)
- 텍스트 정규화·청크 분할(순수 함수로 분리).
- 워커 프로토콜: `id` 매칭, `cancel` 뒤 도착한 `audio` 무시, 로드 전 `synthesize` 거부 (워커는 `vi.fn` 기반 가짜로 대체).
- `initTts`의 파일 순서·무결성 실패 전파(`modelCache` 모킹).
- 실제 합성·재생은 `docs/demo-checklist.md`에 항목 추가.

## 4. 프론트 — 스토어·화면 (이슈 #2)

### `stores/model.ts`
- 상태 `ttsStatus: 'idle' | 'downloading' | 'initializing' | 'ready' | 'error'`, `ttsReceived`, `ttsTotal`, `ttsError`.
- Gemma `ready` 뒤 `initTts()` → `ttsStatus='ready'`. `manifest.tts === null`이면 건너뛰고 `ready`.
- `retryTts()`: TTS만 재시도. 캐시 히트면 다운로드 없이 초기화만.

### `stores/interview.ts`
- 상태 추가: `speaking: boolean`, `revealed: string`, `muted: boolean`(`localStorage` `momo.muted`).
- `canStart`에 `ttsStatus === 'ready'` 추가.
- stage: `thinking`(생성+합성 대기) → **`speaking`**(재생+타이핑) → `waiting`. 기존 `asking`은 사용하지 않는다(스트리밍 텍스트는 `streaming`에 쌓되 말풍선에 내지 않음).
- `generate()` 완료 후: 확정 텍스트 → `synthesize(text)`(15초 타임아웃) → `playClip()` → `speaking=true`, `revealed`를 `durationMs`에 맞춰 글자 단위로 채움 → 재생 끝 → `revealed=전체`, `speaking=false`, `stage='waiting'`.
- 합성 실패·타임아웃: `revealed=전체`, `waiting`, `ttsWarning='음성을 만들지 못했습니다'`(다음 턴에 초기화).
- `abort()`: 생성 중이면 기존대로, 재생 중이면 `stop()` + `revealed=전체`. `finish()`·`reset()`은 재생 중이면 먼저 정지.
- 리포트 응답은 합성하지 않는다.

### 화면
- `InterviewStage`: `bubble`은 `revealed`. `thinking`이면 "…" + nod, `speaking`이면 talk. 애니 매핑에 `speaking → idle/talk/idle` 추가. 우상단 "면접 종료" 옆 음소거 토글(스피커 아이콘, 켜짐 `--accent`).
- `AnswerInput`: `disabled`에 `speaking` 포함(말하기 토글·전송 비활성). 침묵 자동 전송 타이머는 재생 중 시작되지 않는다.
- `InterviewView`: 답변 지연 watch는 `waiting` 진입 기준 그대로(재생 종료 뒤 20초). 면접 시작 버튼 클릭 시 `warmUpAudio()`.
- `PrepareView`: 진행 창 두 번째 단계 "목소리 준비 중"(`ttsStatus`·진행률). 캐릭터 장면은 look_up 유지. 실패 시 "다시 시도"(TTS만).

## 5. 에러 처리

| 상황 | 처리 |
|---|---|
| TTS 파일 다운로드 실패·바이트 불일치 | `ttsStatus='error'`, 준비 화면 "다시 시도". 면접 시작 잠김 |
| 워커 로드·세션 생성 실패 | 동일. 원인 한 줄 표시 |
| 합성 실패 또는 15초 초과 | 텍스트 즉시 표시, `waiting`. 말풍선 아래 한 줄 경고. 면접 계속 |
| `AudioContext` 차단 | 면접 시작 클릭에서 `warmUpAudio()`로 예방. 그래도 막히면 텍스트만 표시 |
| 재생 중 중단·종료·리셋 | 소리 정지, 텍스트 전부 표시 |

## 6. 성공 기준 (스파이크에서 먼저 측정)

- 데모 노트북에서 한국어 60자 합성 **3초 이내**(WebGPU, 스텝 4). 첫 합성은 워밍업으로 더 걸릴 수 있으므로 준비 단계에서 짧은 문장을 한 번 미리 합성해 둔다(워밍업).
- 첫 질문의 "생각 중" 대기(생성+합성) **8초 이내**, 이후 턴 **6초 이내**.
- 합성 중 메인 스레드 애니가 끊기지 않는다.
- 재방문(캐시 히트) 시 TTS 초기화 3초 이내.
- 면접 1회 완주 동안 모든 면접관 발화가 음성으로 나오고, 재생 중 마이크·전송이 잠기며, 음소거 토글이 즉시 반영된다.
- 네트워크 요청은 매니페스트·질문·모델(Gemma·TTS)·`/litert-wasm/`·`/ort-wasm/`뿐이다.

## 7. 작업 순서 (lockstep)

1. **백엔드 스파이크**: Supertonic 웹 예제를 로컬에서 그대로 실행해 한국어 문장 합성 시간과 스텝 수별 품질을 측정. 결과를 이 문서 6절 아래에 기록.
2. **백엔드 PR**: `schemas.py`(`TtsManifest`, `TtsFile`), `docs/API.md`, `data/manifest.json`, 테스트, `deploy/README.md`(TTS 파일 배치 절차), `docs/licenses/`. 머지 → 파이에 파일 배치 → `/api/manifest`가 `tts`를 내려줌.
3. **프론트 이슈 #1** (3절): 완료 기준 — 콘솔에서 `initTts(manifest.tts)` → `synthesize('안녕하세요')`가 파형을 돌려준다. 단위 테스트 통과.
4. **프론트 이슈 #2** (4절): 완료 기준 — 도메인에서 면접 1회 완주, 모든 질문 음성, 마이크 잠금·음소거 동작, 데모 체크리스트 항목 추가.
5. 파이 배포 → 도메인 리허설.

## 8. 열린 결정 (plan 단계에서 확정)

- 타이핑 속도 계산: `revealed`를 글자 수 / `durationMs`로 균등 배분(문장부호 가중치 없음). 어색하면 plan에서 조정.

## 9. 스파이크 측정 (2026-09-17, Chrome, Intel 내장 GPU xe-3lpg, 예제 `web/` 그대로, 목소리 M2, ko)

| 실행 프로바이더 | 스텝 | 51자 합성 | 85자 합성 | 오디오 길이 | RTF |
|---|---|---|---|---|---|
| wasm (단일 스레드) | 8 | 19.88s | 37.17s | 7.5s / 11.9s | 2.6 / 3.1 |
| wasm | 4 | 10.73s | 17.31s | | 1.4 |
| wasm | 2 | 6.85s | 10.76s | | 0.9 |
| **webgpu** | 8 | 3.58s(첫 호출, 워밍업 포함) | 0.86s | | 0.48 / 0.07 |
| **webgpu** | 4 | **0.30s** | **0.39s** | | 0.04 / 0.03 |
| webgpu | 2 | 0.22s | | | 0.03 |

- 모델 로드(세션 4개): wasm 3.7s, webgpu 3.8s.
- 결정: **WebGPU, 스텝 4**. WASM은 스텝 2에서도 실시간(RTF 0.9)에 가까워 "동시 출력" 대기가 7~11초가 되므로 부적합. WASM 멀티스레드(COOP/COEP)로도 3~4배 이상 빨라지기 어렵다.
- GPU 동시 사용 확인(같은 기기, 두 탭): Gemma E4B를 LiteRT-LM으로 GPU에 올린 상태에서 TTS WebGPU 로드 3.3s, 합성 0.39/0.34/0.32s(스텝 4, 46자). 그 뒤 Gemma 생성도 정상(7.7s, 세션 생성 포함). 메모리 경합 없음. 프론트 #12에서는 워커 안에서 한 번 더 확인.
