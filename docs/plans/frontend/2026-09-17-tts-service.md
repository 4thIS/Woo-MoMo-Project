# frontend plan 4 — 면접관 음성 TTS #1: 워커·services/tts.ts·audio.ts (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-17
- 담당: @leemonta9482. 브랜치: `feature/frontend-tts-service` (main `8ff3ea1`에서 생성). 이슈 #12
- 선행: 계약 PR #14 머지됨(`manifest.tts`). 후속: 이슈 #13(스토어·화면 연동)

**Goal:** Supertonic 3(ONNX)를 Web Worker에서 onnxruntime-web **WebGPU**로 돌려 `synthesize(text)`가 `AudioClip`을 돌려주고 `playClip`으로 들리게 한다. 화면·스토어는 건드리지 않는다.

**Architecture:** `workers/tts.worker.ts`만 onnxruntime-web을 import하고 세션 4개·스타일·인덱서를 들고 있다. 메인 스레드의 `services/tts.ts`는 워커 프록시(요청 id 매칭·abort·다운로드는 `modelCache` 재사용). 텍스트 정규화·청크·ID 변환·마스크 같은 순수 계산은 `utils/tts.ts`로 분리해 Vitest로 고정한다. `services/audio.ts`는 `AudioContext` 하나로 재생·음소거·정지.

**Tech Stack:** Vue 3 + TS + Vitest(기존), `onnxruntime-web@1.30.0`(신규, WebGPU EP = `onnxruntime-web/webgpu` 진입점, WASM 글루 `ort-wasm-simd-threaded.jsep.{wasm,mjs}`를 `public/ort-wasm/`에서 같은 오리진 서빙)

**Spec:** `docs/specs/frontend/2026-09-17-tts-design.md` 3절(이 plan), 2절(계약), 6절(성공 기준), 9절(스파이크 수치)

## Global Constraints

- 자기 영역(`frontend/`)만 + 루트 `.gitignore` 한 줄(`frontend/public/ort-wasm/`). `backend/`·`deploy/` 수정 없음. 계약 변경 없음(`manifest.tts`는 이미 머지됨).
- 계층: `utils/`는 브라우저 API·스토어 import 금지. `services/`는 스토어 import 금지. onnxruntime-web import는 **`src/workers/tts.worker.ts` 한 곳**.
- 네트워크: CDN 요청 0. WASM은 `/ort-wasm/`(같은 오리진). 모델은 `baseUrl + path`(`/models/...`).
- 인터페이스는 이슈 #12 본문 그대로 유지(#13이 의존):
  ```ts
  export interface TtsManifest { id: string; baseUrl: string; files: { path: string; size: number }[]; voice: string; lang: string }
  export interface AudioClip { samples: Float32Array; sampleRate: number; durationMs: number }
  initTts(cfg: TtsManifest, onProgress?: (received: number, total: number) => void): Promise<void>
  synthesize(text: string, signal?: AbortSignal): Promise<AudioClip>
  disposeTts(): void
  playClip(clip: AudioClip, opts: { muted: boolean }): { done: Promise<void>; stop(): void }
  warmUpAudio(): void
  ```
- 워커 프로토콜(spec 3절): main→worker `load {baseUrl, files:[{path,size,cacheKey}], voice, lang, wasmPaths}` / `synthesize {id, text}` / `cancel {id}`; worker→main `loaded` / `audio {id, samples(Float32Array transfer), sampleRate}` / `error {id?, message}` / `progress {stage}`(선택).
- 합성 상수: `TOTAL_STEP = 4`, `SPEED = 1.05`, `SILENCE_SEC = 0.3`, ko/ja 청크 상한 120자(그 외 300). `executionProviders: ['webgpu']`, `graphOptimizationLevel: 'all'`.
- 다운로드: 파일별 `modelCache.hasModel/downloadModel(id, url, size, onProgress)` 재사용. 캐시 키 `cacheKey(id, url)` = `/models-cache/${id}${url}`. 수신 ≠ 선언 크기면 `downloadModel`이 throw → `initTts`가 그대로 전파.
- 모든 명령은 `frontend/`에서 `pnpm`으로. 게이트: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`.
- 커밋 `feat(frontend):` / `test(frontend):` / `chore(frontend):`. AI 저작 표기 금지. 새 코드는 실패 테스트 → 구현 → 통과.

## 파일 구조

```
frontend/
├── package.json                       # + onnxruntime-web ^1.30.0, postinstall/prebuild에 copy-ort-wasm 추가
├── scripts/copy-ort-wasm.mjs          # 신규: dist/ort-wasm-simd-threaded.jsep.{wasm,mjs} → public/ort-wasm/
├── public/ort-wasm/                   # gitignore (postinstall 생성)
└── src/
    ├── types/api.ts                   # + TtsFile, TtsManifest, Manifest.tts?: TtsManifest | null
    ├── utils/tts.ts                   # 신규: normalizeText, chunkText, textToIds, lengthMask, latentShape, boxMuller
    ├── utils/tts.test.ts
    ├── workers/tts.worker.ts          # 신규: onnxruntime-web(webgpu) 세션·파이프라인·메시지 루프
    ├── workers/ttsProtocol.ts         # 신규: 메시지 타입(main/worker 공용, 런타임 코드 없음)
    ├── services/tts.ts                # 신규: initTts / synthesize / disposeTts
    ├── services/tts.test.ts
    ├── services/audio.ts              # 신규: playClip / warmUpAudio
    ├── services/audio.test.ts
    └── main.ts                        # DEV 전용 window.__momoTts 노출(콘솔 완료 기준)
../.gitignore                          # + frontend/public/ort-wasm/
docs/demo-checklist.md                 # + "TTS 콘솔 합성" 항목
```

---

### Task 1: 의존성 + WASM 복사 스크립트 + 타입

**Files:**

- Modify: `frontend/package.json`, `../.gitignore`
- Create: `frontend/scripts/copy-ort-wasm.mjs`
- Modify: `frontend/src/types/api.ts`

**Interfaces:**

- Produces: `TtsFile`, `TtsManifest`(types/api.ts), `public/ort-wasm/ort-wasm-simd-threaded.jsep.wasm` + `.mjs`

- [ ] **Step 1: 의존성** — `pnpm add onnxruntime-web@1.30.0` (이미 브랜치에서 실행돼 있으면 `git status`로 `package.json`/`pnpm-lock.yaml` 변경만 확인)

- [ ] **Step 2: 복사 스크립트** `frontend/scripts/copy-ort-wasm.mjs`

```js
// node_modules/onnxruntime-web/dist 의 WebGPU(jsep) 글루만 public/ort-wasm 으로 (같은 오리진 서빙, CDN 금지)
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/onnxruntime-web/dist");
const dst = resolve(root, "public/ort-wasm");
const files = [
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
];
for (const f of files) {
  if (!existsSync(resolve(src, f))) {
    console.error("copy-ort-wasm: source not found:", resolve(src, f));
    process.exit(1);
  }
}
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of files) copyFileSync(resolve(src, f), resolve(dst, f));
console.log("copy-ort-wasm: copied", files.length, "files to", dst);
```

`package.json` scripts:

```json
"postinstall": "node scripts/copy-litert-wasm.mjs && node scripts/copy-ort-wasm.mjs",
"prebuild": "node scripts/copy-litert-wasm.mjs && node scripts/copy-ort-wasm.mjs"
```

루트 `.gitignore`의 `frontend/public/litert-wasm/` 아래에 `frontend/public/ort-wasm/` 추가.

- [ ] **Step 3: 실행 확인** — `node scripts/copy-ort-wasm.mjs` → `public/ort-wasm/`에 2파일(약 28MB + 글루). `git status`에 `public/ort-wasm`이 안 보여야 한다.

- [ ] **Step 4: 타입** `src/types/api.ts`에 추가:

```ts
export interface TtsFile {
  path: string;
  size: number;
}
/** /api/manifest의 tts (docs/API.md). null이면 음성 단계 없음 */
export interface TtsManifest {
  id: string;
  baseUrl: string;
  files: TtsFile[];
  voice: string;
  lang: string;
}
```

`Manifest`에 `tts?: TtsManifest | null` 추가(optional — 옛 매니페스트 픽스처 호환).

- [ ] **Step 5: 게이트 일부** — `pnpm exec vue-tsc --noEmit && pnpm vitest run` 통과(기존 테스트 영향 없음).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/copy-ort-wasm.mjs src/types/api.ts ../.gitignore
git commit -m "chore(frontend): onnxruntime-web 1.30 추가, WebGPU 글루를 public/ort-wasm으로 복사(postinstall), 매니페스트 tts 타입"
```

---

### Task 2: `utils/tts.ts` 순수 함수 (정규화·청크·ID·마스크·잡음)

**Files:**

- Create: `frontend/src/utils/tts.ts`, `frontend/src/utils/tts.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export const KO_JA_MAX = 120; export const DEFAULT_MAX = 300
  normalizeText(text: string, lang: string): string        // 예제 preprocessText 이식: NFKD, 이모지 제거, 치환, 문장부호 공백, 끝에 '.' 보정, <lang>…</lang> 래핑
  chunkText(text: string, maxLen: number): string[]          // 예제 chunkText 이식
  textToIds(wrapped: string, indexer: number[]): number[]    // codePointAt → indexer[cp] (범위 밖 -1)
  lengthMask(lengths: number[], maxLen?: number): number[][] // [len][maxLen] 0/1
  latentShape(durSec: number, sampleRate: number, baseChunk: number, compress: number, latentDim: number): { latentLen: number; latentDimVal: number; chunkSize: number }
  gaussianNoise(n: number, rng?: () => number): Float32Array // Box–Muller, rng 주입 가능
  ```

- [ ] **Step 1: 실패 테스트** `src/utils/tts.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  KO_JA_MAX,
  chunkText,
  gaussianNoise,
  latentShape,
  lengthMask,
  normalizeText,
  textToIds,
} from "./tts";

describe("normalizeText", () => {
  it("공백 정리 + 끝에 마침표 + 언어 태그", () => {
    expect(normalizeText("안녕하세요   자기소개 부탁드립니다", "ko")).toBe(
      "<ko>안녕하세요 자기소개 부탁드립니다.</ko>",
    );
  });
  it("문장부호로 끝나면 마침표를 덧붙이지 않는다", () => {
    expect(normalizeText("어떻게 해결하셨나요?", "ko")).toBe(
      "<ko>어떻게 해결하셨나요?</ko>",
    );
  });
  it("이모지·대시·괄호 치환, 문장부호 앞 공백 제거", () => {
    expect(normalizeText("좋아요 😀 — 그럼 , 다음 [질문]", "ko")).toBe(
      "<ko>좋아요 - 그럼, 다음 질문.</ko>",
    );
  });
  it("지원하지 않는 언어는 던진다", () => {
    expect(() => normalizeText("x", "zz")).toThrow(/Invalid language/);
  });
});

describe("chunkText", () => {
  it("짧은 글은 한 덩어리", () => {
    expect(chunkText("첫 문장입니다. 둘째 문장입니다.", KO_JA_MAX)).toEqual([
      "첫 문장입니다. 둘째 문장입니다.",
    ]);
  });
  it("상한을 넘으면 문장 경계에서 나눈다", () => {
    const s1 = "가".repeat(70) + ".";
    const s2 = "나".repeat(70) + ".";
    expect(chunkText(`${s1} ${s2}`, KO_JA_MAX)).toEqual([s1, s2]);
  });
  it("빈 단락은 버린다", () => {
    expect(chunkText("하나.\n\n\n둘.", 300)).toEqual(["하나.", "둘."]);
  });
});

describe("textToIds / lengthMask / latentShape / gaussianNoise", () => {
  it("textToIds는 코드포인트를 인덱서로 바꾸고 범위 밖은 -1", () => {
    const indexer = new Array(128).fill(0).map((_, i) => i + 1);
    expect(textToIds("ab", indexer)).toEqual([98, 99]);
    expect(textToIds("가", indexer)).toEqual([-1]);
  });
  it("lengthMask는 길이만큼 1", () => {
    expect(lengthMask([2, 3])).toEqual([
      [1, 1, 0],
      [1, 1, 1],
    ]);
    expect(lengthMask([1], 3)).toEqual([[1, 0, 0]]);
  });
  it("latentShape는 예제와 같은 수식", () => {
    // 2.0초, 44100Hz, base_chunk 512, compress 6, latent_dim 24 → chunk 3072, latentLen ceil(88200/3072)=29, dim 144
    expect(latentShape(2, 44100, 512, 6, 24)).toEqual({
      latentLen: 29,
      latentDimVal: 144,
      chunkSize: 3072,
    });
  });
  it("gaussianNoise는 주입한 rng로 결정적", () => {
    let k = 0;
    const rng = () => [0.5, 0.25, 0.5, 0.75][k++ % 4];
    const a = gaussianNoise(2, rng);
    k = 0;
    const b = gaussianNoise(2, rng);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 실행 → 실패** `pnpm vitest run src/utils/tts.test.ts` (모듈 없음)

- [ ] **Step 3: 구현** `src/utils/tts.ts` — 예제 `helper.js`(MIT, https://github.com/supertone-inc/supertonic/blob/main/web/helper.js)의 `preprocessText`·`chunkText`·`lengthToMask`·`sampleNoisyLatent`의 계산부를 TS로 옮긴다. 파일 머리에 출처 주석 한 줄.

```ts
/** Supertonic 3 텍스트 전처리·형태 계산 (supertone-inc/supertonic web/helper.js, MIT 이식). 브라우저 API 없음 */
export const AVAILABLE_LANGS = [
  "en",
  "ko",
  "ja",
  "ar",
  "bg",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "et",
  "fi",
  "fr",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "lt",
  "lv",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi",
  "na",
];
export const KO_JA_MAX = 120;
export const DEFAULT_MAX = 300;

const EMOJI =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
const REPLACE: [string, string][] = [
  ["–", "-"],
  ["‑", "-"],
  ["—", "-"],
  ["_", " "],
  ["\u201C", '"'],
  ["\u201D", '"'],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["´", "'"],
  ["`", "'"],
  ["[", " "],
  ["]", " "],
  ["|", " "],
  ["/", " "],
  ["#", " "],
  ["→", " "],
  ["←", " "],
];
const EXPR: [string, string][] = [
  ["@", " at "],
  ["e.g.,", "for example, "],
  ["i.e.,", "that is, "],
];

export function normalizeText(text: string, lang: string): string {
  if (!AVAILABLE_LANGS.includes(lang))
    throw new Error(`Invalid language: ${lang}`);
  let t = text.normalize("NFKD").replace(EMOJI, "");
  for (const [a, b] of REPLACE) t = t.replaceAll(a, b);
  t = t.replace(/[♥☆♡©\\]/g, "");
  for (const [a, b] of EXPR) t = t.replaceAll(a, b);
  t = t.replace(/ ([,.!?;:'])/g, "$1");
  while (t.includes('""')) t = t.replace('""', '"');
  while (t.includes("''")) t = t.replace("''", "'");
  t = t.replace(/\s+/g, " ").trim();
  if (!/[.!?;:,'")\]}…。」』】〉》›»]$/.test(t)) t += ".";
  return `<${lang}>${t}</${lang}>`;
}

export function chunkText(text: string, maxLen: number): string[] {
  const out: string[] = [];
  for (const para of text.trim().split(/\n\s*\n+/)) {
    const p = para.trim();
    if (!p) continue;
    const sentences = p.split(
      /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/,
    );
    let cur = "";
    for (const s of sentences) {
      if (cur.length + s.length + 1 <= maxLen) cur += (cur ? " " : "") + s;
      else {
        if (cur) out.push(cur.trim());
        cur = s;
      }
    }
    if (cur) out.push(cur.trim());
  }
  return out;
}

export function textToIds(wrapped: string, indexer: number[]): number[] {
  const ids: number[] = [];
  for (const ch of wrapped) {
    const cp = ch.codePointAt(0) ?? 0;
    ids.push(cp < indexer.length ? indexer[cp] : -1);
  }
  return ids;
}

export function lengthMask(lengths: number[], maxLen?: number): number[][] {
  const m = maxLen ?? Math.max(...lengths);
  return lengths.map((len) =>
    Array.from({ length: m }, (_, j) => (j < len ? 1 : 0)),
  );
}

export function latentShape(
  durSec: number,
  sampleRate: number,
  baseChunk: number,
  compress: number,
  latentDim: number,
) {
  const chunkSize = baseChunk * compress;
  const wavLen = Math.floor(durSec * sampleRate);
  return {
    latentLen: Math.floor((wavLen + chunkSize - 1) / chunkSize),
    latentDimVal: latentDim * compress,
    chunkSize,
  };
}

export function gaussianNoise(
  n: number,
  rng: () => number = Math.random,
): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(0.0001, rng());
    const u2 = rng();
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}
```

주의: `textToIds`는 `for…of`로 코드포인트 단위(예제의 `codePointAt(j)`는 서로게이트 쌍에서 어긋나는데, 한국어·이모지 제거 후엔 차이 없음 — 코드포인트 단위가 맞다).

- [ ] **Step 4: 실행 → 통과** `pnpm vitest run src/utils/tts.test.ts`. 세 번째 normalize 테스트의 기대값이 이식 규칙과 한 글자라도 어긋나면 **구현이 아니라 기대값을 예제 규칙에 맞춰 고친다**(예제가 기준).

- [ ] **Step 5: Commit** `git commit -m "feat(frontend): TTS 텍스트 정규화·청크·ID·마스크·잡음 순수 함수 (Supertonic helper.js 이식)"`

---

### Task 3: 워커 프로토콜 타입 + `workers/tts.worker.ts`

**Files:**

- Create: `frontend/src/workers/ttsProtocol.ts`, `frontend/src/workers/tts.worker.ts`

**Interfaces:**

- Produces(`ttsProtocol.ts`):

  ```ts
  export interface TtsLoadFile {
    path: string;
    size: number;
    url: string;
    cacheKey: string;
  }
  export type MainToWorker =
    | {
        type: "load";
        baseUrl: string;
        files: TtsLoadFile[];
        voice: string;
        lang: string;
        wasmPaths: string;
      }
    | { type: "synthesize"; id: number; text: string }
    | { type: "cancel"; id: number };
  export type WorkerToMain =
    | { type: "loaded" }
    | { type: "progress"; stage: string }
    | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
    | { type: "error"; id?: number; message: string };
  export const TOTAL_STEP = 4;
  export const SPEED = 1.05;
  export const SILENCE_SEC = 0.3;
  ```

- [ ] **Step 1: 프로토콜 파일** 위 그대로 작성(런타임 코드 없음 → 테스트 불필요).

- [ ] **Step 2: 워커** `src/workers/tts.worker.ts` — onnxruntime-web은 여기서만.

```ts
/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/webgpu";
import {
  DEFAULT_MAX,
  KO_JA_MAX,
  chunkText,
  gaussianNoise,
  latentShape,
  lengthMask,
  normalizeText,
  textToIds,
} from "@/utils/tts";
import {
  SILENCE_SEC,
  SPEED,
  TOTAL_STEP,
  type MainToWorker,
  type TtsLoadFile,
  type WorkerToMain,
} from "./ttsProtocol";

type Cfg = {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
};
type Style = { ttl: ort.Tensor; dp: ort.Tensor };
const CACHE = "momo-models";

let sessions: {
  dp: ort.InferenceSession;
  enc: ort.InferenceSession;
  est: ort.InferenceSession;
  voc: ort.InferenceSession;
} | null = null;
let cfg: Cfg | null = null;
let style: Style | null = null;
let indexer: number[] = [];
let lang = "ko";
const cancelled = new Set<number>();

const post = (m: WorkerToMain, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);

/** 캐시 우선, 없으면 fetch. (initTts가 먼저 내려받아 캐시에 넣어 두므로 보통 캐시 히트) */
async function fetchFile(f: TtsLoadFile): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(f.cacheKey);
  if (hit) return hit;
  const res = await fetch(f.url);
  if (!res.ok) throw new Error(`tts file ${res.status}: ${f.path}`);
  return res;
}
const byPath = (files: TtsLoadFile[], suffix: string) => {
  const f = files.find((x) => x.path.endsWith(suffix));
  if (!f) throw new Error(`manifest.tts에 ${suffix} 없음`);
  return f;
};

async function load(msg: Extract<MainToWorker, { type: "load" }>) {
  if (!("gpu" in navigator))
    throw new Error("이 브라우저(워커)에서 WebGPU를 쓸 수 없습니다");
  ort.env.wasm.wasmPaths = msg.wasmPaths;
  ort.env.wasm.numThreads = 1;
  lang = msg.lang;
  const opt: ort.InferenceSession.SessionOptions = {
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "all",
  };
  const mk = async (suffix: string, stage: string) => {
    post({ type: "progress", stage });
    const buf = await (
      await fetchFile(byPath(msg.files, suffix))
    ).arrayBuffer();
    return ort.InferenceSession.create(buf, opt);
  };
  const dp = await mk("duration_predictor.onnx", "길이 예측기");
  const enc = await mk("text_encoder.onnx", "텍스트 인코더");
  const est = await mk("vector_estimator.onnx", "벡터 추정기");
  const voc = await mk("vocoder.onnx", "보코더");
  cfg = (await (await fetchFile(byPath(msg.files, "tts.json"))).json()) as Cfg;
  indexer = (await (
    await fetchFile(byPath(msg.files, "unicode_indexer.json"))
  ).json()) as number[];
  const vs = (await (
    await fetchFile(byPath(msg.files, `voice_styles/${msg.voice}.json`))
  ).json()) as {
    style_ttl: { dims: number[]; data: unknown[] };
    style_dp: { dims: number[]; data: unknown[] };
  };
  const flat = (d: unknown[]) =>
    new Float32Array((d as number[][][]).flat(Infinity as 1) as number[]);
  style = {
    ttl: new ort.Tensor("float32", flat(vs.style_ttl.data), [
      1,
      vs.style_ttl.dims[1],
      vs.style_ttl.dims[2],
    ]),
    dp: new ort.Tensor("float32", flat(vs.style_dp.data), [
      1,
      vs.style_dp.dims[1],
      vs.style_dp.dims[2],
    ]),
  };
  sessions = { dp, enc, est, voc };
}

/** 한 청크 합성: duration → text_encoder → vector_estimator×TOTAL_STEP → vocoder */
async function inferChunk(
  text: string,
): Promise<{ wav: Float32Array; durSec: number }> {
  if (!sessions || !cfg || !style) throw new Error("not loaded");
  const wrapped = normalizeText(text, lang);
  const ids = textToIds(wrapped, indexer);
  const textIds = new ort.Tensor(
    "int64",
    BigInt64Array.from(ids, (x) => BigInt(x)),
    [1, ids.length],
  );
  const textMask = new ort.Tensor(
    "float32",
    Float32Array.from(lengthMask([ids.length])[0]),
    [1, 1, ids.length],
  );

  const dpOut = await sessions.dp.run({
    text_ids: textIds,
    style_dp: style.dp,
    text_mask: textMask,
  });
  const durSec = Number((dpOut.duration.data as Float32Array)[0]) / SPEED;

  const encOut = await sessions.enc.run({
    text_ids: textIds,
    style_ttl: style.ttl,
    text_mask: textMask,
  });
  const textEmb = encOut.text_emb;

  const { latentLen, latentDimVal, chunkSize } = latentShape(
    durSec,
    cfg.ae.sample_rate,
    cfg.ae.base_chunk_size,
    cfg.ttl.chunk_compress_factor,
    cfg.ttl.latent_dim,
  );
  const validLen = Math.floor(
    (Math.floor(durSec * cfg.ae.sample_rate) + chunkSize - 1) / chunkSize,
  );
  const mask = Float32Array.from(lengthMask([validLen], latentLen)[0]);
  let xt = gaussianNoise(latentDimVal * latentLen);
  for (let d = 0; d < latentDimVal; d++)
    for (let t = 0; t < latentLen; t++) xt[d * latentLen + t] *= mask[t];
  const latentMask = new ort.Tensor("float32", mask, [1, 1, latentLen]);
  const totalStep = new ort.Tensor("float32", Float32Array.of(TOTAL_STEP), [1]);
  for (let step = 0; step < TOTAL_STEP; step++) {
    const out = await sessions.est.run({
      noisy_latent: new ort.Tensor("float32", xt, [1, latentDimVal, latentLen]),
      text_emb: textEmb,
      style_ttl: style.ttl,
      latent_mask: latentMask,
      text_mask: textMask,
      current_step: new ort.Tensor("float32", Float32Array.of(step), [1]),
      total_step: totalStep,
    });
    xt = Float32Array.from(out.denoised_latent.data as Float32Array);
  }
  const voc = await sessions.voc.run({
    latent: new ort.Tensor("float32", xt, [1, latentDimVal, latentLen]),
  });
  return { wav: Float32Array.from(voc.wav_tts.data as Float32Array), durSec };
}

async function synthesize(id: number, text: string) {
  if (!sessions || !cfg) throw new Error("not loaded");
  const maxLen = lang === "ko" || lang === "ja" ? KO_JA_MAX : DEFAULT_MAX;
  const chunks = chunkText(text, maxLen);
  const parts: Float32Array[] = [];
  const silence = new Float32Array(
    Math.floor(SILENCE_SEC * cfg.ae.sample_rate),
  );
  for (let i = 0; i < chunks.length; i++) {
    if (cancelled.has(id)) return;
    if (i > 0) parts.push(silence);
    parts.push((await inferChunk(chunks[i])).wav);
  }
  if (cancelled.has(id)) return;
  const total = parts.reduce((n, p) => n + p.length, 0);
  const samples = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    samples.set(p, off);
    off += p.length;
  }
  post({ type: "audio", id, samples, sampleRate: cfg.ae.sample_rate }, [
    samples.buffer,
  ]);
}

self.onmessage = async (e: MessageEvent<MainToWorker>) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      await load(m);
      post({ type: "loaded" });
    } else if (m.type === "synthesize") {
      await synthesize(m.id, m.text);
    } else if (m.type === "cancel") {
      cancelled.add(m.id);
    }
  } catch (err) {
    post({
      type: "error",
      id: m.type === "synthesize" ? m.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (m.type === "synthesize") cancelled.delete(m.id);
  }
};
```

- `BigInt64Array.from(ids, x => BigInt(x))`: `lib`에 ES2020 BigInt가 있어야 한다(현재 `ES2022` ✓).
- `flat(Infinity as 1)`가 vue-tsc에서 걸리면 `(vs.style_ttl.data as number[][][]).flat(2)`로 바꾼다(스타일 JSON은 3차원).
- 워커 안 `navigator.gpu` 확인은 WorkerNavigator 타입에 `gpu`가 없을 수 있으므로 `'gpu' in navigator`로.

- [ ] **Step 3: 타입 검사** `pnpm exec vue-tsc --noEmit` 통과. 워커 파일은 `tsconfig` `include`(`src/**/*.ts`)에 이미 들어간다. `/// <reference lib="webworker" />`와 `DOM` lib 충돌이 나면 `self as unknown as Worker` 캐스팅으로 우회(이미 그렇게 씀).

- [ ] **Step 4: 빌드 확인** `pnpm build` — Vite가 워커를 별도 청크로 낸다(`dist/assets/tts.worker-*.js`). onnxruntime-web 경고(“chunk size”)는 허용.

- [ ] **Step 5: Commit** `git commit -m "feat(frontend): TTS 워커 — onnxruntime-web WebGPU 세션 4개, Supertonic 파이프라인(스텝 4), load/synthesize/cancel 프로토콜"`

---

### Task 4: `services/tts.ts` 프록시 (다운로드·id 매칭·abort) + 테스트

**Files:**

- Create: `frontend/src/services/tts.ts`, `frontend/src/services/tts.test.ts`

**Interfaces:**

- Consumes: `hasModel/downloadModel/cacheKey`(modelCache), `ttsProtocol`
- Produces: `initTts`, `synthesize`, `disposeTts`, `AudioClip`, `TtsManifest`(re-export from types/api), 테스트용 `__setWorkerFactory(f | null)`

- [ ] **Step 1: 실패 테스트** `src/services/tts.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/modelCache", () => ({
  cacheKey: (id: string, url: string) => `/models-cache/${id}${url}`,
  hasModel: vi.fn(async () => false),
  downloadModel: vi.fn(
    async (
      _id: string,
      _url: string,
      size: number,
      onProgress: (r: number) => void,
    ) => {
      onProgress(size);
    },
  ),
}));
import { downloadModel, hasModel } from "@/services/modelCache";
import { __setWorkerFactory, disposeTts, initTts, synthesize } from "./tts";
import type { MainToWorker, WorkerToMain } from "@/workers/ttsProtocol";

/** 가짜 워커: 보낸 메시지를 기록하고, 테스트가 응답을 주입한다 */
class FakeWorker {
  sent: MainToWorker[] = [];
  onmessage: ((e: MessageEvent<WorkerToMain>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(m: MainToWorker) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: WorkerToMain) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerToMain>);
  }
}

const cfg = {
  id: "supertonic-3",
  baseUrl: "/models/tts/supertonic-3/",
  files: [
    { path: "onnx/text_encoder.onnx", size: 30 },
    { path: "onnx/tts.json", size: 10 },
    { path: "voice_styles/M2.json", size: 20 },
  ],
  voice: "M2",
  lang: "ko",
};
let w: FakeWorker;
beforeEach(() => {
  w = new FakeWorker();
  __setWorkerFactory(() => w as unknown as Worker);
  vi.mocked(hasModel).mockResolvedValue(false);
});
afterEach(() => {
  disposeTts();
  __setWorkerFactory(null);
  vi.clearAllMocks();
});

/** initTts를 시작하고 워커의 load 메시지가 갈 때까지 기다린다 */
async function startInit(onProgress?: (r: number, t: number) => void) {
  const p = initTts(cfg, onProgress);
  await vi.waitFor(() =>
    expect(w.sent.some((m) => m.type === "load")).toBe(true),
  );
  return p;
}

describe("initTts", () => {
  it("파일을 순서대로 내려받고(캐시 히트는 건너뜀) 진행률을 합산한 뒤 워커에 load를 보낸다", async () => {
    vi.mocked(hasModel).mockImplementation(async (_id, url) =>
      url.endsWith("tts.json"),
    );
    const prog: [number, number][] = [];
    const p = startInit((r, t) => prog.push([r, t]));
    await p.then(
      () => undefined,
      () => undefined,
    ); // load 응답 전엔 pending — 아래에서 응답
    const calls = vi.mocked(downloadModel).mock.calls.map((c) => c[1]);
    expect(calls).toEqual([
      "/models/tts/supertonic-3/onnx/text_encoder.onnx",
      "/models/tts/supertonic-3/voice_styles/M2.json",
    ]);
    expect(prog.at(-1)).toEqual([60, 60]); // 캐시 히트 파일도 total·received에 포함
    const load = w.sent.find((m) => m.type === "load") as Extract<
      MainToWorker,
      { type: "load" }
    >;
    expect(load.files.map((f) => f.cacheKey)).toEqual([
      "/models-cache/supertonic-3/models/tts/supertonic-3/onnx/text_encoder.onnx",
      "/models-cache/supertonic-3/models/tts/supertonic-3/onnx/tts.json",
      "/models-cache/supertonic-3/models/tts/supertonic-3/voice_styles/M2.json",
    ]);
    expect(load.wasmPaths).toBe("/ort-wasm/");
    expect(load.voice).toBe("M2");
  });
  it("다운로드 무결성 실패는 그대로 전파되고 워커는 만들지 않는다", async () => {
    vi.mocked(downloadModel).mockRejectedValueOnce(
      new Error("incomplete: 10/30"),
    );
    await expect(initTts(cfg)).rejects.toThrow(/incomplete/);
    expect(w.sent).toHaveLength(0);
  });
  it("워커가 error로 답하면 initTts가 거부된다", async () => {
    const p = startInit();
    w.reply({ type: "error", message: "WebGPU 없음" });
    await expect(p).rejects.toThrow(/WebGPU 없음/);
  });
});

describe("synthesize", () => {
  async function ready() {
    const p = startInit();
    w.reply({ type: "loaded" });
    await p;
  }
  it("로드 전엔 거부", async () => {
    await expect(synthesize("안녕")).rejects.toThrow(/not loaded|초기화/);
  });
  it("요청 id로 응답을 매칭해 AudioClip을 만든다(durationMs = samples/sampleRate)", async () => {
    await ready();
    const p1 = synthesize("하나");
    const p2 = synthesize("둘");
    const [m1, m2] = w.sent.filter((m) => m.type === "synthesize") as Extract<
      MainToWorker,
      { type: "synthesize" }
    >[];
    expect(m1.id).not.toBe(m2.id);
    w.reply({
      type: "audio",
      id: m2.id,
      samples: new Float32Array(44100),
      sampleRate: 44100,
    });
    w.reply({
      type: "audio",
      id: m1.id,
      samples: new Float32Array(22050),
      sampleRate: 44100,
    });
    const [c1, c2] = await Promise.all([p1, p2]);
    expect(c1.durationMs).toBe(500);
    expect(c2.durationMs).toBe(1000);
    expect(c2.samples).toHaveLength(44100);
  });
  it("abort하면 워커에 cancel을 보내고 AbortError로 거부하며, 늦게 온 audio는 무시한다", async () => {
    await ready();
    const ac = new AbortController();
    const p = synthesize("취소될 문장", ac.signal);
    const req = w.sent.find((m) => m.type === "synthesize") as Extract<
      MainToWorker,
      { type: "synthesize" }
    >;
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(w.sent).toContainEqual({ type: "cancel", id: req.id });
    expect(() =>
      w.reply({
        type: "audio",
        id: req.id,
        samples: new Float32Array(1),
        sampleRate: 44100,
      }),
    ).not.toThrow();
  });
  it("워커 error(id 있음)는 해당 요청만 거부한다", async () => {
    await ready();
    const p = synthesize("실패");
    const req = w.sent.find((m) => m.type === "synthesize") as Extract<
      MainToWorker,
      { type: "synthesize" }
    >;
    w.reply({ type: "error", id: req.id, message: "run failed" });
    await expect(p).rejects.toThrow(/run failed/);
  });
  it("disposeTts는 워커를 terminate하고 대기 중 요청을 거부한다", async () => {
    await ready();
    const p = synthesize("중단");
    disposeTts();
    expect(w.terminated).toBe(true);
    await expect(p).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실행 → 실패** `pnpm vitest run src/services/tts.test.ts`

- [ ] **Step 3: 구현** `src/services/tts.ts`

```ts
import { cacheKey, downloadModel, hasModel } from "@/services/modelCache";
import type { TtsManifest } from "@/types/api";
import type {
  MainToWorker,
  TtsLoadFile,
  WorkerToMain,
} from "@/workers/ttsProtocol";

export type { TtsManifest } from "@/types/api";
export interface AudioClip {
  samples: Float32Array;
  sampleRate: number;
  durationMs: number;
}

const WASM_PATHS = "/ort-wasm/";
type Pending = {
  resolve: (c: AudioClip) => void;
  reject: (e: unknown) => void;
};

let worker: Worker | null = null;
let loaded = false;
let nextId = 1;
const pending = new Map<number, Pending>();

/** 테스트에서 가짜 워커를 꽂는다. null이면 실제 워커 */
let factory: (() => Worker) | null = null;
export function __setWorkerFactory(f: (() => Worker) | null) {
  factory = f;
}
const spawn = () =>
  factory
    ? factory()
    : new Worker(new URL("../workers/tts.worker.ts", import.meta.url), {
        type: "module",
      });

function fail(e: unknown) {
  for (const p of pending.values()) p.reject(e);
  pending.clear();
}

/** 파일을 순서대로 내려받아 캐시에 넣고(있으면 건너뜀) 워커를 띄워 세션을 만든다 */
export async function initTts(
  cfg: TtsManifest,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  disposeTts();
  const total = cfg.files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  const files: TtsLoadFile[] = [];
  for (const f of cfg.files) {
    const url = cfg.baseUrl + f.path;
    files.push({
      path: f.path,
      size: f.size,
      url,
      cacheKey: cacheKey(cfg.id, url),
    });
    if (!(await hasModel(cfg.id, url))) {
      await downloadModel(cfg.id, url, f.size, (r) =>
        onProgress?.(done + r, total),
      );
    }
    done += f.size;
    onProgress?.(done, total);
  }
  const w = spawn();
  worker = w;
  await new Promise<void>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<WorkerToMain>) => {
      const m = e.data;
      if (m.type === "loaded") {
        loaded = true;
        resolve();
      } else if (m.type === "error" && m.id === undefined)
        reject(new Error(m.message));
      else if (m.type === "error")
        (pending.get(m.id!)?.reject(new Error(m.message)),
          pending.delete(m.id!));
      else if (m.type === "audio") {
        const p = pending.get(m.id);
        pending.delete(m.id);
        p?.resolve({
          samples: m.samples,
          sampleRate: m.sampleRate,
          durationMs: Math.round((m.samples.length / m.sampleRate) * 1000),
        });
      }
    };
    w.onerror = (e) => {
      const err = new Error(e.message || "tts worker error");
      reject(err);
      fail(err);
    };
    const msg: MainToWorker = {
      type: "load",
      baseUrl: cfg.baseUrl,
      files,
      voice: cfg.voice,
      lang: cfg.lang,
      wasmPaths: WASM_PATHS,
    };
    w.postMessage(msg);
  });
}

export function synthesize(
  text: string,
  signal?: AbortSignal,
): Promise<AudioClip> {
  if (!worker || !loaded)
    return Promise.reject(
      new Error("TTS가 초기화되지 않았습니다 (not loaded)"),
    );
  const w = worker;
  const id = nextId++;
  return new Promise<AudioClip>((resolve, reject) => {
    const abort = () => {
      pending.delete(id);
      w.postMessage({ type: "cancel", id } satisfies MainToWorker);
      reject(new DOMException("synthesize aborted", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    pending.set(id, {
      resolve: (c) => (signal?.removeEventListener("abort", abort), resolve(c)),
      reject: (e) => (signal?.removeEventListener("abort", abort), reject(e)),
    });
    w.postMessage({ type: "synthesize", id, text } satisfies MainToWorker);
  });
}

export function disposeTts(): void {
  worker?.terminate();
  worker = null;
  loaded = false;
  fail(new Error("TTS disposed"));
}
```

`onmessage`의 `error` 분기는 콤마 연산자 없이 블록으로 풀어 써도 된다(가독성). `import.meta.url` + `new URL(...)`은 Vite가 워커 청크로 처리한다.

- [ ] **Step 4: 실행 → 통과** `pnpm vitest run src/services/tts.test.ts`. jsdom엔 `Worker`가 없지만 테스트는 항상 가짜를 꽂으므로 `spawn`의 실제 분기는 타지 않는다.

- [ ] **Step 5: Commit** `git commit -m "feat(frontend): services/tts — 파일별 캐시 다운로드, 워커 프록시(id 매칭·abort·dispose)"`

---

### Task 5: `services/audio.ts` + 테스트

**Files:**

- Create: `frontend/src/services/audio.ts`, `frontend/src/services/audio.test.ts`

**Interfaces:**

- Produces: `playClip(clip, { muted }) → { done, stop() }`, `warmUpAudio()`, 테스트용 `__setAudioContextFactory`

- [ ] **Step 1: 실패 테스트** `src/services/audio.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setAudioContextFactory, playClip, warmUpAudio } from "./audio";

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect = vi.fn();
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    this.onended?.();
  }
}
class FakeGain {
  gain = { value: 1 };
  connect = vi.fn();
}
class FakeCtx {
  state = "suspended";
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  createBuffer(_ch: number, len: number, rate: number) {
    const data = new Float32Array(len);
    return {
      length: len,
      sampleRate: rate,
      copyToChannel: (src: Float32Array) => data.set(src),
      _data: data,
    };
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}
let ctx: FakeCtx;
beforeEach(() => {
  ctx = new FakeCtx();
  __setAudioContextFactory(() => ctx as unknown as AudioContext);
});
afterEach(() => __setAudioContextFactory(null));

const clip = {
  samples: Float32Array.from([0.1, 0.2, 0.3]),
  sampleRate: 44100,
  durationMs: 0,
};

describe("audio", () => {
  it("warmUpAudio는 컨텍스트를 만들고 resume한다(한 번만 만든다)", () => {
    warmUpAudio();
    warmUpAudio();
    expect(ctx.resume).toHaveBeenCalled();
    playClip(clip, { muted: false });
    expect(ctx.sources).toHaveLength(1); // 같은 컨텍스트 재사용
  });
  it("playClip은 버퍼→게인→목적지로 연결하고 끝나면 done이 resolve", async () => {
    const h = playClip(clip, { muted: false });
    const s = ctx.sources[0];
    expect(s.started).toBe(true);
    expect(ctx.gains[0].gain.value).toBe(1);
    s.onended?.();
    await expect(h.done).resolves.toBeUndefined();
  });
  it("muted면 게인 0 (타이밍은 유지)", () => {
    playClip(clip, { muted: true });
    expect(ctx.gains[0].gain.value).toBe(0);
    expect(ctx.sources[0].started).toBe(true);
  });
  it("stop()은 소스를 멈추고 done을 resolve한다", async () => {
    const h = playClip(clip, { muted: false });
    h.stop();
    expect(ctx.sources[0].stopped).toBe(true);
    await expect(h.done).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 실행 → 실패**

- [ ] **Step 3: 구현** `src/services/audio.ts`

```ts
import type { AudioClip } from "./tts";

let ctx: AudioContext | null = null;
let factory: (() => AudioContext) | null = null;
/** 테스트용: 가짜 AudioContext 주입 */
export function __setAudioContextFactory(f: (() => AudioContext) | null) {
  factory = f;
  ctx = null;
}
function context(): AudioContext {
  if (!ctx) ctx = factory ? factory() : new AudioContext();
  return ctx;
}

/** 사용자 제스처(면접 시작 클릭) 안에서 불러 자동재생 차단을 푼다 */
export function warmUpAudio(): void {
  const c = context();
  if (c.state !== "running") void c.resume();
}

/** 파형을 그대로 재생. muted면 GainNode 0으로 소리만 죽이고 길이·타이밍은 유지 */
export function playClip(
  clip: AudioClip,
  opts: { muted: boolean },
): { done: Promise<void>; stop(): void } {
  const c = context();
  if (c.state !== "running") void c.resume();
  const buffer = c.createBuffer(1, clip.samples.length, clip.sampleRate);
  buffer.copyToChannel(clip.samples, 0);
  const gain = c.createGain();
  gain.gain.value = opts.muted ? 0 : 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  gain.connect(c.destination);
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  src.onended = () => finish();
  src.start();
  return {
    done,
    stop() {
      try {
        src.stop();
      } catch {
        /* 이미 끝남 */
      }
      finish();
    },
  };
}
```

- [ ] **Step 4: 실행 → 통과**. `pnpm exec eslint src` (빈 catch에 주석 있음).

- [ ] **Step 5: Commit** `git commit -m "feat(frontend): services/audio — AudioContext 하나로 재생·음소거(게인 0)·정지, warmUpAudio"`

---

### Task 6: DEV 콘솔 진입점 + 체크리스트 + 최종 게이트

**Files:**

- Modify: `frontend/src/main.ts`, `docs/demo-checklist.md`

- [ ] **Step 1: DEV 전용 노출** `src/main.ts` 끝에:

```ts
// 개발 콘솔에서 TTS 단독 확인용 (이슈 #12 완료 기준). 프로덕션 번들엔 들어가지 않는다
if (import.meta.env.DEV) {
  void Promise.all([
    import("./services/tts"),
    import("./services/audio"),
    import("./services/api"),
  ]).then(([tts, audio, api]) => {
    (window as unknown as Record<string, unknown>).__momoTts = {
      ...tts,
      ...audio,
      getManifest: api.getManifest,
    };
  });
}
```

- [ ] **Step 2: 체크리스트** `docs/demo-checklist.md` "리포트" 절 앞에:

```markdown
## 음성(TTS) — 이슈 #12 단독 확인 (dev 콘솔)

- [ ] `/models/tts/supertonic-3/`가 서빙되는 상태(로컬: Vite `/models` 프록시가 `/models/X` → `http://localhost:8765/X`로 넘기므로 `C:\MyCode\models\`에서 `python -m http.server 8765`를 실행 — 모델 파일은 `C:\MyCode\models\tts\supertonic-3\{onnx,voice_styles}\`에 있어야 한다)에서 콘솔:
      `const m = await __momoTts.getManifest(); await __momoTts.initTts(m.tts, (r,t)=>console.log(r,t)); const c = await __momoTts.synthesize('안녕하세요. 자기소개를 부탁드립니다.'); __momoTts.warmUpAudio(); __momoTts.playClip(c, {muted:false})`
- [ ] 60자 한국어 문장 합성 시간 3초 이내(스텝 4, 첫 호출은 워밍업 제외). 합성 중 면접실 애니가 멈추지 않는다
- [ ] DevTools Network에 CDN 요청 없음(`/ort-wasm/…jsep.wasm`만), 두 번째 방문은 모델 요청 없이 캐시에서
```

- [ ] **Step 3: 전체 게이트** (in `frontend/`): `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`

- [ ] **Step 4: Commit** `git commit -m "chore(frontend): DEV 콘솔용 __momoTts 노출, 데모 체크리스트에 TTS 단독 확인 항목"`

---

## 자체 점검

- spec 3절 커버: 워커 프로토콜·로드(캐시 우선)·파이프라인·청크 120자·상수(Task 3), 프록시 id/abort/다운로드 재사용(Task 4), audio(Task 5), 테스트 3종(Task 2·4·5), 체크리스트(Task 6). WebGPU 없음 → 워커 `error`(Task 3). WASM 같은 오리진(Task 1).
- 타입 일관: `TtsLoadFile`(Task 3)를 Task 4가 만든다 — 필드 `path,size,url,cacheKey` 동일. `AudioClip`은 Task 4 정의, Task 5 import. `TtsManifest`는 Task 1 정의, Task 4 re-export(이슈 인터페이스 그대로).
- 실기 확인은 모델 파일이 로컬에 없어 이 세션에서 못 한다 → PR 본문에 "콘솔 리허설·60자 합성 시간은 모델 배치 후 기록" 명시.
