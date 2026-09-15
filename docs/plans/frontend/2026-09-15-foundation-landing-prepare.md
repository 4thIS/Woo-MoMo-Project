# frontend 기반 + 랜딩·준비 화면 — 구현 계획 (plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- 생성일시: 2026-09-15
- 기준 spec: `docs/specs/frontend/2026-09-15-screens-design.md` (4.1 랜딩, 4.2 준비, 5 에러, 6 인터페이스), `docs/specs/frontend/2026-09-15-design-system-design.md` (토큰·컴포넌트·픽셀 규칙)
- 계약 문서: `docs/API.md` (소비만)
- 담당: @leemonta9482 / 브랜치: `feature/frontend-foundation`
- 후속 plan: (2) 면접 화면 + LLM 런타임·음성·프롬프트, (3) 리포트 + 종료 처리

**Goal:** Vue 3 프로젝트를 만들고, 디자인 시스템 토큰·UI 컴포넌트·서비스(매니페스트, 모델 다운로드/캐시, 장비 확인, PDF 추출)·스토어를 갖춘 뒤, 랜딩 → 준비 화면이 실제 백엔드 매니페스트로 동작하게 한다(모델 다운로드까지. GPU 초기화는 plan 2).

**Architecture:** `views → stores → services/utils` 단방향(frontend/CLAUDE.md). 화면은 스토어만 읽고 쓴다. `services/`는 브라우저 API를 감싸고 스토어를 모른다. `utils/`는 순수 함수라 Vitest가 GPU 없이 돈다. 디자인 값은 전부 `src/styles/tokens.css`의 CSS 변수로만 쓴다(색 리터럴 금지). 픽셀 이미지는 `public/sprites/`에 시트 + `manifest.json`, 캔버스/배경으로 정수 배율 렌더.

**Tech Stack:** Vue 3 + TypeScript + Vite + Pinia / Vitest + @vue/test-utils + jsdom / ESLint(flat) + Prettier + vue-tsc / pdfjs-dist / pnpm

**Spec:** `docs/specs/frontend/2026-09-15-screens-design.md`, `docs/specs/frontend/2026-09-15-design-system-design.md`

## Global Constraints

- 패키지 매니저 **pnpm**, `pnpm-lock.yaml` 커밋. CI(`.github/workflows/ci.yml`)는 pnpm 9 · Node 20으로 `pnpm install --frozen-lockfile → pnpm lint → prettier --check . → vue-tsc --noEmit → pnpm test → pnpm build`를 돈다. 로컬 pnpm 11이 만든 lockfile을 pnpm 9가 못 읽어 CI가 깨지면, `ci.yml`의 `version: 9`를 `11`로 올리는 한 줄 `chore(infra)` PR을 **별도로** 올린다(공동 영역, 상대 리뷰).
- 계약 변경 없음. `/api/manifest`·`/api/questions/{field}` 응답을 변환하지 않고 그대로 쓴다. 모델 URL·템플릿 하드코딩 금지.
- 이력서 텍스트·대화·리포트를 서버로 보내는 코드 금지. 네트워크 요청은 매니페스트·질문·모델 파일뿐.
- 모델 출력·이력서 텍스트를 `innerHTML`로 렌더 금지. 텍스트 바인딩만.
- 색 리터럴(`#…`, `rgb(`)은 `src/styles/tokens.css`에만. 모서리 반경 0, 블러 그림자 금지, 모션은 `steps()`(디자인 시스템 3.4·3.5).
- 래스터 이미지는 `image-rendering: pixelated` + 정수 배율만.
- 실행 시 채워지는 값이 없으면 `--text-3` "확인 중"으로 표시. 대괄호 문자열이 화면에 남으면 버그.
- 커밋은 Conventional Commits: `feat(frontend):`, `test(frontend):`, `style(frontend):`, `chore(frontend):`. 커밋 메시지에 AI 저작 표기 없음.
- 모든 명령은 `frontend/`에서 실행한다(별도 표기 없으면).
- 각 Task는 실패 테스트 → 구현 → 통과 → 커밋. 브라우저 API 의존 코드는 `vi.stubGlobal`로 대체하고, 순수 로직은 `utils/`로 빼서 테스트한다.

## 파일 구조

```
frontend/
├── package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json  eslint.config.js  .prettierrc  .prettierignore  index.html
├── public/
│   ├── fonts/            Galmuri11-Bold.woff2  Galmuri14.woff2  GalmuriMono11.woff2  LICENSE.txt  (서브셋, 각 <200KB)
│   └── sprites/          walk_underwear.png … bag_ground.png  manifest.json  (pixel-progress/sheets 복사)
│       └── interviewers/ left_idle.png … candidate_back.png  manifest.json   (plan 2가 씀, 지금 복사)
└── src/
    ├── main.ts  App.vue  env.d.ts
    ├── styles/   tokens.css(변수만)  base.css(@font-face·reset·별하늘·포커스·reduced-motion)
    ├── types/    api.ts(Manifest, QuestionSet — docs/API.md 그대로)
    ├── utils/    format.ts  truncate.ts  progressStages.ts  envVerdict.ts  (+ *.test.ts)
    ├── services/ api.ts  gpuCheck.ts  modelCache.ts  pdf.ts  (+ *.test.ts, pdf 제외)
    ├── stores/   model.ts  interview.ts  (+ *.test.ts)
    ├── components/ui/
    │   ├── icons/ CursorIcon.vue  CheckIcon.vue  ArrowDownIcon.vue  DocIcon.vue
    │   ├── PixelWindow.vue  PixelTag.vue  PixelButton.vue  ChoiceMenu.vue  StatCard.vue  KeyValueGrid.vue
    │   ├── SpeechText.vue  SpriteFrame.vue  Avatar.vue  PixelProgress.vue  (+ 일부 *.test.ts)
    └── views/    LandingView.vue  PrepareView.vue  (+ *.test.ts)
```

---

### Task 1: 프로젝트 생성 + 도구 체인

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/eslint.config.js`, `frontend/.prettierrc`, `frontend/.prettierignore`, `frontend/index.html`, `frontend/src/main.ts`, `frontend/src/App.vue`, `frontend/src/env.d.ts`
- Test: `frontend/src/smoke.test.ts`

**Interfaces:**
- Produces: `pnpm dev|build|test|lint|format` 스크립트, `/api` → `http://localhost:8000` dev 프록시, `@/` 별칭 = `src/`

- [ ] **Step 1: 스캐폴드**

리포 루트에서:

```bash
pnpm create vite@latest frontend --template vue-ts
cd frontend
pnpm add pinia pdfjs-dist
pnpm add -D vitest @vue/test-utils jsdom eslint @eslint/js eslint-plugin-vue typescript-eslint eslint-config-prettier globals prettier @types/node @webgpu/types
```

템플릿이 만든 `src/components/HelloWorld.vue`, `src/assets/`, `src/style.css`, `public/vite.svg`, `tsconfig.app.json`, `tsconfig.node.json`은 삭제한다(아래에서 단일 `tsconfig.json`으로 대체).

- [ ] **Step 2: 설정 파일**

`frontend/package.json`의 `scripts`를 다음으로 교체(나머지 필드는 스캐폴드 값 유지, `"private": true`, `"type": "module"`):

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write ."
  }
}
```

`frontend/vite.config.ts`:

```ts
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:8000' } },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
})
```

`frontend/tsconfig.json` (단일 설정 — CI의 `vue-tsc --noEmit`이 실제로 src를 검사하도록 project reference를 쓰지 않는다):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "@webgpu/types", "node"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "vite.config.ts"]
}
```

`frontend/eslint.config.js`:

```js
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser }, globals: globals.browser },
  },
  { files: ['**/*.ts'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { rules: { 'vue/multi-word-component-names': 'off' } },
  prettier,
)
```

`frontend/.prettierrc`:

```json
{ "semi": false, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

`frontend/.prettierignore`:

```
dist
node_modules
pnpm-lock.yaml
public
```

`frontend/src/env.d.ts`:

```ts
/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
```

`frontend/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>모두의 모의면접</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`frontend/src/main.ts`:

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/tokens.css'
import './styles/base.css'

createApp(App).use(createPinia()).mount('#app')
```

`frontend/src/App.vue` (임시 — Task 16에서 phase 분기로 교체):

```vue
<script setup lang="ts"></script>

<template>
  <main class="stars">
    <h1>모두의 모의면접</h1>
  </main>
</template>
```

`src/styles/tokens.css`와 `base.css`는 Task 2에서 채운다. 이 Task에서는 빈 파일로 만들어 둔다.

- [ ] **Step 3: 스모크 테스트 (실패 확인)**

`frontend/src/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import App from './App.vue'

describe('App', () => {
  it('제목을 렌더한다', () => {
    expect(mount(App).text()).toContain('모두의 모의면접')
  })
})
```

Run: `pnpm test` → App.vue가 아직 Pinia 없이 마운트되므로 PASS해야 한다. 만약 FAIL이면 설정 오류이므로 여기서 고친다(vitest가 `.vue`를 못 읽으면 `vite.config.ts`의 plugin/`test.include` 확인).

- [ ] **Step 4: 전체 게이트**

Run: `pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm test && pnpm build` → 전부 PASS. prettier가 걸리면 `pnpm format` 후 재실행.

- [ ] **Step 5: 커밋**

```bash
git add frontend
git commit -m "chore(frontend): Vite + Vue 3 + TS + Pinia 프로젝트 생성, Vitest·ESLint·Prettier 게이트"
```

---

### Task 2: 에셋 반입 + 디자인 토큰 CSS

**Files:**
- Create: `frontend/public/fonts/*.woff2`, `frontend/public/fonts/LICENSE.txt`, `frontend/public/sprites/*.png`, `frontend/public/sprites/manifest.json`, `frontend/public/sprites/interviewers/*`, `frontend/src/styles/tokens.css`, `frontend/src/styles/base.css`
- Test: `frontend/src/styles/tokens.test.ts`

**Interfaces:**
- Produces: CSS 변수 `--bg --win --raise --line --text --text-2 --text-3 --accent --ok --danger`, `--font-display --font-body --font-mono`, `--fs-*`, `--sp-*`, `--content-w`; 클래스 `.stars .px .mono .display`; `@keyframes blink`

- [ ] **Step 1: 폰트 서브셋 (500KB 커밋 훅 회피)**

원본 `Galmuri14.woff2`는 565KB라 pre-commit `check-added-large-files(500KB)`에 걸린다. 한글 음절 전체 + ASCII + 기호로 서브셋하면 170KB 이하가 된다. 리포 루트에서:

```bash
F="C:/Users/Monta/Desktop/game/public/assets/fonts"
mkdir -p frontend/public/fonts
for f in Galmuri11-Bold Galmuri14 GalmuriMono11; do
  uvx --with brotli --from fonttools pyftsubset "$F/$f.woff2" \
    --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2190-2199,U+AC00-D7A3,U+3131-318E,U+2500-259F" \
    --flavor=woff2 --output-file="frontend/public/fonts/$f.woff2"
done
cp "$F/LICENSE.txt" frontend/public/fonts/LICENSE.txt
ls -la frontend/public/fonts   # 각 200KB 미만 확인
```

- [ ] **Step 2: 스프라이트 복사**

```bash
P="C:/Users/Monta/Desktop/pixel-progress"
mkdir -p frontend/public/sprites/interviewers
cp "$P"/sheets/*.png "$P"/sheets/manifest.json frontend/public/sprites/
cp "$P"/interviewers/sheets/*.png "$P"/interviewers/sheets/manifest.json frontend/public/sprites/interviewers/
```

두 `manifest.json`의 `file` 값은 `sheets/<name>.png` 형태다. 프론트 로더는 파일명만 쓰므로(`basename`) 그대로 둔다.

- [ ] **Step 3: 토큰 테스트 (실패 확인)**

`frontend/src/styles/tokens.test.ts` — tokens.css 밖에 색 리터럴이 없는지, 토큰이 전부 정의됐는지를 파일 텍스트로 검사한다(성공 기준 "tokens.css 외 색 리터럴 0개"의 자동화):

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

describe('design tokens', () => {
  const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8')

  it('필수 변수를 전부 정의한다', () => {
    for (const v of ['--bg', '--win', '--raise', '--line', '--text', '--text-2', '--text-3', '--accent', '--ok', '--danger', '--font-display', '--font-body', '--font-mono', '--content-w'])
      expect(tokens, v).toMatch(new RegExp(`${v}:`))
  })

  it('tokens.css 밖에는 색 리터럴이 없다', () => {
    const offenders = walk(SRC)
      .filter((p) => /\.(vue|css|ts)$/.test(p) && !p.endsWith('tokens.css') && !p.endsWith('.test.ts'))
      .filter((p) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })
})
```

Run: `pnpm test -- tokens` → FAIL (변수 미정의).

- [ ] **Step 4: tokens.css**

`frontend/src/styles/tokens.css` (디자인 시스템 3절 값 그대로):

```css
:root {
  /* 색 (10개로 끝) */
  --bg: #12142e;
  --win: #1b1f4a;
  --raise: #2d3380;
  --line: #f2f2f2;
  --text: #f2f2f2;
  --text-2: #c9cdf5;
  --text-3: #7d83c9;
  --accent: #ffd23f;
  --ok: #7ee081;
  --danger: #f26d6d;
  --star-1: #cfd3ff;
  --star-2: #7d83c9;

  /* 글꼴 */
  --font-display: 'Galmuri11', 'DotGothic16', sans-serif;
  --font-body: 'Galmuri14', 'DotGothic16', sans-serif;
  --font-mono: 'GalmuriMono11', monospace;

  --fs-logo: 154px;
  --fs-h1: 33px;
  --fs-h2: 22px;
  --fs-body-lg: 24px;
  --fs-body-md: 20px;
  --fs-body: 16px;
  --fs-body-sm: 15px;
  --fs-label: 14px;
  --fs-meta: 13px;
  --fs-button: 18px;

  /* 간격 */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;
  --sp-10: 40px;
  --sp-14: 56px;
  --content-w: 1040px;
  --page-x: 120px;

  /* 테두리 */
  --win-border: 4px solid var(--line);
  --win-inner: inset 0 0 0 3px var(--win), inset 0 0 0 5px var(--line);
  --rule: 2px solid var(--raise);
}
```

- [ ] **Step 5: base.css**

```css
@font-face { font-family: 'Galmuri11'; font-weight: 700; src: url('/fonts/Galmuri11-Bold.woff2') format('woff2'); font-display: swap; }
@font-face { font-family: 'Galmuri14'; font-weight: 400; src: url('/fonts/Galmuri14.woff2') format('woff2'); font-display: swap; }
@font-face { font-family: 'GalmuriMono11'; font-weight: 400; src: url('/fonts/GalmuriMono11.woff2') format('woff2'); font-display: swap; }

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: var(--fs-body);
  line-height: 1.7;
  -webkit-font-smoothing: none;
}
button, input, textarea { font: inherit; color: inherit; border-radius: 0; }
a { color: var(--accent); }
a:hover { color: var(--text); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.display { font-family: var(--font-display); font-weight: 700; }
.mono { font-family: var(--font-mono); }
.px { image-rendering: pixelated; }

/* 별하늘: 페이지 최상위 한 곳에만 */
.stars {
  background-color: var(--bg);
  background-image:
    radial-gradient(circle, var(--star-1) 1.5px, transparent 1.5px),
    radial-gradient(circle, var(--star-2) 1.5px, transparent 1.5px);
  background-size: 140px 140px, 90px 90px;
  background-position: 0 0, 45px 60px;
}

@keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.blink { animation: blink 0.9s steps(1) infinite; }

@media (prefers-reduced-motion: reduce) {
  .blink { animation: none; }
}
```

- [ ] **Step 6: 통과 + 커밋**

Run: `pnpm test -- tokens` → PASS. `pnpm exec prettier --check .` → clean(CSS 포함).

```bash
git add frontend/public frontend/src/styles
git commit -m "feat(frontend): 디자인 토큰·베이스 CSS, Galmuri 서브셋 폰트, 픽셀 스프라이트 반입"
```

---

### Task 3: 순수 유틸 — format · truncate · progressStages · envVerdict

**Files:**
- Create: `frontend/src/utils/format.ts`, `truncate.ts`, `progressStages.ts`, `envVerdict.ts`
- Test: 각 `*.test.ts`

**Interfaces:**
- Produces:
  - `formatGB(bytes: number): string` → `"약 3.0GB"`; `formatBytes(bytes: number): string` → `"1.22 GB"`
  - `truncateResume(text: string, max = 2000): string`
  - `STAGES`, `type StageState = { stage: number; queue: OnceAnim[] }`, `advance(state, progress): StageState`, `captionFor(progress): string`
  - `type Verdict = 'ok' | 'no-webgpu' | 'no-space'`, `verdict(env: { webgpu: boolean; storageFree: number | null }, needBytes: number): Verdict`

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/utils/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatBytes, formatGB } from './format'

describe('format', () => {
  it('formatGB는 소수 첫째 자리 GB', () => {
    expect(formatGB(2969059328)).toBe('약 2.8GB') // 1024 기준(GiB)
    expect(formatGB(2008432640)).toBe('약 1.9GB')
  })
  it('formatBytes는 단위 자동', () => {
    expect(formatBytes(1_220_000_000)).toBe('1.14 GB')
    expect(formatBytes(512 * 1024)).toBe('512.0 KB')
  })
})
```

`frontend/src/utils/truncate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { truncateResume } from './truncate'

describe('truncateResume', () => {
  it('앞뒤 공백을 정리하고 2000자에서 자른다', () => {
    const long = ' 가'.repeat(3000)
    expect(truncateResume(long)).toHaveLength(2000)
  })
  it('짧으면 그대로', () => {
    expect(truncateResume('안녕하세요')).toBe('안녕하세요')
  })
  it('연속 공백·개행은 하나로', () => {
    expect(truncateResume('a \n\n  b')).toBe('a b')
  })
})
```

`frontend/src/utils/progressStages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { advance, captionFor } from './progressStages'

describe('progressStages', () => {
  it('구간을 건너뛰어도 전환 애니를 순서대로 큐에 넣는다', () => {
    const s = advance({ stage: 0, queue: [] }, 75)
    expect(s.stage).toBe(2)
    expect(s.queue).toEqual(['pickup_suit', 'pickup_bag'])
  })
  it('같은 구간 안에서는 아무것도 추가하지 않는다', () => {
    const s = advance({ stage: 1, queue: [] }, 45)
    expect(s).toEqual({ stage: 1, queue: [] })
  })
  it('90%에서 look_up', () => {
    expect(advance({ stage: 2, queue: [] }, 90).queue).toEqual(['look_up'])
  })
  it('문구', () => {
    expect(captionFor(10)).toBe('출근 준비 중…')
    expect(captionFor(41)).toBe('양복은 챙겼습니다. 가방을 찾는 중…')
    expect(captionFor(95)).toBe('회사 앞입니다')
  })
})
```

`frontend/src/utils/envVerdict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { verdict } from './envVerdict'

describe('verdict', () => {
  const need = 3_000_000_000
  it('WebGPU 없음이 최우선', () => {
    expect(verdict({ webgpu: false, storageFree: 0 }, need)).toBe('no-webgpu')
  })
  it('공간 부족', () => {
    expect(verdict({ webgpu: true, storageFree: need - 1 }, need)).toBe('no-space')
  })
  it('공간을 알 수 없으면 통과시킨다 (estimate 미지원 브라우저)', () => {
    expect(verdict({ webgpu: true, storageFree: null }, need)).toBe('ok')
  })
  it('통과', () => {
    expect(verdict({ webgpu: true, storageFree: need * 2 }, need)).toBe('ok')
  })
})
```

Run: `pnpm test -- utils` → 전부 FAIL(모듈 없음).

- [ ] **Step 2: 구현**

`frontend/src/utils/format.ts`:

```ts
const GB = 1024 ** 3

export function formatGB(bytes: number): string {
  return `약 ${(bytes / GB).toFixed(1)}GB`
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}
```

`frontend/src/utils/truncate.ts`:

```ts
/** 이력서 텍스트: 공백 정리 후 앞 max자만. 설계서 3.1 "약 2,000자 절단". */
export function truncateResume(text: string, max = 2000): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}
```

`frontend/src/utils/progressStages.ts` (`pixel-progress/index.html`의 STAGES 이식):

```ts
export type WalkAnim = 'walk_underwear' | 'walk_suit' | 'walk_suit_bag'
export type OnceAnim = 'pickup_suit' | 'pickup_bag' | 'look_up'
export type ItemSprite = 'suit_ground' | 'bag_ground'

export interface Stage {
  at: number
  walk: WalkAnim | null
  once?: OnceAnim
  item?: ItemSprite
  caption: string
}

export const STAGES: readonly Stage[] = [
  { at: 0, walk: 'walk_underwear', caption: '출근 준비 중…' },
  { at: 30, walk: 'walk_suit', once: 'pickup_suit', item: 'suit_ground', caption: '양복은 챙겼습니다. 가방을 찾는 중…' },
  { at: 70, walk: 'walk_suit_bag', once: 'pickup_bag', item: 'bag_ground', caption: '가방도 챙겼습니다. 회사가 보이기 시작했어요.' },
  { at: 90, walk: null, once: 'look_up', caption: '회사 앞입니다' },
]

export interface StageState {
  stage: number
  queue: OnceAnim[]
}

/** 진행률이 새 구간을 넘을 때마다 그 구간의 전환 애니를 큐에 넣는다. 점프해도 순서 유지. */
export function advance(state: StageState, progress: number): StageState {
  let { stage } = state
  const queue = [...state.queue]
  while (stage + 1 < STAGES.length && progress >= STAGES[stage + 1].at) {
    stage++
    const once = STAGES[stage].once
    if (once) queue.push(once)
  }
  return { stage, queue }
}

export function stageIndexFor(progress: number): number {
  let i = 0
  while (i + 1 < STAGES.length && progress >= STAGES[i + 1].at) i++
  return i
}

export function captionFor(progress: number): string {
  return STAGES[stageIndexFor(progress)].caption
}
```

`frontend/src/utils/envVerdict.ts`:

```ts
export type Verdict = 'ok' | 'no-webgpu' | 'no-space'

export function verdict(env: { webgpu: boolean; storageFree: number | null }, needBytes: number): Verdict {
  if (!env.webgpu) return 'no-webgpu'
  if (env.storageFree !== null && env.storageFree < needBytes) return 'no-space'
  return 'ok'
}
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- utils` → PASS.

```bash
git add frontend/src/utils
git commit -m "feat(frontend): 용량 포맷·이력서 절단·진행 구간·장비 판정 순수 함수"
```

---

### Task 4: services/api.ts + 타입

**Files:**
- Create: `frontend/src/types/api.ts`, `frontend/src/services/api.ts`
- Test: `frontend/src/services/api.test.ts`

**Interfaces:**
- Produces: `interface Manifest { id; url; size; template: { turnStart; turnEnd; roles: Record<string,string> }; systemPromptOverride: string | null; fallback: { id; url; size } | null }`, `interface QuestionSet { field: string; questions: string[] }`, `getManifest(): Promise<Manifest>`, `getQuestions(field: string): Promise<QuestionSet>`

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/services/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getManifest, getQuestions } from './api'

const json = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response)

afterEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('getManifest는 /api/manifest 응답을 그대로 돌려준다', async () => {
    const manifest = { id: 'm', url: '/models/m.litertlm', size: 1, template: { turnStart: 'a', turnEnd: 'b', roles: {} }, systemPromptOverride: null, fallback: null }
    const fetchMock = vi.fn(() => json(manifest))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getManifest()).toEqual(manifest)
    expect(fetchMock).toHaveBeenCalledWith('/api/manifest')
  })
  it('getQuestions는 field를 소문자로 보낸다', async () => {
    const fetchMock = vi.fn(() => json({ field: 'it', questions: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await getQuestions('IT')
    expect(fetchMock).toHaveBeenCalledWith('/api/questions/it')
  })
  it('비정상 응답이면 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({}, false)))
    await expect(getManifest()).rejects.toThrow('/api/manifest 500')
  })
})
```

Run: `pnpm test -- api` → FAIL.

- [ ] **Step 2: 구현**

`frontend/src/types/api.ts` (docs/API.md 그대로):

```ts
export interface ModelRef {
  id: string
  url: string
  size: number
}

export interface ChatTemplate {
  turnStart: string
  turnEnd: string
  roles: Record<string, string>
}

export interface Manifest extends ModelRef {
  template: ChatTemplate
  systemPromptOverride: string | null
  fallback: ModelRef | null
}

export interface QuestionSet {
  field: string
  questions: string[]
}
```

`frontend/src/services/api.ts`:

```ts
import type { Manifest, QuestionSet } from '@/types/api'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return res.json() as Promise<T>
}

export const getManifest = () => getJson<Manifest>('/api/manifest')
export const getQuestions = (field: string) => getJson<QuestionSet>(`/api/questions/${field.toLowerCase()}`)
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- api` → PASS.

```bash
git add frontend/src/types frontend/src/services/api.ts frontend/src/services/api.test.ts
git commit -m "feat(frontend): 매니페스트·폴백 질문 API 클라이언트"
```

---

### Task 5: services/gpuCheck.ts

**Files:**
- Create: `frontend/src/services/gpuCheck.ts`
- Test: `frontend/src/services/gpuCheck.test.ts`

**Interfaces:**
- Produces: `interface EnvCheck { webgpu: boolean; gpuName: string | null; storageFree: number | null }`, `checkEnvironment(): Promise<EnvCheck>`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkEnvironment } from './gpuCheck'

afterEach(() => vi.unstubAllGlobals())

describe('checkEnvironment', () => {
  it('WebGPU 없음', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 100, usage: 40 }) } })
    expect(await checkEnvironment()).toEqual({ webgpu: false, gpuName: null, storageFree: 60 })
  })
  it('어댑터 이름과 여유 공간', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: async () => ({ info: { vendor: 'intel', description: 'Intel Xe' } }) },
      storage: { estimate: async () => ({ quota: 10, usage: 3 }) },
    })
    expect(await checkEnvironment()).toEqual({ webgpu: true, gpuName: 'Intel Xe', storageFree: 7 })
  })
  it('estimate 미지원이면 storageFree null', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ info: {} }) } })
    expect((await checkEnvironment()).storageFree).toBeNull()
  })
  it('requestAdapter가 null이면 WebGPU 없음', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } })
    expect((await checkEnvironment()).webgpu).toBe(false)
  })
})
```

Run: `pnpm test -- gpuCheck` → FAIL.

- [ ] **Step 2: 구현**

```ts
export interface EnvCheck {
  webgpu: boolean
  gpuName: string | null
  storageFree: number | null
}

/** 랜딩 "장비 확인" 창의 재료. 실패는 전부 "없음/알 수 없음"으로 흡수한다 — 여기서 던지면 안 된다. */
export async function checkEnvironment(): Promise<EnvCheck> {
  let webgpu = false
  let gpuName: string | null = null
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
  if (gpu) {
    const adapter = await gpu.requestAdapter().catch(() => null)
    if (adapter) {
      webgpu = true
      const info = (adapter as GPUAdapter & { info?: Partial<GPUAdapterInfo> }).info
      gpuName = info?.description || info?.vendor || null
    }
  }
  let storageFree: number | null = null
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate().catch(() => null)
    if (est && est.quota != null) storageFree = est.quota - (est.usage ?? 0)
  }
  return { webgpu, gpuName, storageFree }
}
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- gpuCheck` → PASS.

```bash
git add frontend/src/services/gpuCheck.ts frontend/src/services/gpuCheck.test.ts
git commit -m "feat(frontend): WebGPU·어댑터·저장 공간 확인 서비스"
```

---

### Task 6: services/modelCache.ts

**Files:**
- Create: `frontend/src/services/modelCache.ts`
- Test: `frontend/src/services/modelCache.test.ts`

**Interfaces:**
- Produces: `cacheKey(id, url): string`, `hasModel(id, url): Promise<boolean>`, `downloadModel(id, url, expectedSize, onProgress: (received: number) => void, signal?: AbortSignal): Promise<void>`, `getModelBlob(id, url): Promise<Blob | null>`, `clearModels(): Promise<void>`
- 캐시 이름 `momo-models`, 키 `/models-cache/${id}${url}` (매니페스트 `id`가 바뀌면 키가 갈린다 — docs/API.md `id` 설명)

- [ ] **Step 1: 실패하는 테스트**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheKey, clearModels, downloadModel, getModelBlob, hasModel } from './modelCache'

/** Cache API 최소 가짜: Map 하나 */
function fakeCaches() {
  const store = new Map<string, Response>()
  const cache = {
    match: async (k: string) => store.get(k) ?? undefined,
    put: async (k: string, r: Response) => void store.set(k, r),
  }
  return { open: async () => cache, delete: async () => true, _store: store }
}

function streamOf(chunks: Uint8Array[], contentLength: number) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(ch))
      c.close()
    },
  })
  return { ok: true, status: 200, headers: new Headers({ 'Content-Length': String(contentLength) }), body } as Response
}

let caches: ReturnType<typeof fakeCaches>
beforeEach(() => {
  caches = fakeCaches()
  vi.stubGlobal('caches', caches)
})
afterEach(() => vi.unstubAllGlobals())

describe('modelCache', () => {
  it('키는 id와 url을 포함한다', () => {
    expect(cacheKey('m1', '/models/a.litertlm')).toBe('/models-cache/m1/models/a.litertlm')
  })

  it('진행률을 보고하고 완료 후 캐시에 넣는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamOf([new Uint8Array(3), new Uint8Array(2)], 5)))
    const seen: number[] = []
    await downloadModel('m1', '/models/a', 5, (r) => seen.push(r))
    expect(seen).toEqual([3, 5])
    expect(await hasModel('m1', '/models/a')).toBe(true)
    expect((await getModelBlob('m1', '/models/a'))?.size).toBe(5)
  })

  it('수신 바이트가 크기와 다르면 캐시에 넣지 않고 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamOf([new Uint8Array(3)], 5)))
    await expect(downloadModel('m1', '/models/a', 5, () => {})).rejects.toThrow('incomplete')
    expect(await hasModel('m1', '/models/a')).toBe(false)
  })

  it('clearModels는 캐시를 지운다', async () => {
    const del = vi.spyOn(caches, 'delete')
    await clearModels()
    expect(del).toHaveBeenCalledWith('momo-models')
  })
})
```

Run: `pnpm test -- modelCache` → FAIL.

- [ ] **Step 2: 구현**

```ts
const CACHE = 'momo-models'

export const cacheKey = (id: string, url: string) => `/models-cache/${id}${url}`

export async function hasModel(id: string, url: string): Promise<boolean> {
  const cache = await caches.open(CACHE)
  return (await cache.match(cacheKey(id, url))) !== undefined
}

export async function getModelBlob(id: string, url: string): Promise<Blob | null> {
  const cache = await caches.open(CACHE)
  const res = await cache.match(cacheKey(id, url))
  return res ? res.blob() : null
}

/**
 * 스트리밍 다운로드 + 진행률. 수신 바이트가 expectedSize(매니페스트 size)와 다르면 캐시에 저장하지 않는다(설계서 6절).
 * Content-Length가 있으면 그것도 대조한다.
 */
export async function downloadModel(
  id: string,
  url: string,
  expectedSize: number,
  onProgress: (received: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`model fetch ${res.status}`)
  const declared = Number(res.headers.get('Content-Length') ?? expectedSize)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(received)
  }
  if (received !== expectedSize || received !== declared) throw new Error(`incomplete: ${received}/${expectedSize}`)
  const blob = new Blob(chunks, { type: 'application/octet-stream' })
  const cache = await caches.open(CACHE)
  await cache.put(cacheKey(id, url), new Response(blob, { headers: { 'Content-Length': String(received) } }))
}

export async function clearModels(): Promise<void> {
  await caches.delete(CACHE)
}
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- modelCache` → PASS.

```bash
git add frontend/src/services/modelCache.ts frontend/src/services/modelCache.test.ts
git commit -m "feat(frontend): 모델 스트리밍 다운로드·진행률·Cache API 저장(무결성 확인)"
```

---

### Task 7: services/pdf.ts

**Files:**
- Create: `frontend/src/services/pdf.ts`
- Test: 없음(pdf.js는 jsdom에서 돌지 않는다. 절단 로직은 Task 3에서 검증됨. 실제 PDF는 데모 체크리스트로 수동 확인)

**Interfaces:**
- Produces: `extractPdfText(file: File): Promise<string>` — 페이지 순서대로 이어 붙인 원문(절단은 스토어가 한다)

- [ ] **Step 1: 구현**

```ts
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// 워커는 로컬 번들에서 로드한다 — CDN 없음, 이력서가 밖으로 나가지 않는다.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function extractPdfText(file: File): Promise<string> {
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
  }
  return pages.join('\n')
}
```

- [ ] **Step 2: 타입·빌드 확인 + 커밋**

Run: `pnpm exec vue-tsc --noEmit && pnpm build` → PASS (`?url` import는 `vite/client` 타입으로 해결된다).

```bash
git add frontend/src/services/pdf.ts
git commit -m "feat(frontend): pdf.js 텍스트 추출 서비스(로컬 워커)"
```

---

### Task 8: stores/model.ts

**Files:**
- Create: `frontend/src/stores/model.ts`
- Test: `frontend/src/stores/model.test.ts`

**Interfaces:**
- Consumes: `getManifest`, `hasModel`, `downloadModel`, `clearModels`
- Produces: `useModelStore()` — state `status: 'idle' | 'loading-manifest' | 'downloading' | 'downloaded' | 'initializing' | 'ready' | 'error'`, `manifest: Manifest | null`, `active: ModelRef | null`(현재 시도 중인 모델 — 기본은 manifest 자신, 폴백 시 `manifest.fallback`), `received`, `total`, `error: string | null`, `progress`(0–100 getter), `manifestError: string | null`; actions `loadManifest()`, `download()`, `retry()`, `useFallback()`, `clearCache()`
- plan 2가 `initializing → ready` 전환(`init()`)을 추가한다. 이 plan에서는 `downloaded`에서 멈춘다.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getManifest: vi.fn() }))
vi.mock('@/services/modelCache', () => ({
  hasModel: vi.fn(),
  downloadModel: vi.fn(),
  clearModels: vi.fn(),
}))

import { getManifest } from '@/services/api'
import { downloadModel, hasModel } from '@/services/modelCache'
import { useModelStore } from './model'

const manifest = {
  id: 'e4b', url: '/models/e4b.litertlm', size: 100,
  template: { turnStart: '<|turn>', turnEnd: '<turn|>', roles: {} },
  systemPromptOverride: null,
  fallback: { id: 'e2b', url: '/models/e2b.litertlm', size: 50 },
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(getManifest).mockResolvedValue(manifest)
  vi.mocked(hasModel).mockResolvedValue(false)
  vi.mocked(downloadModel).mockImplementation(async (_id, _url, _size, onProgress) => {
    onProgress(50)
    onProgress(100)
  })
})

describe('model store', () => {
  it('매니페스트를 읽어 total을 세팅한다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    expect(s.manifest?.id).toBe('e4b')
    expect(s.total).toBe(100)
    expect(s.status).toBe('idle')
  })

  it('download는 진행률을 반영하고 downloaded로 끝난다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    const p = s.download()
    expect(s.status).toBe('downloading')
    await p
    expect(s.received).toBe(100)
    expect(s.progress).toBe(100)
    expect(s.status).toBe('downloaded')
  })

  it('캐시에 있으면 다운로드를 건너뛴다', async () => {
    vi.mocked(hasModel).mockResolvedValue(true)
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(downloadModel).not.toHaveBeenCalled()
    expect(s.status).toBe('downloaded')
  })

  it('실패하면 error와 메시지', async () => {
    vi.mocked(downloadModel).mockRejectedValue(new Error('incomplete: 3/100'))
    const s = useModelStore()
    await s.loadManifest()
    await s.download()
    expect(s.status).toBe('error')
    expect(s.error).toContain('incomplete')
  })

  it('useFallback은 폴백 모델로 바꿔 다시 받는다', async () => {
    const s = useModelStore()
    await s.loadManifest()
    await s.useFallback()
    expect(s.active?.id).toBe('e2b')
    expect(downloadModel).toHaveBeenCalledWith('e2b', '/models/e2b.litertlm', 50, expect.any(Function), undefined)
  })

  it('매니페스트 실패는 manifestError에 남는다', async () => {
    vi.mocked(getManifest).mockRejectedValue(new Error('/api/manifest 500'))
    const s = useModelStore()
    await s.loadManifest()
    expect(s.manifestError).toContain('500')
  })
})
```

Run: `pnpm test -- stores/model` → FAIL.

- [ ] **Step 2: 구현**

```ts
import { defineStore } from 'pinia'
import { getManifest } from '@/services/api'
import { clearModels, downloadModel, hasModel } from '@/services/modelCache'
import type { Manifest, ModelRef } from '@/types/api'

export type ModelStatus =
  | 'idle'
  | 'loading-manifest'
  | 'downloading'
  | 'downloaded'
  | 'initializing'
  | 'ready'
  | 'error'

export const useModelStore = defineStore('model', {
  state: () => ({
    status: 'idle' as ModelStatus,
    manifest: null as Manifest | null,
    active: null as ModelRef | null,
    received: 0,
    total: 0,
    error: null as string | null,
    manifestError: null as string | null,
  }),
  getters: {
    progress: (s) => (s.total ? Math.min(100, Math.round((s.received / s.total) * 100)) : 0),
  },
  actions: {
    async loadManifest() {
      this.status = 'loading-manifest'
      this.manifestError = null
      try {
        this.manifest = await getManifest()
        this.setActive(this.manifest)
      } catch (e) {
        this.manifestError = e instanceof Error ? e.message : String(e)
      } finally {
        this.status = 'idle'
      }
    },
    setActive(ref: ModelRef) {
      this.active = { id: ref.id, url: ref.url, size: ref.size }
      this.total = ref.size
      this.received = 0
    },
    async download() {
      if (!this.active) throw new Error('manifest not loaded')
      const { id, url, size } = this.active
      this.status = 'downloading'
      this.error = null
      try {
        if (await hasModel(id, url)) {
          this.received = size
        } else {
          await downloadModel(id, url, size, (r) => (this.received = r), undefined)
        }
        this.status = 'downloaded'
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
      }
    },
    retry() {
      return this.download()
    },
    async useFallback() {
      if (!this.manifest?.fallback) return
      this.setActive(this.manifest.fallback)
      await this.download()
    },
    async clearCache() {
      await clearModels()
      this.received = 0
      this.status = 'idle'
    },
  },
})
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- stores/model` → PASS.

```bash
git add frontend/src/stores/model.ts frontend/src/stores/model.test.ts
git commit -m "feat(frontend): 모델 스토어(매니페스트·다운로드 상태·폴백·캐시 삭제)"
```

---

### Task 9: stores/interview.ts (phase · 프로필 · 이력서 · 시작 조건)

**Files:**
- Create: `frontend/src/stores/interview.ts`
- Test: `frontend/src/stores/interview.test.ts`

**Interfaces:**
- Consumes: `useModelStore`, `getQuestions`, `truncateResume`
- Produces: `useInterviewStore()` — state `phase: 'landing' | 'prepare' | 'interview' | 'report'`, `profile: { field: Field | null; job: string }`, `resumeText: string`, `resumeName: string | null`, `fallbackQuestions: string[]`; getters `profileDone`, `resumeDone`(≥50자), `canStart`(model.status === 'ready' && profileDone && resumeDone), `startBlockReason: string | null`; actions `setField(field)`, `setJob(job)`, `setResume(name, rawText)`, `goto(phase)`
- `type Field = 'it' | 'finance' | 'manufacturing' | 'retail' | 'general'`, `FIELD_LABELS: Record<Field, string>` = IT 금융 제조 유통 기타
- plan 2가 `messages`, `stage`, `start()`, `send()` 등을 추가한다.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getQuestions: vi.fn(), getManifest: vi.fn() }))
import { getQuestions } from '@/services/api'
import { useModelStore } from './model'
import { useInterviewStore } from './interview'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(getQuestions).mockResolvedValue({ field: 'it', questions: ['q1', 'q2', 'q3', 'q4', 'q5'] })
})

describe('interview store', () => {
  it('처음은 landing', () => {
    expect(useInterviewStore().phase).toBe('landing')
  })

  it('setField는 폴백 질문을 미리 받아 둔다', async () => {
    const s = useInterviewStore()
    await s.setField('it')
    expect(s.profile.field).toBe('it')
    expect(s.fallbackQuestions).toHaveLength(5)
  })

  it('폴백 질문 실패는 조용히 무시한다', async () => {
    vi.mocked(getQuestions).mockRejectedValue(new Error('down'))
    const s = useInterviewStore()
    await s.setField('finance')
    expect(s.profile.field).toBe('finance')
    expect(s.fallbackQuestions).toEqual([])
  })

  it('setResume은 절단해서 저장한다', () => {
    const s = useInterviewStore()
    s.setResume('cv.pdf', ' 가'.repeat(3000))
    expect(s.resumeName).toBe('cv.pdf')
    expect(s.resumeText).toHaveLength(2000)
    expect(s.resumeDone).toBe(true)
  })

  it('50자 미만이면 resumeDone false', () => {
    const s = useInterviewStore()
    s.setResume('scan.pdf', '짧음')
    expect(s.resumeDone).toBe(false)
  })

  it.each([
    ['ready', 'it', '백엔드', true, null],
    ['downloaded', 'it', '백엔드', false, '면접관이 자리에 앉으면 열립니다'],
    ['ready', null, '백엔드', false, '위 항목을 채우면 열립니다'],
    ['ready', 'it', '', false, '위 항목을 채우면 열립니다'],
  ] as const)('canStart: model=%s field=%s job=%s → %s', async (status, field, job, expected, reason) => {
    const m = useModelStore()
    m.status = status
    const s = useInterviewStore()
    if (field) await s.setField(field)
    s.setJob(job)
    s.setResume('cv.pdf', '가'.repeat(60))
    expect(s.canStart).toBe(expected)
    expect(s.startBlockReason).toBe(reason)
  })
})
```

Run: `pnpm test -- stores/interview` → FAIL.

- [ ] **Step 2: 구현**

```ts
import { defineStore } from 'pinia'
import { getQuestions } from '@/services/api'
import { truncateResume } from '@/utils/truncate'
import { useModelStore } from './model'

export type Phase = 'landing' | 'prepare' | 'interview' | 'report'
export type Field = 'it' | 'finance' | 'manufacturing' | 'retail' | 'general'

export const FIELD_LABELS: Record<Field, string> = {
  it: 'IT',
  finance: '금융',
  manufacturing: '제조',
  retail: '유통',
  general: '기타',
}

export const RESUME_MIN = 50

export const useInterviewStore = defineStore('interview', {
  state: () => ({
    phase: 'landing' as Phase,
    profile: { field: null as Field | null, job: '' },
    resumeText: '',
    resumeName: null as string | null,
    fallbackQuestions: [] as string[],
  }),
  getters: {
    profileDone: (s) => s.profile.field !== null && s.profile.job.trim().length > 0,
    resumeDone: (s) => s.resumeText.length >= RESUME_MIN,
    canStart(): boolean {
      return useModelStore().status === 'ready' && this.profileDone && this.resumeDone
    },
    startBlockReason(): string | null {
      if (this.canStart) return null
      if (useModelStore().status !== 'ready') return '면접관이 자리에 앉으면 열립니다'
      return '위 항목을 채우면 열립니다'
    },
  },
  actions: {
    goto(phase: Phase) {
      this.phase = phase
    },
    async setField(field: Field) {
      this.profile.field = field
      try {
        this.fallbackQuestions = (await getQuestions(field)).questions
      } catch {
        this.fallbackQuestions = [] // 폴백 질문 없이도 면접은 진행한다 (spec 5절)
      }
    },
    setJob(job: string) {
      this.profile.job = job.slice(0, 40)
    },
    setResume(name: string, rawText: string) {
      this.resumeName = name
      this.resumeText = truncateResume(rawText)
    },
  },
})
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- stores` → PASS.

```bash
git add frontend/src/stores/interview.ts frontend/src/stores/interview.test.ts
git commit -m "feat(frontend): 면접 스토어(phase·프로필·이력서·시작 조건)"
```

---

### Task 10: UI 기본 컴포넌트 — 아이콘 · PixelWindow · PixelTag · PixelButton

**Files:**
- Create: `frontend/src/components/ui/icons/CursorIcon.vue`, `CheckIcon.vue`, `ArrowDownIcon.vue`, `DocIcon.vue`, `frontend/src/components/ui/PixelWindow.vue`, `PixelTag.vue`, `PixelButton.vue`
- Test: `frontend/src/components/ui/PixelButton.test.ts`

**Interfaces:**
- Produces:
  - 아이콘: props `size?: number`(기본 16), `color?: string`(기본 `currentColor`)
  - `PixelWindow`: props `title?: string`, `padding?: 'md' | 'sm'`(md 24/32, sm 22/28); slots `default`, `tag`(우상단), `header`(제목 행 전체 대체)
  - `PixelTag`: props `tone?: 'default' | 'ok' | 'danger' | 'muted'`
  - `PixelButton`: props `variant?: 'primary' | 'secondary'`, `disabled?: boolean`, `cursor?: boolean`(primary 기본 true — 왼쪽 커서 아이콘); emits `click`

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/components/ui/PixelButton.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PixelButton from './PixelButton.vue'

describe('PixelButton', () => {
  it('primary는 커서 아이콘을 보여준다', () => {
    const w = mount(PixelButton, { slots: { default: '시작' } })
    expect(w.find('svg').exists()).toBe(true)
    expect(w.text()).toContain('시작')
  })
  it('disabled면 커서를 숨기고 클릭을 막는다', async () => {
    const w = mount(PixelButton, { props: { disabled: true }, slots: { default: '시작' } })
    expect(w.find('svg').exists()).toBe(false)
    await w.trigger('click')
    expect(w.emitted('click')).toBeUndefined()
  })
  it('secondary는 커서가 없다', () => {
    const w = mount(PixelButton, { props: { variant: 'secondary' }, slots: { default: '취소' } })
    expect(w.find('svg').exists()).toBe(false)
  })
})
```

Run: `pnpm test -- PixelButton` → FAIL.

- [ ] **Step 2: 아이콘**

`CursorIcon.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ size?: number; color?: string }>(), { size: 14, color: 'currentColor' })
</script>

<template>
  <svg :width="size" :height="(size / 14) * 16" viewBox="0 0 14 16" :fill="color" aria-hidden="true">
    <path d="M0 0l14 8-14 8z" />
  </svg>
</template>
```

`CheckIcon.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ size?: number; color?: string }>(), { size: 16, color: 'currentColor' })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 16 16" fill="none" :stroke="color" stroke-width="3" aria-hidden="true">
    <path d="M2 8l4 4 8-9" />
  </svg>
</template>
```

`ArrowDownIcon.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ size?: number; color?: string }>(), { size: 16, color: 'currentColor' })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 16 16" fill="none" :stroke="color" stroke-width="2" aria-hidden="true">
    <path d="M2 5l6 6 6-6" />
  </svg>
</template>
```

`DocIcon.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ size?: number; color?: string }>(), { size: 20, color: 'currentColor' })
</script>

<template>
  <svg :width="size" :height="(size / 20) * 24" viewBox="0 0 20 24" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="18" height="22" :stroke="color" stroke-width="2" />
    <rect x="5" y="7" width="10" height="2" :fill="color" />
    <rect x="5" y="11" width="10" height="2" :fill="color" />
    <rect x="5" y="15" width="6" height="2" :fill="color" />
  </svg>
</template>
```

- [ ] **Step 3: PixelWindow · PixelTag · PixelButton**

`PixelWindow.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ title?: string; padding?: 'md' | 'sm' }>(), { title: undefined, padding: 'md' })
</script>

<template>
  <section class="win" :class="`pad-${padding}`">
    <slot name="header">
      <header v-if="title || $slots.tag" class="head">
        <h2 v-if="title" class="display title">{{ title }}</h2>
        <slot name="tag" />
      </header>
    </slot>
    <slot />
  </section>
</template>

<style scoped>
.win {
  background: var(--win);
  border: var(--win-border);
  box-shadow: var(--win-inner);
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
}
.pad-md { padding: var(--sp-6) var(--sp-8); }
.pad-sm { padding: 22px 28px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); }
.title { margin: 0; font-size: var(--fs-h2); line-height: 1.4; }
</style>
```

`PixelTag.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'default' | 'ok' | 'danger' | 'muted' }>(), { tone: 'default' })
</script>

<template>
  <span class="tag mono" :class="tone"><slot /></span>
</template>

<style scoped>
.tag { font-size: var(--fs-meta); line-height: 1.5; padding: var(--sp-1) 10px; background: var(--line); color: var(--bg); white-space: nowrap; }
.ok { background: var(--ok); }
.danger { background: var(--danger); }
.muted { background: var(--raise); color: var(--text-2); }
</style>
```

`PixelButton.vue`:

```vue
<script setup lang="ts">
import CursorIcon from './icons/CursorIcon.vue'

const props = withDefaults(defineProps<{ variant?: 'primary' | 'secondary'; disabled?: boolean; cursor?: boolean }>(), {
  variant: 'primary',
  disabled: false,
  cursor: true,
})
const emit = defineEmits<{ click: [MouseEvent] }>()
const onClick = (e: MouseEvent) => {
  if (!props.disabled) emit('click', e)
}
</script>

<template>
  <button type="button" class="btn display" :class="[variant, { disabled }]" :disabled="disabled" @click="onClick">
    <CursorIcon v-if="variant === 'primary' && cursor && !disabled" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  height: 52px;
  padding: 0 28px;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-button);
  line-height: 1;
  border: 0;
  cursor: pointer;
  background: var(--raise);
  color: var(--accent);
}
.secondary { background: transparent; color: var(--text); border: 2px solid var(--line); font-size: var(--fs-body); padding: 0 18px; }
.disabled { color: var(--text-3); cursor: default; background: var(--win); border: 2px solid var(--raise); }
</style>
```

- [ ] **Step 4: 통과 + 커밋**

Run: `pnpm test -- PixelButton` → PASS. `pnpm lint` clean.

```bash
git add frontend/src/components/ui
git commit -m "feat(frontend): 픽셀 UI 기본 컴포넌트(창·태그·버튼·아이콘)"
```

---

### Task 11: ChoiceMenu · StatCard · KeyValueGrid

**Files:**
- Create: `frontend/src/components/ui/ChoiceMenu.vue`, `StatCard.vue`, `KeyValueGrid.vue`
- Test: `frontend/src/components/ui/ChoiceMenu.test.ts`

**Interfaces:**
- Produces:
  - `ChoiceMenu<T extends string>`: props `items: { value: T; label: string }[]`, `modelValue: T | null`, `direction?: 'vertical' | 'horizontal'`, `disabled?: boolean`; emits `update:modelValue`. 방향키(세로 ↑↓ / 가로 ←→)로 선택 이동, Enter/Space로 확정(선택 = 확정, 별도 하이라이트 없음). `role="radiogroup"`, 항목 `role="radio"`.
  - `StatCard`: props `label: string`, `value: string`, `state: 'ok' | 'partial' | 'fail' | 'pending'` — 3칸 게이지 ok=3 partial=2 fail=1(`--danger`) pending=0
  - `KeyValueGrid`: props `items: { key: string; value: string }[]`, `columns?: number`(기본 4)

- [ ] **Step 1: 실패하는 테스트**

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChoiceMenu from './ChoiceMenu.vue'

const items = [
  { value: 'yes', label: '네' },
  { value: 'no', label: '아니요' },
]

describe('ChoiceMenu', () => {
  it('클릭으로 선택하고 update:modelValue를 낸다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: null } })
    await w.findAll('[role=radio]')[1].trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['no'])
  })
  it('선택된 항목에 커서 아이콘이 붙는다', () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: 'yes' } })
    const radios = w.findAll('[role=radio]')
    expect(radios[0].find('svg').exists()).toBe(true)
    expect(radios[1].find('svg').exists()).toBe(false)
    expect(radios[0].attributes('aria-checked')).toBe('true')
  })
  it('ArrowDown은 다음 항목을 선택한다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: 'yes' } })
    await w.find('[role=radiogroup]').trigger('keydown', { key: 'ArrowDown' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['no'])
  })
  it('disabled면 아무것도 내지 않는다', async () => {
    const w = mount(ChoiceMenu, { props: { items, modelValue: null, disabled: true } })
    await w.findAll('[role=radio]')[0].trigger('click')
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })
})
```

Run: `pnpm test -- ChoiceMenu` → FAIL.

- [ ] **Step 2: 구현**

`ChoiceMenu.vue`:

```vue
<script setup lang="ts" generic="T extends string">
import CursorIcon from './icons/CursorIcon.vue'

const props = withDefaults(
  defineProps<{ items: { value: T; label: string }[]; modelValue: T | null; direction?: 'vertical' | 'horizontal'; disabled?: boolean }>(),
  { direction: 'vertical', disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [T] }>()

const pick = (v: T) => {
  if (!props.disabled) emit('update:modelValue', v)
}
const onKey = (e: KeyboardEvent) => {
  const next = props.direction === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const prev = props.direction === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  if (e.key !== next && e.key !== prev) return
  e.preventDefault()
  const i = props.items.findIndex((it) => it.value === props.modelValue)
  const n = props.items.length
  const j = e.key === next ? (i + 1) % n : (i - 1 + n) % n
  pick(props.items[j].value)
}
</script>

<template>
  <div class="menu" :class="direction" role="radiogroup" tabindex="0" @keydown="onKey">
    <button
      v-for="it in items"
      :key="it.value"
      type="button"
      role="radio"
      class="item"
      :class="{ on: it.value === modelValue }"
      :aria-checked="it.value === modelValue"
      :disabled="disabled"
      @click="pick(it.value)"
    >
      <span class="slot"><CursorIcon v-if="it.value === modelValue" /></span>
      {{ it.label }}
    </button>
  </div>
</template>

<style scoped>
.menu { display: flex; gap: var(--sp-2); }
.vertical { flex-direction: column; }
.horizontal { flex-direction: row; flex-wrap: wrap; }
.item {
  min-height: 48px;
  padding: 0 var(--sp-5);
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: var(--fs-button);
  cursor: pointer;
}
.vertical .item { padding: 14px var(--sp-5); }
.item.on { background: var(--raise); color: var(--accent); }
.slot { width: 14px; display: inline-flex; }
.item:disabled { cursor: default; }
</style>
```

`StatCard.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{ label: string; value: string; state: 'ok' | 'partial' | 'fail' | 'pending' }>()
const filled = { ok: 3, partial: 2, fail: 1, pending: 0 }[props.state]
</script>

<template>
  <div class="card">
    <span class="mono label">{{ label }}</span>
    <span class="value" :class="{ pending: state === 'pending' }">{{ value }}</span>
    <span class="gauge" :class="state">
      <i v-for="n in 3" :key="n" :class="{ on: n <= filled }" />
    </span>
  </div>
</template>

<style scoped>
.card { background: var(--bg); padding: 18px var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-2); }
.label { font-size: var(--fs-meta); color: var(--text-3); }
.value { font-size: 18px; }
.pending { color: var(--text-3); }
.gauge { display: flex; gap: var(--sp-1); }
.gauge i { width: 14px; height: 14px; background: var(--raise); }
.gauge i.on { background: var(--ok); }
.gauge.fail i.on { background: var(--danger); }
</style>
```

`KeyValueGrid.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ items: { key: string; value: string }[]; columns?: number }>(), { columns: 4 })
</script>

<template>
  <dl class="grid mono" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
    <div v-for="it in items" :key="it.key" class="cell">
      <dt>{{ it.key }}</dt>
      <dd>{{ it.value }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.grid { display: grid; gap: var(--sp-4); margin: 0; padding: var(--sp-4) var(--sp-5); background: var(--bg); font-size: var(--fs-label); line-height: 1.6; }
.cell { display: flex; flex-direction: column; gap: var(--sp-1); }
dt { color: var(--text-3); font-size: var(--fs-meta); }
dd { margin: 0; color: var(--text); }
</style>
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- ChoiceMenu` → PASS.

```bash
git add frontend/src/components/ui
git commit -m "feat(frontend): 선택 메뉴(키보드 지원)·스탯 카드·키값 격자"
```

---

### Task 12: SpeechText · SpriteFrame · Avatar

**Files:**
- Create: `frontend/src/components/ui/SpeechText.vue`, `SpriteFrame.vue`, `Avatar.vue`
- Test: `frontend/src/components/ui/SpeechText.test.ts`

**Interfaces:**
- Produces:
  - `SpeechText`: props `text: string`, `typing?: boolean`(기본 true), `size?: 'md' | 'lg'`(20/24px), `cursor?: boolean`(타이핑 중 블록 커서); emits `done`. 글자당 30ms, `.,?!` 뒤 120ms 추가. `prefers-reduced-motion`이면 즉시 전체 표시.
  - `SpriteFrame`: props `src: string`(시트 URL), `frameW: number`, `frameH: number`, `frames: number`, `scale: number`, `index?: number`(기본 0), `fps?: number`(0이면 정지, >0이면 1..frames-1 루프)
  - `Avatar`: props `src`, `frameW?`(32), `frameH?`(32) — 96×96 `--raise` 틀 안에 0번 프레임 2배

- [ ] **Step 1: 실패하는 테스트**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SpeechText from './SpeechText.vue'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SpeechText', () => {
  it('30ms마다 한 글자씩 찍고 끝나면 done', async () => {
    const w = mount(SpeechText, { props: { text: '안녕' } })
    expect(w.text()).toBe('')
    await vi.advanceTimersByTimeAsync(30)
    expect(w.text()).toBe('안')
    await vi.advanceTimersByTimeAsync(30)
    expect(w.text()).toBe('안녕')
    expect(w.emitted('done')).toHaveLength(1)
  })
  it('문장부호 뒤에는 120ms 더 쉰다', async () => {
    const w = mount(SpeechText, { props: { text: '네. 가' } })
    await vi.advanceTimersByTimeAsync(60) // '네.'
    expect(w.text()).toBe('네.')
    await vi.advanceTimersByTimeAsync(30)
    expect(w.text()).toBe('네.') // 아직 쉬는 중
    await vi.advanceTimersByTimeAsync(150)
    expect(w.text()).toBe('네. 가')
  })
  it('typing=false면 즉시 전부', () => {
    expect(mount(SpeechText, { props: { text: '전부', typing: false } }).text()).toBe('전부')
  })
  it('reduced-motion이면 즉시 전부', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    expect(mount(SpeechText, { props: { text: '전부' } }).text()).toBe('전부')
  })
})
```

Run: `pnpm test -- SpeechText` → FAIL.

- [ ] **Step 2: 구현**

`SpeechText.vue`:

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ text: string; typing?: boolean; size?: 'md' | 'lg'; cursor?: boolean }>(), {
  typing: true,
  size: 'md',
  cursor: false,
})
const emit = defineEmits<{ done: [] }>()

const shown = ref('')
const busy = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function stop() {
  if (timer) clearTimeout(timer)
  timer = null
  busy.value = false
}

function run(text: string) {
  stop()
  if (!props.typing || reduced()) {
    shown.value = text
    emit('done')
    return
  }
  shown.value = ''
  busy.value = true
  let i = 0
  const step = () => {
    if (i >= text.length) {
      stop()
      emit('done')
      return
    }
    const ch = text[i++]
    shown.value += ch
    if (i >= text.length) {
      stop()
      emit('done')
      return
    }
    timer = setTimeout(step, /[.,?!]/.test(ch) ? 150 : 30)
  }
  timer = setTimeout(step, 30)
}

watch(() => props.text, run, { immediate: true })
onBeforeUnmount(stop)
</script>

<template>
  <p class="speech" :class="size">{{ shown }}<span v-if="cursor && busy" class="caret blink" /></p>
</template>

<style scoped>
.speech { margin: 0; line-height: 1.75; color: var(--text); white-space: pre-wrap; }
.md { font-size: var(--fs-body-md); }
.lg { font-size: var(--fs-body-lg); line-height: 1.6; }
.caret { display: inline-block; width: 12px; height: 0.9em; background: var(--accent); vertical-align: -0.1em; margin-left: var(--sp-1); }
</style>
```

`SpriteFrame.vue`:

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ src: string; frameW: number; frameH: number; frames: number; scale: number; index?: number; fps?: number }>(),
  { index: 0, fps: 0 },
)
const cur = ref(props.index)
let timer: ReturnType<typeof setInterval> | null = null

function restart() {
  if (timer) clearInterval(timer)
  timer = null
  cur.value = props.index
  if (props.fps > 0 && props.frames > 1) {
    // 0번은 기본 자세, 1..N-1 루프 (스프라이트 규칙)
    timer = setInterval(() => (cur.value = 1 + (cur.value % (props.frames - 1))), 1000 / props.fps)
  }
}
watch(() => [props.src, props.fps, props.index], restart, { immediate: true })
onBeforeUnmount(() => timer && clearInterval(timer))

const style = computed(() => ({
  width: `${props.frameW * props.scale}px`,
  height: `${props.frameH * props.scale}px`,
  backgroundImage: `url(${props.src})`,
  backgroundSize: `${props.frameW * props.frames * props.scale}px ${props.frameH * props.scale}px`,
  backgroundPosition: `-${cur.value * props.frameW * props.scale}px 0`,
}))
</script>

<template>
  <div class="px sprite" :style="style" aria-hidden="true" />
</template>

<style scoped>
.sprite { background-repeat: no-repeat; flex-shrink: 0; }
</style>
```

`Avatar.vue`:

```vue
<script setup lang="ts">
import SpriteFrame from './SpriteFrame.vue'
withDefaults(defineProps<{ src: string; frames: number; frameW?: number; frameH?: number }>(), { frameW: 32, frameH: 32 })
</script>

<template>
  <div class="avatar">
    <SpriteFrame :src="src" :frame-w="frameW" :frame-h="frameH" :frames="frames" :scale="2" />
  </div>
</template>

<style scoped>
.avatar { width: 96px; height: 96px; background: var(--raise); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
</style>
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- SpeechText` → PASS.

```bash
git add frontend/src/components/ui
git commit -m "feat(frontend): 타이핑 대사·스프라이트 프레임·아바타 컴포넌트"
```

---

### Task 13: PixelProgress (캔버스 장면 + 바)

**Files:**
- Create: `frontend/src/components/ui/PixelProgress.vue`
- Test: `frontend/src/components/ui/PixelProgress.test.ts`

**Interfaces:**
- Consumes: `advance`, `stageIndexFor`, `captionFor`, `STAGES` (Task 3), `formatBytes`
- Produces: props `progress: number`(0–100), `phase: 'download' | 'init' | 'ready' | 'error'`, `received: number`, `total: number`, `fileName: string`, `eta?: string`, `errorText?: string`; slot `actions`(오류 시 버튼들). 캔버스 320×80을 CSS 폭 100%로 확대(`image-rendering: pixelated`), 시트는 `/sprites/manifest.json`을 읽어 로드.

- [ ] **Step 1: 실패하는 테스트**

캔버스 그리기는 jsdom에서 안 되므로 `getContext`를 스텁하고, 문구·바 폭·상태 클래스만 검사한다.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PixelProgress from './PixelProgress.vue'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
})
afterEach(() => vi.unstubAllGlobals())

const base = { received: 1_220_000_000, total: 2_970_000_000, fileName: 'gemma4-e4b-it-web.litertlm' }

describe('PixelProgress', () => {
  it('다운로드 중: 구간 문구와 퍼센트, 바 폭', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 41, phase: 'download', eta: '약 1분 30초 남음' } })
    expect(w.text()).toContain('양복은 챙겼습니다')
    expect(w.text()).toContain('41%')
    expect(w.text()).toContain('1.14 GB / 2.77 GB')
    expect((w.find('.fill').element as HTMLElement).style.width).toBe('41%')
  })
  it('초기화 중 문구', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 100, phase: 'init' } })
    expect(w.text()).toContain('출근 완료 — 자리에 앉는 중')
  })
  it('준비 완료면 바가 ok', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 100, phase: 'ready' } })
    expect(w.text()).toContain('면접관이 자리에 앉았습니다')
    expect(w.find('.fill').classes()).toContain('ok')
  })
  it('오류면 danger + 문구 + actions 슬롯', () => {
    const w = mount(PixelProgress, {
      props: { ...base, progress: 12, phase: 'error', errorText: '연결이 끊겼습니다' },
      slots: { actions: '<button>다시 시도</button>' },
    })
    expect(w.find('.fill').classes()).toContain('danger')
    expect(w.text()).toContain('연결이 끊겼습니다')
    expect(w.find('button').text()).toBe('다시 시도')
  })
})
```

Run: `pnpm test -- PixelProgress` → FAIL.

- [ ] **Step 2: 구현**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { STAGES, advance, captionFor, stageIndexFor, type OnceAnim, type StageState } from '@/utils/progressStages'
import { formatBytes } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    progress: number
    phase: 'download' | 'init' | 'ready' | 'error'
    received: number
    total: number
    fileName: string
    eta?: string
    errorText?: string
  }>(),
  { eta: '', errorText: '' },
)

const caption = computed(() => {
  if (props.phase === 'init') return '출근 완료 — 자리에 앉는 중'
  if (props.phase === 'ready') return '면접관이 자리에 앉았습니다'
  if (props.phase === 'error') return props.errorText
  return captionFor(props.progress)
})
const right = computed(() => (props.phase === 'download' ? `${props.progress}% · ${props.eta}` : props.phase === 'init' ? '초기화 중' : ''))

/* ---------- 캔버스 장면 (pixel-progress/index.html 이식) ---------- */
type SheetMeta = { file: string; frames: number; w: number; h: number; img?: HTMLImageElement }
const canvas = ref<HTMLCanvasElement | null>(null)
const W = 320
const H = 80
const GROUND = H - 8
const CHAR_X = 60
const FPS = 10
const SCROLL = 40
const APPROACH = 8
let sheets: Record<string, SheetMeta> = {}
let state: StageState = { stage: 0, queue: [] }
let once: { name: OnceAnim; start: number } | null = null
let scroll = 0
let last = 0
let raf = 0
let colors = { ink: '', sky: '' }

async function loadSheets() {
  const res = await fetch('/sprites/manifest.json')
  const m = (await res.json()) as Record<string, SheetMeta>
  for (const [k, v] of Object.entries(m)) {
    const img = new Image()
    img.src = `/sprites/${v.file.split('/').pop()}`
    sheets[k] = { ...v, img }
  }
}

function frame(now: number) {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const dt = last ? (now - last) / 1000 : 0
  last = now
  const stage = STAGES[state.stage]
  if (!once && state.queue.length) once = { name: state.queue.shift()!, start: now }

  let sheet: SheetMeta | undefined
  let idx = 0
  if (once) {
    const s = sheets[once.name]
    idx = Math.floor(((now - once.start) / 1000) * FPS)
    if (s && idx >= s.frames) {
      if (once.name === 'look_up') idx = s.frames - 1
      else once = null
    }
    if (once) sheet = s
  }
  const walking = !once && props.phase === 'download' && stage.walk
  if (walking) {
    sheet = sheets[stage.walk!]
    if (sheet) idx = 1 + (Math.floor((now / 1000) * FPS) % (sheet.frames - 1))
    scroll += dt * SCROLL
  }
  if (!sheet) {
    sheet = sheets[stage.walk ?? 'walk_suit_bag']
    idx = props.phase !== 'download' && sheets.look_up ? sheets.look_up.frames - 1 : 0
    if (props.phase !== 'download' && sheets.look_up) sheet = sheets.look_up
  }

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = colors.ink
  for (let x = -(scroll % 24); x < W; x += 24) ctx.fillRect(x, GROUND + 3, 8, 1)
  ctx.fillStyle = colors.sky
  for (let x = -((scroll * 0.3) % 90); x < W; x += 90) {
    ctx.fillRect(x + 10, 14, 14, 3)
    ctx.fillRect(x + 14, 11, 8, 3)
  }
  const approachX = (at: number, gap: number) => CHAR_X + gap + Math.max(0, at - props.progress) * APPROACH
  const b = sheets.company2
  if (b?.img?.complete) {
    const bx = approachX(90, 40)
    if (bx < W) ctx.drawImage(b.img, bx, GROUND - b.h + 2)
  }
  STAGES.forEach((s, i) => {
    if (!s.item) return
    const picking = once && once.name === s.once
    if (i <= state.stage && !(picking && idx < 4)) return
    const it = sheets[s.item]
    const x = approachX(s.at, 18)
    if (it?.img?.complete && x < W) ctx.drawImage(it.img, x, GROUND - it.h + 2)
  })
  if (sheet?.img?.complete) ctx.drawImage(sheet.img, idx * sheet.w, 0, sheet.w, sheet.h, CHAR_X, GROUND - sheet.h + 2, sheet.w, sheet.h)
  raf = requestAnimationFrame(frame)
}

watch(
  () => props.progress,
  (p, prev) => {
    if (p < (prev ?? 0)) state = { stage: 0, queue: [] }
    state = advance(state, p)
  },
  { immediate: true },
)

onMounted(async () => {
  const css = getComputedStyle(document.documentElement)
  colors = { ink: css.getPropertyValue('--text-3').trim(), sky: css.getPropertyValue('--raise').trim() }
  state = { stage: stageIndexFor(props.progress), queue: [] } // 캐시 히트 등으로 중간에서 시작하면 전환 애니 없이 그 구간부터
  await loadSheets()
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="progress">
    <canvas ref="canvas" class="px scene" :width="W" :height="H" />
    <div class="bar"><div class="fill" :class="{ ok: phase === 'ready', danger: phase === 'error' }" :style="{ width: `${progress}%` }" /></div>
    <div class="mono meta">
      <span>{{ formatBytes(received) }} / {{ formatBytes(total) }}</span>
      <span class="caption" :class="{ danger: phase === 'error' }">{{ caption }}</span>
      <span>{{ right }}</span>
    </div>
    <div v-if="phase === 'error'" class="actions"><slot name="actions" /></div>
    <div class="mono file">{{ fileName }}</div>
  </div>
</template>

<style scoped>
.progress { display: flex; flex-direction: column; gap: var(--sp-4); }
.scene { width: 100%; height: auto; background: var(--bg); display: block; }
.bar { height: 22px; border: 3px solid var(--line); background: var(--bg); padding: 2px; }
.fill { height: 100%; background: var(--accent); }
.fill.ok { background: var(--ok); }
.fill.danger { background: var(--danger); }
.meta { display: flex; justify-content: space-between; gap: var(--sp-4); font-size: var(--fs-body-sm); color: var(--text-2); }
.caption { color: var(--text); }
.caption.danger { color: var(--danger); }
.actions { display: flex; gap: var(--sp-3); }
.file { font-size: var(--fs-meta); color: var(--text-3); text-align: right; }
</style>
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- PixelProgress` → PASS. `pnpm dev`로 `/`에 임시 마운트해 캐릭터가 걷는지 눈으로 확인(다음 Task에서 준비 화면에 붙는다).

```bash
git add frontend/src/components/ui/PixelProgress.vue frontend/src/components/ui/PixelProgress.test.ts
git commit -m "feat(frontend): 출근 장면 프로그레스(캔버스 STAGES 이식 + 바 + 상태 문구)"
```

---

### Task 14: LandingView

**Files:**
- Create: `frontend/src/views/LandingView.vue`
- Test: `frontend/src/views/LandingView.test.ts`

**Interfaces:**
- Consumes: `useModelStore`(manifest, manifestError, download), `useInterviewStore`(goto), `checkEnvironment`, `verdict`, `formatGB`, UI 컴포넌트 전부
- Produces: 화면. "내려받기 시작" → `navigator.storage.persist?.()` → `model.download()`(await 안 함) → `interview.goto('prepare')`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/gpuCheck', () => ({ checkEnvironment: vi.fn() }))
vi.mock('@/services/api', () => ({ getManifest: vi.fn(), getQuestions: vi.fn() }))
vi.mock('@/services/modelCache', () => ({ hasModel: vi.fn(async () => false), downloadModel: vi.fn(async () => {}), clearModels: vi.fn() }))

import { checkEnvironment } from '@/services/gpuCheck'
import { getManifest } from '@/services/api'
import { useModelStore } from '@/stores/model'
import { useInterviewStore } from '@/stores/interview'
import LandingView from './LandingView.vue'

const manifest = { id: 'e4b', url: '/models/e4b.litertlm', size: 2969059328, template: { turnStart: '', turnEnd: '', roles: {} }, systemPromptOverride: null, fallback: null }

const mountView = () =>
  mount(LandingView, { global: { stubs: { SpeechText: { props: ['text'], template: '<p>{{ text }}</p>' } } } })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(getManifest).mockResolvedValue(manifest)
  vi.mocked(checkEnvironment).mockResolvedValue({ webgpu: true, gpuName: 'Test GPU', storageFree: 10e9 })
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
})
afterEach(() => vi.unstubAllGlobals())

describe('LandingView', () => {
  it('매니페스트 용량을 동의 창에 보여준다', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('약 2.8GB')
  })

  it('동의 "네"를 고르면 장비 확인 창이 열리고 결과가 나온다', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.find('[data-test=env]').exists()).toBe(false)
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    expect(w.find('[data-test=env]').exists()).toBe(true)
    expect(w.text()).toContain('Test GPU')
    expect(w.text()).toContain('출전 가능')
  })

  it('WebGPU가 없으면 실행 불가 + 버튼 비활성', async () => {
    vi.mocked(checkEnvironment).mockResolvedValue({ webgpu: false, gpuName: null, storageFree: null })
    const w = mountView()
    await flushPromises()
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('실행 불가')
    expect((w.find('[data-test=start-download]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('내려받기 시작 → 다운로드 시작 + prepare로 이동', async () => {
    const w = mountView()
    await flushPromises()
    await w.findAll('[role=radio]')[0].trigger('click')
    await flushPromises()
    await w.find('[data-test=start-download]').trigger('click')
    await flushPromises()
    expect(useInterviewStore().phase).toBe('prepare')
    expect(['downloading', 'downloaded']).toContain(useModelStore().status)
  })
})
```

Run: `pnpm test -- LandingView` → FAIL.

- [ ] **Step 2: 구현**

```vue
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useModelStore } from '@/stores/model'
import { useInterviewStore } from '@/stores/interview'
import { checkEnvironment, type EnvCheck } from '@/services/gpuCheck'
import { verdict } from '@/utils/envVerdict'
import { formatGB } from '@/utils/format'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ChoiceMenu from '@/components/ui/ChoiceMenu.vue'
import StatCard from '@/components/ui/StatCard.vue'
import KeyValueGrid from '@/components/ui/KeyValueGrid.vue'
import SpeechText from '@/components/ui/SpeechText.vue'
import Avatar from '@/components/ui/Avatar.vue'
import CursorIcon from '@/components/ui/icons/CursorIcon.vue'

const model = useModelStore()
const interview = useInterviewStore()

/* 히어로 페이드: 스크롤 진행률 0→1 */
const hero = ref<HTMLElement | null>(null)
const fade = ref(0)
const onScroll = () => {
  const h = hero.value?.offsetHeight ?? 1
  fade.value = Math.min(1, Math.max(0, window.scrollY / (h * 0.6)))
}
onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  if (!model.manifest) model.loadManifest()
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

/* 동의 */
type Consent = 'yes' | 'no'
const consent = ref<Consent | null>(null)
const consentItems = [
  { value: 'yes' as const, label: '네, 이해했고 이 브라우저에 내려받는 데 동의합니다.' },
  { value: 'no' as const, label: '아니요, 더 알아보고 올게요.' },
]
const introEl = ref<HTMLElement | null>(null)
const envEl = ref<HTMLElement | null>(null)

/* 장비 확인 */
const env = ref<EnvCheck | null>(null)
const envBusy = ref(false)
const need = computed(() => model.active?.size ?? 0)
const result = computed(() => (env.value ? verdict(env.value, need.value) : null))

async function onConsent(v: Consent) {
  consent.value = v
  if (v === 'no') {
    introEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  envBusy.value = true
  env.value = await checkEnvironment()
  envBusy.value = false
  await nextTick()
  envEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const sizeText = computed(() => (model.active ? formatGB(model.active.size) : '확인 중'))
const kv = computed(() => [
  { key: '모델', value: model.active?.id ?? '확인 중' },
  { key: '용량', value: sizeText.value },
  { key: '저장 위치', value: '이 브라우저의 캐시' },
  { key: '삭제', value: '사이트 데이터 삭제로 언제든' },
])
const storageText = computed(() => {
  if (!env.value) return '확인 중'
  if (env.value.storageFree === null) return '알 수 없음 · 필요 ' + sizeText.value.replace('약 ', '')
  return `여유 ${(env.value.storageFree / 1024 ** 3).toFixed(1)}GB · 필요 ${sizeText.value.replace('약 ', '')}`
})

function startDownload() {
  navigator.storage?.persist?.().catch(() => undefined)
  void model.download()
  interview.goto('prepare')
}
</script>

<template>
  <div class="landing stars">
    <!-- 1. 타이틀 -->
    <section ref="hero" class="hero" :style="{ opacity: 1 - fade, transform: `translateY(${-40 * fade}px)` }">
      <PixelWindow padding="md" class="title-win">
        <template #header><PixelTag>브라우저에서 실행 · 서버 전송 없음</PixelTag></template>
        <h1 class="display logo">모두의<br />모의면접</h1>
        <p class="sub">이력서를 읽는 AI 면접관이 이 컴퓨터 안에서 기다립니다.</p>
      </PixelWindow>
      <div class="hint blink"><CursorIcon /> 아래로 내려서 시작</div>
    </section>

    <div class="content">
      <!-- 2. 면접관 소개 -->
      <section ref="introEl">
        <PixelWindow>
          <div class="intro">
            <Avatar src="/sprites/interviewers/center_talk.png" :frames="7" />
            <div class="intro-text">
              <PixelTag>면접관</PixelTag>
              <SpeechText
                text="반갑습니다. 저는 여러분의 이력서 PDF를 읽고 질문 다섯 개를 준비합니다. 답변이 흥미로우면 꼬리질문도 하죠. 말로 답해도 되고 글로 답해도 됩니다. 끝나면 점수 대신 문항별 피드백을 드리겠습니다."
              />
              <p class="note">단, 저는 서버가 아니라 이 브라우저 안에서 움직입니다. 그래서 처음 한 번은 제 몸(모델 파일)을 내려받아야 합니다.</p>
            </div>
          </div>
        </PixelWindow>
      </section>

      <!-- 3. 동의 -->
      <PixelWindow title="모델 다운로드에 동의하시겠습니까?">
        <KeyValueGrid :items="kv" />
        <p v-if="model.manifestError" class="mono meta danger">서버에 연결할 수 없습니다 — 새로고침해 주세요.</p>
        <ChoiceMenu :items="consentItems" :model-value="consent" @update:model-value="onConsent" />
        <p class="mono meta">선택하면 아래 장비 확인 창으로 이동합니다.</p>
      </PixelWindow>

      <!-- 4. 장비 확인 -->
      <section v-if="consent === 'yes'" ref="envEl" data-test="env">
        <PixelWindow title="장비 확인">
          <template #tag>
            <PixelTag v-if="result === 'ok'" tone="ok">출전 가능</PixelTag>
            <PixelTag v-else-if="result === 'no-webgpu'" tone="danger">실행 불가</PixelTag>
            <PixelTag v-else-if="result === 'no-space'" tone="danger">공간 부족</PixelTag>
            <PixelTag v-else tone="muted">확인 중</PixelTag>
          </template>
          <div class="stats">
            <StatCard label="WebGPU" :value="env ? (env.webgpu ? '지원됨' : '지원 안 됨') : '확인 중'" :state="env ? (env.webgpu ? 'ok' : 'fail') : 'pending'" />
            <StatCard label="GPU" :value="env ? (env.gpuName ?? '이름 확인 불가') : '확인 중'" :state="env ? (env.webgpu ? 'partial' : 'fail') : 'pending'" />
            <StatCard label="저장 공간" :value="storageText" :state="!env ? 'pending' : result === 'no-space' ? 'fail' : env.storageFree === null ? 'partial' : 'ok'" />
          </div>
          <p class="body2">하드웨어 성능에 따라 응답 속도와 면접 품질이 달라질 수 있습니다. GPU 메모리가 부족하면 경량 모델(E2B, 약 2.0GB)로 자동 전환되며, 그 경우 질문의 깊이가 얕아질 수 있습니다.</p>
          <p v-if="result === 'no-webgpu'" class="body2 danger">이 브라우저에서는 WebGPU를 쓸 수 없습니다. 최신 Chrome(데스크톱)과 전용 GPU가 필요합니다.</p>
          <p v-else-if="result === 'no-space'" class="body2 danger">브라우저 저장 공간이 부족합니다. {{ sizeText }} 이상 비워 주세요.</p>
          <PixelButton data-test="start-download" :disabled="result !== 'ok' || envBusy" @click="startDownload">확인했습니다. 내려받기 시작</PixelButton>
        </PixelWindow>
      </section>
    </div>
  </div>
</template>

<style scoped>
.landing { min-height: 100vh; padding-bottom: 120px; }
.hero { height: 780px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-10); }
.title-win { align-items: center; text-align: center; padding: var(--sp-14) 72px 48px; }
.logo { margin: 0; font-size: var(--fs-logo); line-height: 0.95; letter-spacing: -2px; text-shadow: 8px 8px 0 var(--raise); }
.sub { margin: 0; font-size: var(--fs-body-md); color: var(--text-2); }
.hint { display: flex; align-items: center; gap: var(--sp-3); font-size: var(--fs-button); color: var(--accent); }
.content { max-width: var(--content-w); margin: 0 auto; display: flex; flex-direction: column; gap: var(--sp-10); padding: 0 var(--sp-4); }
.intro { display: flex; gap: var(--sp-8); align-items: flex-start; }
.intro-text { display: flex; flex-direction: column; gap: 18px; align-items: flex-start; }
.note { margin: 0; color: var(--text-2); }
.meta { margin: 0; font-size: var(--fs-meta); color: var(--text-2); }
.body2 { margin: 0; color: var(--text-2); line-height: 1.75; }
.danger { color: var(--danger); }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-4); }
@media (max-width: 1280px) { .content { padding: 0 var(--sp-10); } }
</style>
```

> 테스트 첫 항목의 `'약 2.8GB'`: `2969059328 / 1024³ = 2.76…` → `formatGB`는 `약 2.8GB`를 만든다. docs/API.md의 "약 3.0GB"는 10진 GB 표기다. 화면은 사용자 기기의 저장 공간 표기(브라우저·OS가 GiB 기준)와 맞추기 위해 1024 기준을 쓴다. 이 결정은 spec 4.1 "용량 표기" 문장에 "1024 기준(GiB)"으로 반영한다(Task 16).

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- LandingView` → PASS. `pnpm dev` + 백엔드(`uv run uvicorn app.main:app --reload`, `backend/`에서)로 실제 매니페스트 용량이 뜨는지 확인.

```bash
git add frontend/src/views/LandingView.vue frontend/src/views/LandingView.test.ts
git commit -m "feat(frontend): 랜딩 화면(타이틀 페이드·면접관 소개·동의·장비 확인·내려받기 시작)"
```

---

### Task 15: PrepareView

**Files:**
- Create: `frontend/src/views/PrepareView.vue`
- Test: `frontend/src/views/PrepareView.test.ts`

**Interfaces:**
- Consumes: `useModelStore`, `useInterviewStore`, `extractPdfText`, `FIELD_LABELS`, `PixelProgress`, UI 컴포넌트
- Produces: 화면. "면접 시작" 클릭 → `interview.goto('interview')`(plan 2에서 `interview.start()`로 교체)

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({ getManifest: vi.fn(), getQuestions: vi.fn(async () => ({ field: 'it', questions: [] })) }))
vi.mock('@/services/pdf', () => ({ extractPdfText: vi.fn() }))

import { extractPdfText } from '@/services/pdf'
import { useModelStore } from '@/stores/model'
import { useInterviewStore } from '@/stores/interview'
import PrepareView from './PrepareView.vue'

const mountView = () => mount(PrepareView, { global: { stubs: { PixelProgress: true } } })

beforeEach(() => {
  setActivePinia(createPinia())
  const m = useModelStore()
  m.active = { id: 'e4b', url: '/models/e4b.litertlm', size: 100 }
  m.total = 100
  m.received = 78
  m.status = 'downloading'
})

describe('PrepareView', () => {
  it('아무것도 없으면 시작 버튼 비활성 + 이유', () => {
    const w = mountView()
    const btn = w.find('[data-test=start]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(btn.text()).toContain('면접관이 자리에 앉으면 열립니다')
  })

  it('분야 칩 + 직무 + PDF → 입력 완료 태그', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('이력서 '.repeat(100))
    const w = mountView()
    await w.findAll('[role=radio]')[0].trigger('click') // IT
    await w.find('[data-test=job]').setValue('백엔드 개발자')
    const input = w.find('[data-test=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] })
    await input.trigger('change')
    await flushPromises()
    expect(w.text()).toContain('입력 완료')
    expect(w.text()).toMatch(/\d+자 추출/)
    expect(useInterviewStore().resumeName).toBe('cv.pdf')
  })

  it('추출 글자가 적으면 직접 붙여넣기 안내', async () => {
    vi.mocked(extractPdfText).mockResolvedValue('짧음')
    const w = mountView()
    const input = w.find('[data-test=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'scan.pdf')] })
    await input.trigger('change')
    await flushPromises()
    expect(w.text()).toContain('글자를 거의 읽지 못했습니다')
    expect(w.find('[data-test=paste]').exists()).toBe(true)
  })

  it('모델 ready + 입력 완료면 버튼 활성, 클릭하면 interview로', async () => {
    const w = mountView()
    const m = useModelStore()
    m.status = 'ready'
    const s = useInterviewStore()
    await s.setField('it')
    s.setJob('백엔드')
    s.setResume('cv.pdf', '가'.repeat(60))
    await flushPromises()
    const btn = w.find('[data-test=start]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
    await btn.trigger('click')
    expect(s.phase).toBe('interview')
  })
})
```

Run: `pnpm test -- PrepareView` → FAIL.

- [ ] **Step 2: 구현**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useModelStore } from '@/stores/model'
import { FIELD_LABELS, RESUME_MIN, useInterviewStore, type Field } from '@/stores/interview'
import { extractPdfText } from '@/services/pdf'
import PixelWindow from '@/components/ui/PixelWindow.vue'
import PixelTag from '@/components/ui/PixelTag.vue'
import PixelButton from '@/components/ui/PixelButton.vue'
import ChoiceMenu from '@/components/ui/ChoiceMenu.vue'
import PixelProgress from '@/components/ui/PixelProgress.vue'
import DocIcon from '@/components/ui/icons/DocIcon.vue'

const model = useModelStore()
const interview = useInterviewStore()

const fieldItems = (Object.keys(FIELD_LABELS) as Field[]).map((value) => ({ value, label: FIELD_LABELS[value] }))

/* 진행 창 */
const phase = computed(() =>
  model.status === 'error' ? 'error' : model.status === 'ready' ? 'ready' : model.status === 'initializing' ? 'init' : 'download',
)
const fileName = computed(() => model.active?.url.split('/').pop() ?? '')
/* 남은 시간: 최근 표본 속도로 추정 */
const samples: { t: number; r: number }[] = []
const eta = computed(() => {
  const now = Date.now()
  samples.push({ t: now, r: model.received })
  while (samples.length > 2 && now - samples[0].t > 5000) samples.shift()
  const a = samples[0]
  const rate = (model.received - a.r) / Math.max(1, (now - a.t) / 1000)
  if (rate <= 0 || model.status !== 'downloading') return ''
  const s = Math.round((model.total - model.received) / rate)
  return s >= 60 ? `약 ${Math.floor(s / 60)}분 ${s % 60}초 남음` : `약 ${s}초 남음`
})

/* 이력서 */
const fileInput = ref<HTMLInputElement | null>(null)
const extracting = ref(false)
const tooShort = ref(false)
const pasted = ref('')
async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  extracting.value = true
  try {
    const text = await extractPdfText(file)
    interview.setResume(file.name, text)
    tooShort.value = interview.resumeText.length < RESUME_MIN
  } catch {
    interview.setResume(file.name, '')
    tooShort.value = true
  } finally {
    extracting.value = false
  }
}
function usePasted() {
  interview.setResume(interview.resumeName ?? '직접 입력', pasted.value)
  tooShort.value = interview.resumeText.length < RESUME_MIN
}

const startLabel = computed(() => (interview.canStart ? '면접 시작' : `면접 시작 — ${interview.startBlockReason}`))
function start() {
  if (interview.canStart) interview.goto('interview')
}
</script>

<template>
  <div class="prepare stars">
    <header class="mono topbar">
      <span>모두의 모의면접 · 준비</span>
      <span class="dim">이력서·입력 내용은 이 브라우저를 떠나지 않습니다</span>
    </header>

    <div class="content">
      <!-- 1. 다운로드 / 초기화 -->
      <PixelWindow title="면접관이 출근하는 중">
        <PixelProgress
          :progress="model.progress"
          :phase="phase"
          :received="model.received"
          :total="model.total"
          :file-name="fileName"
          :eta="eta"
          :error-text="model.error ?? ''"
        >
          <template #actions>
            <PixelButton variant="secondary" @click="model.retry()">다시 시도</PixelButton>
            <PixelButton v-if="model.manifest?.fallback && model.active?.id !== model.manifest.fallback.id" variant="secondary" @click="model.useFallback()">경량 모델로 시도</PixelButton>
            <PixelButton variant="secondary" @click="model.clearCache()">캐시 지우기</PixelButton>
          </template>
        </PixelProgress>
      </PixelWindow>

      <!-- 2. 지원 정보 -->
      <PixelWindow title="어디에 지원하시나요?">
        <template #tag><PixelTag v-if="interview.profileDone" tone="ok">입력 완료</PixelTag></template>
        <div class="field">
          <span class="mono label">기업 분야</span>
          <ChoiceMenu :items="fieldItems" :model-value="interview.profile.field" direction="horizontal" @update:model-value="interview.setField" />
        </div>
        <div class="field">
          <label class="mono label" for="job">지원 직무</label>
          <input id="job" data-test="job" class="input" :value="interview.profile.job" maxlength="40" placeholder="예: 백엔드 개발자" @input="interview.setJob(($event.target as HTMLInputElement).value)" />
          <span class="mono hint">면접관이 질문의 방향을 잡는 데 씁니다. 예: 프론트엔드 개발, 재무 분석, 생산 관리</span>
        </div>
      </PixelWindow>

      <!-- 3. 이력서 -->
      <PixelWindow title="이력서">
        <template #tag><PixelTag v-if="interview.resumeDone" tone="ok">{{ interview.resumeText.length.toLocaleString() }}자 추출</PixelTag></template>
        <label class="file-row">
          <DocIcon />
          <span class="mono name">{{ interview.resumeName ?? 'PDF 파일을 끌어다 놓거나 클릭해서 선택' }}</span>
          <span class="mono pick">{{ interview.resumeName ? '다른 파일' : '파일 선택' }}</span>
          <input ref="fileInput" data-test="file" type="file" accept="application/pdf" class="sr" @change="onFile" />
        </label>
        <p v-if="extracting" class="mono hint">읽는 중…</p>
        <div v-if="interview.resumeText && !tooShort" class="preview">{{ interview.resumeText }}</div>
        <template v-if="tooShort">
          <p class="mono warn">글자를 거의 읽지 못했습니다(스캔본일 수 있어요). 아래에 이력서 내용을 직접 붙여넣어 주세요.</p>
          <textarea v-model="pasted" data-test="paste" class="input paste" rows="6" placeholder="이력서 내용을 붙여넣기" @blur="usePasted" />
        </template>
        <p class="mono hint">앞 {{ (2000).toLocaleString() }}자만 면접관에게 전달됩니다. 이름·연락처 같은 개인정보도 이 브라우저 안에서만 읽힙니다.</p>
      </PixelWindow>

      <!-- 시작 -->
      <div class="start-row">
        <ul class="mono checklist">
          <li><i :class="{ ok: interview.profileDone, wait: !interview.profileDone }" /> 분야 · 직무 입력</li>
          <li><i :class="{ ok: interview.resumeDone, wait: !interview.resumeDone }" /> 이력서 읽기</li>
          <li><i :class="{ ok: model.status === 'ready', wait: model.status !== 'ready' }" class="blink-when-wait" /> 면접관 출근 ({{ model.status === 'ready' ? '완료' : `다운로드 ${model.progress}% → 초기화` }})</li>
        </ul>
        <PixelButton data-test="start" :disabled="!interview.canStart" @click="start">{{ startLabel }}</PixelButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prepare { min-height: 100vh; padding-bottom: 80px; }
.topbar { height: 72px; max-width: var(--content-w); margin: 0 auto; display: flex; align-items: center; justify-content: space-between; font-size: var(--fs-label); color: var(--text-2); padding: 0 var(--sp-4); }
.dim { color: var(--text-3); }
.content { max-width: var(--content-w); margin: 0 auto; display: flex; flex-direction: column; gap: var(--sp-10); padding: 0 var(--sp-4); }
.field { display: flex; flex-direction: column; gap: 10px; }
.label { font-size: var(--fs-meta); color: var(--text-3); }
.hint { font-size: var(--fs-meta); color: var(--text-2); }
.warn { font-size: var(--fs-label); color: var(--accent); }
.input { height: 52px; background: var(--bg); border: 2px solid var(--raise); padding: 0 var(--sp-4); color: var(--text); }
.input:focus { border-color: var(--accent); outline: none; }
.paste { height: auto; padding: var(--sp-3) var(--sp-4); resize: vertical; }
.file-row { display: flex; align-items: center; gap: var(--sp-3); background: var(--bg); border: 2px solid var(--raise); padding: 14px var(--sp-4); cursor: pointer; color: var(--text-2); }
.name { flex: 1; color: var(--text); font-size: var(--fs-label); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick { color: var(--accent); font-size: var(--fs-meta); }
.sr { position: absolute; width: 1px; height: 1px; opacity: 0; }
.preview { background: var(--bg); padding: 14px var(--sp-4); font-size: var(--fs-label); color: var(--text-2); max-height: 120px; overflow: hidden; }
.start-row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-8); }
.checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-1); font-size: var(--fs-label); color: var(--text-2); }
.checklist i { display: inline-block; width: 12px; height: 12px; margin-right: 10px; background: var(--raise); vertical-align: -1px; }
.checklist i.ok { background: var(--ok); }
.checklist i.wait.blink-when-wait { background: var(--accent); animation: blink 0.9s steps(1) infinite; }
</style>
```

- [ ] **Step 3: 통과 + 커밋**

Run: `pnpm test -- PrepareView` → PASS.

```bash
git add frontend/src/views/PrepareView.vue frontend/src/views/PrepareView.test.ts
git commit -m "feat(frontend): 준비 화면(진행 창·지원 정보·이력서 PDF·시작 조건 체크리스트)"
```

---

### Task 16: App phase 분기 + 전체 게이트 + 변경 제안

**Files:**
- Modify: `frontend/src/App.vue`, `frontend/src/smoke.test.ts`
- Modify: `docs/specs/frontend/2026-09-15-screens-design.md` (4.1 용량 표기 문장에 "1024 기준(GiB)" 추가, 6절 model 상태에 `downloaded` 추가)
- Create: `frontend/src/views/InterviewView.vue`, `frontend/src/views/ReportView.vue` (plan 2·3 전까지의 자리 표시 — 각각 한 줄 문구)

- [ ] **Step 1: App.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useInterviewStore } from '@/stores/interview'
import LandingView from '@/views/LandingView.vue'
import PrepareView from '@/views/PrepareView.vue'
import InterviewView from '@/views/InterviewView.vue'
import ReportView from '@/views/ReportView.vue'

const interview = useInterviewStore()
const view = computed(
  () => ({ landing: LandingView, prepare: PrepareView, interview: InterviewView, report: ReportView })[interview.phase],
)
</script>

<template>
  <component :is="view" />
</template>
```

`InterviewView.vue` / `ReportView.vue`:

```vue
<script setup lang="ts"></script>
<template>
  <main class="stars" style="min-height: 100vh; display: grid; place-items: center">
    <p class="mono">면접 화면 — plan 2에서 구현</p>
  </main>
</template>
```

(ReportView는 문구만 "리포트 화면 — plan 3에서 구현".)

`smoke.test.ts`를 Pinia 포함으로 갱신:

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import App from './App.vue'

describe('App', () => {
  it('처음엔 랜딩을 보여준다', () => {
    const w = mount(App, { global: { plugins: [createPinia()], stubs: { SpeechText: true, PixelProgress: true } } })
    expect(w.text()).toContain('모두의')
    expect(w.text()).toContain('모의면접')
  })
})
```

- [ ] **Step 2: spec 정정 두 줄**

`docs/specs/frontend/2026-09-15-screens-design.md`:
- 4.1 "용량 표기는 매니페스트 `size`를 GB 소수 첫째 자리로("약 3.0GB")" → "용량 표기는 매니페스트 `size`를 **1024 기준(GiB)** 소수 첫째 자리로("약 2.8GB") — 브라우저 저장 공간 표기와 같은 기준".
- 6절 `stores/model.ts` status에 `'downloaded'`(다운로드 끝, 초기화 전) 추가.

- [ ] **Step 3: full 게이트**

`frontend/`에서: `pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build` → 전부 PASS·clean.

수동 확인(`pnpm dev` + 백엔드): 랜딩 → 동의 → 장비 확인(실제 GPU 이름) → 내려받기 시작 → 준비 화면에서 캐릭터가 걷고 %가 오름(로컬 스모크는 `deploy/README.md`의 더미 모델 파일을 `backend`가 아니라 Vite `public/models/`에 두거나, nginx 로컬 컴포즈로 `/models/` 서빙) → 분야·직무·PDF 입력 → 체크리스트 2개 초록, 버튼은 "면접관이 자리에 앉으면 열립니다"(초기화는 plan 2).

- [ ] **Step 4: 커밋 + 변경 제안**

```bash
git add frontend docs/specs/frontend/2026-09-15-screens-design.md
git commit -m "feat(frontend): phase 분기 App, 면접·리포트 자리 표시, spec 정정(GiB 표기·downloaded 상태)"
git push -u origin feature/frontend-foundation
```

- 제목: `feat(frontend): 프로젝트 기반 + 랜딩·준비 화면`
- 본문: Task 요약 + 게이트 결과 + "계약 변경 없음" + 수동 확인 결과(스크린샷 1장: 준비 화면 진행 중) + CI pnpm 버전 이슈가 있었다면 별도 chore PR 링크.

## 이후

- plan 2 (`docs/plans/frontend/2026-09-16-interview.md` 예정): `services/llm.ts`(LiteRT-LM JS 우선, MediaPipe 폴백), `services/speech.ts`, `prompts/`, `utils/thoughts.ts`·`tokens.ts`·`endDetector.ts`, `stores/interview.ts` 확장(messages·stage·start·send·abort), `stores/model.ts`의 `init()`(`downloaded → initializing → ready`), `InterviewView`.
- plan 3: `utils/reportParser.ts`, `prompts/report.ts`, `ReportView`, 데모 체크리스트.
- 파이 배포는 plan 2 뒤 `main` 머지 → `docker compose up -d --build`.

## Self-Review (계획 검토)

- 스펙 커버리지: 4.1 랜딩(창 1–4, 동의 아니요 처리, 장비 판정 3종, 버튼 비활성 조건, persist) → Task 14. 4.2 준비(진행 구간표·문구·에러 액션 → Task 3·13·15, 분야 칩·직무·폴백 질문 미리 받기 → Task 9·15, PDF 추출·50자 규칙·붙여넣기 → Task 7·9·15, 시작 조건·이유 문구 → Task 9·15). 5 에러 중 랜딩·준비 행 전부 → Task 14·15(매니페스트 실패 문구 포함). 6 인터페이스 중 model·interview(부분)·api·gpuCheck·modelCache·pdf → Task 4–9. 디자인 시스템 3절 토큰 → Task 2, 4절 컴포넌트 중 PixelWindow·Tag·ChoiceMenu·Button·StatCard·KeyValueGrid·SpeechText·Avatar·PixelProgress·SpriteFrame → Task 10–13. 면접·리포트·LLM·음성·프롬프트는 의도적으로 plan 2·3. ✅
- Placeholder 없음: 모든 Step에 실제 코드·명령. Task 7만 테스트 없음(사유 명시). ✅
- 타입·이름 일치: `useModelStore().active/received/total/progress/status`, `useInterviewStore().profile/resumeText/resumeName/canStart/startBlockReason/setField/setJob/setResume/goto`, `checkEnvironment → EnvCheck`, `verdict`, `advance/stageIndexFor/captionFor/STAGES`, `formatGB/formatBytes`, `downloadModel(id,url,size,onProgress,signal?)` — Task 간 동일. PixelProgress 테스트의 `.fill` 클래스(`ok`/`danger`)는 구현 주석대로 바인딩. ✅
- 함정 선제 회피: 565KB 폰트 → 서브셋(Task 2), CI pnpm 9 vs 로컬 11 → Global Constraints에 대응책, `vue-tsc --noEmit`이 project reference로 빈 검사 → 단일 tsconfig(Task 1), pdf.js 워커 CDN 금지 → `?url` 로컬 번들(Task 7), 캔버스·GPU 코드는 테스트에서 스텁(Task 13·14), 색 리터럴 금지는 테스트로 강제(Task 2). ✅
