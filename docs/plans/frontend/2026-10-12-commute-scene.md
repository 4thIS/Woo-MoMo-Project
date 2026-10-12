# 준비 화면 출근 장면 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모델을 받는 동안 보여 주는 출근 장면을 구간 8개·64×64 전신으로 키우고, 사용자가 고른 면접관이 출근하게 한다.

**Architecture:** 장면 로직은 `utils/commuteScene.ts` 순수 함수에 모은다(구간 전환·잔동작 스케줄·소품 흐름). `PixelProgress.vue`는 그 함수를 부르고 캔버스에 그리기만 한다. 에셋은 PixelLab 캐릭터 파이프라인으로 만들고 자동 검사를 통과한 것만 커밋한다.

**Tech Stack:** Vue 3 + TypeScript, Vitest, Canvas 2D, PixelLab API(Python 스크립트), Pillow

**Spec:** `docs/specs/frontend/2026-10-12-commute-scene-design.md`

## Global Constraints

- 걷는 캐릭터 프레임은 **64×64**, 캔버스는 **480×120**, 재생은 **8fps**.
- 구간은 8개이고 진행률 경계는 **0 · 15 · 30 · 45 · 60 · 75 · 88 · 100**.
- 이정표는 **30 · 45 · 100** 셋. 진행률이 점프해도 밀린 전환을 순서대로 재생한다.
- 실내는 0~45%, 실외는 45~100%. 실내에서 배경은 스크롤하지 않는다.
- 잔동작 간격은 **15~25초** 무작위. 이정표 전환 중에는 나오지 않는다.
- `utils/`는 브라우저 API·DOM·스토어를 import하지 않는다(영역 규칙).
- 에셋 경로는 `frontend/public/sprites/commute/{m1,f3,m2,f2}/`, `commute/backgrounds/`, `commute/props/`. 폴더마다 `manifest.json`.
- 한 면접관의 파일이 하나라도 없으면 그 면접관은 **전부** 기존 32×32 세트로 그린다.
- 기존 `public/sprites/*.png`(32×32)는 지우지 않는다.
- 커밋은 Conventional Commits(`feat(frontend):`·`fix(frontend):`·`chore(frontend):`).

## Review Focus

1. **진행률이 뒤로 가거나 크게 점프한다** — 다시 시도·모델 교체·탭 복귀. 구간이 꼬이거나 전환이 빠지면 안 된다. (Task 1)
2. **진행률이 오래 멈춘다** — 초기화 구간에서 rate가 0. 잔동작은 계속 나와야 하고 배경은 멈춰야 한다. (Task 2)
3. **에셋이 일부만 들어온 면접관** — 파일 하나가 404여도 동작마다 다른 캐릭터가 섞이면 안 된다. (Task 8)
4. **면접관 id가 없거나 모르는 값** — 아직 안 고름, 옛 localStorage 값. 화면이 비면 안 된다. (Task 8)
5. **탭이 백그라운드에 있다가 복귀** — `dt`가 수 초로 커진다. 소품이 화면을 가로질러 순간이동하면 안 된다. (Task 3)

---

### Task 1: 구간 정의와 전환

**Files:**
- Create: `frontend/src/utils/commuteScene.ts`
- Test: `frontend/src/utils/commuteScene.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `COMMUTE: readonly CommuteStage[]`, `type CommuteStage`, `type SceneKind`, `type StageState`, `stageAt(progress: number): number`, `advanceStages(state: StageState, progress: number): StageState`, `captionAt(progress: number): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// frontend/src/utils/commuteScene.test.ts
import { describe, expect, it } from 'vitest'
import { COMMUTE, advanceStages, captionAt, stageAt, type StageState } from './commuteScene'

describe('구간', () => {
  it('진행률 경계가 스펙과 같다', () => {
    expect(COMMUTE.map((s) => s.at)).toEqual([0, 15, 30, 45, 60, 75, 88, 100])
  })
  it('45% 전은 실내, 45%부터 실외다', () => {
    for (const s of COMMUTE) expect(s.kind).toBe(s.at < 45 ? 'indoor' : 'outdoor')
  })
  it('이정표는 30·45·100 셋이다', () => {
    expect(COMMUTE.filter((s) => s.once).map((s) => s.at)).toEqual([30, 45, 100])
  })
  it('stageAt은 경계를 포함한다', () => {
    expect(stageAt(0)).toBe(0)
    expect(stageAt(29.9)).toBe(1)
    expect(stageAt(30)).toBe(2)
    expect(stageAt(100)).toBe(COMMUTE.length - 1)
  })
  it('진행률이 점프해도 밀린 전환이 순서대로 큐에 쌓인다', () => {
    const s = advanceStages({ stage: 0, queue: [] }, 100)
    expect(s.stage).toBe(COMMUTE.length - 1)
    expect(s.queue).toEqual(['dress', 'bag', 'arrive'])
  })
  it('진행률이 뒤로 가도 구간은 내려가지 않는다 — 되감기는 호출 쪽이 장면을 다시 세운다', () => {
    const s = advanceStages({ stage: 3, queue: [] }, 10)
    expect(s.stage).toBe(3)
    expect(s.queue).toEqual([])
  })
  it('같은 진행률로 여러 번 불러도 전환이 중복되지 않는다', () => {
    let s: StageState = { stage: 0, queue: [] }
    for (let i = 0; i < 5; i++) s = advanceStages(s, 50)
    expect(s.queue).toEqual(['dress', 'bag'])
  })
  it('문구는 구간을 따른다', () => {
    expect(captionAt(0)).toContain('일어나')
    expect(captionAt(100)).toContain('자리에')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteScene.test.ts`
Expected: FAIL — `Failed to resolve import "./commuteScene"`

- [ ] **Step 3: 최소 구현**

```ts
// frontend/src/utils/commuteScene.ts
/** 준비 화면 출근 장면: 구간 정의와 전환. 브라우저 API를 쓰지 않는 순수 모듈 */

export type SceneKind = 'indoor' | 'outdoor'

export interface CommuteStage {
  /** 이 구간이 시작되는 진행률(%) */
  at: number
  kind: SceneKind
  /** 배경 키 — commute/backgrounds/{bg}.png */
  bg: string
  /** 이 구간의 기본 루프 동작 */
  loop: string
  /** 구간에 들어설 때 한 번 재생하는 전환(이정표) */
  once?: string
  /** 이 구간에서 끼어들 수 있는 잔동작 */
  idles: readonly string[]
  caption: string
}

export const COMMUTE: readonly CommuteStage[] = [
  { at: 0, kind: 'indoor', bg: 'bedroom', loop: 'idle_home', idles: ['yawn'], caption: '막 일어났습니다…' },
  { at: 15, kind: 'indoor', bg: 'washroom', loop: 'idle_home', idles: ['yawn'], caption: '세수하는 중…' },
  { at: 30, kind: 'indoor', bg: 'closet', loop: 'idle_home', once: 'dress', idles: ['yawn'], caption: '양복을 챙겼습니다.' },
  { at: 45, kind: 'outdoor', bg: 'entrance', loop: 'walk', once: 'bag', idles: ['walk_watch'], caption: '가방도 챙겼습니다. 출발합니다.' },
  { at: 60, kind: 'outdoor', bg: 'alley', loop: 'walk', idles: ['walk_watch'], caption: '골목을 지나는 중…' },
  { at: 75, kind: 'outdoor', bg: 'street', loop: 'walk', idles: ['walk_watch'], caption: '큰길로 나왔습니다.' },
  { at: 88, kind: 'outdoor', bg: 'street', loop: 'walk', idles: ['walk_watch'], caption: '회사가 보이기 시작했어요.' },
  { at: 100, kind: 'outdoor', bg: 'street', loop: 'walk', once: 'arrive', idles: [], caption: '면접관이 자리에 앉았습니다' },
]

export interface StageState {
  stage: number
  /** 아직 재생하지 않은 전환 */
  queue: string[]
}

export function stageAt(progress: number): number {
  let i = 0
  while (i + 1 < COMMUTE.length && progress >= COMMUTE[i + 1].at) i++
  return i
}

/** 새 구간을 넘을 때마다 그 구간의 전환을 큐에 넣는다. 점프해도 순서를 지킨다 */
export function advanceStages(state: StageState, progress: number): StageState {
  let { stage } = state
  const queue = [...state.queue]
  while (stage + 1 < COMMUTE.length && progress >= COMMUTE[stage + 1].at) {
    stage++
    const once = COMMUTE[stage].once
    if (once) queue.push(once)
  }
  return { stage, queue }
}

export function captionAt(progress: number): string {
  return COMMUTE[stageAt(progress)].caption
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteScene.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/utils/commuteScene.ts frontend/src/utils/commuteScene.test.ts
git commit -m "feat(frontend): 출근 장면 구간 8개 정의와 전환 큐"
```

---

### Task 2: 잔동작 스케줄

**Files:**
- Modify: `frontend/src/utils/commuteScene.ts`
- Test: `frontend/src/utils/commuteScene.test.ts`

**Interfaces:**
- Consumes: `COMMUTE`, `CommuteStage`
- Produces: `IDLE_GAP: readonly [number, number]`, `nextIdleAt(now: number, rnd: () => number): number`, `pickIdle(stage: CommuteStage, rnd: () => number): string | null`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// commuteScene.test.ts 끝에 추가
import { COMMUTE, IDLE_GAP, nextIdleAt, pickIdle } from './commuteScene'

describe('잔동작', () => {
  it('다음 예정 시각은 15~25초 뒤다', () => {
    expect(nextIdleAt(1000, () => 0)).toBe(1000 + IDLE_GAP[0])
    expect(nextIdleAt(1000, () => 1)).toBe(1000 + IDLE_GAP[1])
    expect(nextIdleAt(1000, () => 0.5)).toBe(1000 + (IDLE_GAP[0] + IDLE_GAP[1]) / 2)
  })
  it('그 구간에 정의된 잔동작만 고른다', () => {
    const bedroom = COMMUTE[0]
    expect(bedroom.idles).toContain(pickIdle(bedroom, () => 0) as string)
  })
  it('잔동작이 없는 구간은 null을 준다', () => {
    const last = COMMUTE[COMMUTE.length - 1]
    expect(pickIdle(last, () => 0)).toBeNull()
  })
  it('진행률이 멈춰 있어도 잔동작 일정은 시간으로만 돈다', () => {
    // 다운로드가 멈춘 초기화 구간에서도 캐릭터는 하품을 한다
    const t = nextIdleAt(0, () => 0)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(IDLE_GAP[1])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteScene.test.ts`
Expected: FAIL — `nextIdleAt is not a function`

- [ ] **Step 3: 최소 구현**

```ts
// commuteScene.ts 끝에 추가
/* ---------- 잔동작 ----------
 * 한 구간이 37초~1분 50초라 같은 루프만 보면 지루하다. 15~25초마다 하나씩 끼워 넣는다.
 * 일정은 진행률이 아니라 시간으로 돈다 — 다운로드가 멈춰도 캐릭터는 살아 있어야 한다. */

export const IDLE_GAP: readonly [number, number] = [15_000, 25_000]

/** 다음 잔동작 예정 시각(ms) */
export function nextIdleAt(now: number, rnd: () => number): number {
  const [a, b] = IDLE_GAP
  return now + a + rnd() * (b - a)
}

/** 이 구간에서 나올 잔동작 하나. 없으면 null */
export function pickIdle(stage: CommuteStage, rnd: () => number): string | null {
  if (!stage.idles.length) return null
  return stage.idles[Math.min(stage.idles.length - 1, Math.floor(rnd() * stage.idles.length))]
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteScene.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/utils/commuteScene.ts frontend/src/utils/commuteScene.test.ts
git commit -m "feat(frontend): 출근 장면 잔동작 스케줄"
```

---

### Task 3: 소품 흐름

**Files:**
- Modify: `frontend/src/utils/commuteScene.ts`
- Test: `frontend/src/utils/commuteScene.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `PROP_KEYS: readonly string[]`, `PROP_GAP: readonly [number, number]`, `type ScenicProp = { key: string; x: number }`, `stepProps(list: ScenicProp[], dt: number, speed: number, width: number): ScenicProp[]`, `spawnProp(width: number, rnd: () => number): ScenicProp`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// commuteScene.test.ts 끝에 추가
import { PROP_GAP, PROP_KEYS, spawnProp, stepProps, type ScenicProp } from './commuteScene'

describe('소품', () => {
  it('오른쪽 화면 밖에서 생긴다', () => {
    const p = spawnProp(480, () => 0)
    expect(p.x).toBeGreaterThanOrEqual(480)
    expect(PROP_KEYS).toContain(p.key)
  })
  it('바닥과 같은 속도로 왼쪽으로 흐른다', () => {
    const out = stepProps([{ key: 'cat', x: 200 }], 0.5, 40, 480)
    expect(out[0].x).toBe(180)
  })
  it('화면 왼쪽으로 완전히 나가면 사라진다', () => {
    expect(stepProps([{ key: 'cat', x: -64 }], 0.1, 40, 480)).toEqual([])
  })
  it('탭 복귀로 dt가 커져도 한 번에 화면을 가로지르지 않는다', () => {
    // rAF가 멈췄다 돌아오면 dt가 수 초가 된다. 소품이 순간이동하면 눈에 띈다
    const out = stepProps([{ key: 'cat', x: 400 }], 5, 40, 480)
    expect(400 - out[0].x).toBeLessThanOrEqual(480)
    expect(out[0].x).toBeLessThan(400)
  })
  it('간격은 3~7초다', () => {
    expect(PROP_GAP).toEqual([3000, 7000])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteScene.test.ts`
Expected: FAIL — `stepProps is not a function`

- [ ] **Step 3: 최소 구현**

```ts
// commuteScene.ts 끝에 추가
/* ---------- 지나가는 소품 (실외) ----------
 * 바닥과 같은 속도로 흘러 길이 이어져 보이게 한다. */

export const PROP_KEYS: readonly string[] = [
  'cat',
  'lamp',
  'vending',
  'planter',
  'pigeon',
  'signal',
]
export const PROP_GAP: readonly [number, number] = [3_000, 7_000]
/** 한 프레임에 소품이 움직일 수 있는 최대 거리(화면 폭). 탭 복귀로 dt가 커져도 순간이동하지 않게 */
const MAX_STEP_RATIO = 1

export interface ScenicProp {
  key: string
  x: number
}

export function spawnProp(width: number, rnd: () => number): ScenicProp {
  const key = PROP_KEYS[Math.min(PROP_KEYS.length - 1, Math.floor(rnd() * PROP_KEYS.length))]
  return { key, x: width + Math.round(rnd() * 40) }
}

/** 소품을 왼쪽으로 흘리고, 화면 밖으로 나간 것은 버린다 */
export function stepProps(
  list: ScenicProp[],
  dt: number,
  speed: number,
  width: number,
): ScenicProp[] {
  const move = Math.min(speed * dt, width * MAX_STEP_RATIO)
  return list.map((p) => ({ ...p, x: p.x - move })).filter((p) => p.x > -64)
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteScene.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/utils/commuteScene.ts frontend/src/utils/commuteScene.test.ts
git commit -m "feat(frontend): 출근 장면 소품 흐름"
```

---

### Task 4: 에셋 품질 검사 스크립트

**Files:**
- Create: `frontend/scripts/sprites/check.py`
- Create: `frontend/scripts/sprites/README.md`

**Interfaces:**
- Consumes: 없음
- Produces: CLI — `python check.py <시트폴더>`가 검사 결과를 출력하고 문제가 있으면 exit 1

- [ ] **Step 1: 검사 스크립트를 쓴다**

```python
# frontend/scripts/sprites/check.py
# -*- coding: utf-8 -*-
"""스프라이트 시트 품질 검사. 생성 모델이 만든 프레임에서 눈에 띄는 결함을 숫자로 잡는다.

걷기는 프레임 간 일관성이 생명이라 정면 샷보다 까다롭다. 지금까지 얼룩 픽셀·화면 패닝·
몸 흔들림·옷 색 변질을 모두 겪었다. 통과한 것만 리포에 넣는다.

사용법:  python check.py ../../public/sprites/commute/m1
"""
import json, os, sys
from PIL import Image

MAX_DRIFT = 6        # 프레임 간 바운딩박스 이동 허용치(px) — 걷기 보폭
PALETTE_TOL = 2      # 기준에 없던 색 허용 개수


def frames(sheet, n):
    w = sheet.width // n
    return [sheet.crop((i * w, 0, (i + 1) * w, sheet.height)) for i in range(n)]


def bbox_drift(ims):
    """프레임 간 바운딩박스가 얼마나 흔들리는지"""
    bbs = [im.getbbox() for im in ims if im.getbbox()]
    if not bbs:
        return None
    xs = [b[0] for b in bbs] + [b[2] for b in bbs]
    ys = [b[1] for b in bbs] + [b[3] for b in bbs]
    return max(xs) - min(xs), max(ys) - min(ys)


def lone_pixels(im):
    """사방이 투명한 1px 점 — 생성 노이즈"""
    px = im.load()
    w, h = im.size
    n = 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                continue
            near = 0
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = x + dx, y + dy
                if 0 <= a < w and 0 <= b < h and px[a, b][3] > 0:
                    near += 1
            if near == 0:
                n += 1
    return n


def palette(im):
    px = im.load()
    return {px[x, y][:3] for y in range(im.height) for x in range(im.width) if px[x, y][3] > 0}


def check(folder):
    man_path = os.path.join(folder, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    base_pal = None
    bad = []
    for key, v in sorted(man.items()):
        p = os.path.join(folder, v["file"])
        sheet = Image.open(p).convert("RGBA")
        n = v["frames"]
        if sheet.width != v["w"] * n or sheet.height != v["h"]:
            bad.append(f"{key}: 시트 크기 {sheet.size}가 manifest({v['w']}x{v['h']} x{n})와 다름")
            continue
        ims = frames(sheet, n)
        drift = bbox_drift(ims)
        if drift and (drift[0] > MAX_DRIFT or drift[1] > MAX_DRIFT):
            bad.append(f"{key}: 캐릭터 흔들림 가로 {drift[0]}px 세로 {drift[1]}px (허용 {MAX_DRIFT})")
        lone = sum(lone_pixels(im) for im in ims)
        if lone:
            bad.append(f"{key}: 고립 픽셀 {lone}개")
        pal = set().union(*(palette(im) for im in ims))
        if base_pal is None:
            base_pal = pal
        else:
            extra = pal - base_pal
            if len(extra) > PALETTE_TOL:
                bad.append(f"{key}: 기준에 없던 색 {len(extra)}종")
        print(f"  {key:16} {n:2}프레임  흔들림 {drift}  고립 {lone}  색 {len(pal)}")
    return bad


if __name__ == "__main__":
    folder = sys.argv[1]
    print(f"검사: {folder}")
    bad = check(folder)
    if bad:
        print("\n문제:")
        for b in bad:
            print("  -", b)
        sys.exit(1)
    print("\n전부 통과")
```

- [ ] **Step 2: 기존 에셋으로 스크립트가 도는지 확인한다**

Run: `cd frontend/scripts/sprites && python check.py ../../public/sprites/interviewers64/m1`
Expected: 각 동작의 프레임 수·흔들림·고립 픽셀·색 수가 출력된다. 92×92 면접관은 정면 고정이라 흔들림이 작아야 한다.

- [ ] **Step 3: README를 쓴다**

```markdown
# 스프라이트 품질 검사

생성 모델이 만든 프레임의 결함을 숫자로 잡는다. 통과한 것만 리포에 넣는다.

    python check.py ../../public/sprites/commute/m1

| 검사 | 기준 |
|---|---|
| 시트 크기 | manifest의 `w`×`frames`, `h`와 일치 |
| 캐릭터 흔들림 | 프레임 간 바운딩박스 이동 6px 이하 |
| 고립 픽셀 | 사방이 투명한 1px 점 0개 |
| 팔레트 이탈 | 첫 동작에 없던 색 2종 이하 |

문제가 있으면 exit 1. 재생성(seed 변경)하거나 후처리로 고친 뒤 다시 돌린다.
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/scripts/sprites
git commit -m "chore(frontend): 스프라이트 품질 검사 스크립트"
```

---

### Task 5: 전신 캐릭터 시안과 확정

**Files:**
- Create: `frontend/public/sprites/commute/{m1,f3,m2,f2}/base.png` (64×64 전신 1프레임)

**Interfaces:**
- Consumes: 기존 `public/sprites/interviewers64/{m1,f3,m2,f2}/center_idle.png` (얼굴·옷 참고용)
- Produces: 면접관 4명의 64×64 전신 기본 스프라이트 + PixelLab character_id 4개(리포 밖 `characters.json`에 기록)

- [ ] **Step 1: 톤 시안 3안을 뽑는다**

리포 밖 작업 폴더에서 `create-image-pixen`으로 64×64 전신을 생성한다. 머리 크기 비율·외곽선·그림자만 다르게 해 3안을 만든다.

```
A: 머리 1/3 비율, 단색 검정 외곽선, 발밑 타원 그림자
B: 머리 1/4 비율(사실적), 단색 검정 외곽선, 그림자 없음
C: 머리 1/3 비율, 외곽선 없음(실루엣 대비), 발밑 타원 그림자
```

- [ ] **Step 2: 시안을 8배 확대해 나란히 보여 주고 톤을 고른다**

세 안을 가로로 붙여 PNG로 저장하고 사용자에게 보여 준다. 고른 톤이 4명 전부의 기준이 된다.

- [ ] **Step 3: 고른 톤으로 면접관 4명 전신을 만든다**

각 면접관의 `interviewers64/{id}/center_idle.png` 0번 프레임에서 얼굴·머리·옷 색을 읽어 설명문에 넣고, 같은 톤 지시로 4명을 생성한다. 옷은 책상 샷과 같아야 한다(m1 회색 재킷·하늘색 셔츠, f3 네이비 정장·포니테일, m2 짙은 정장·흰머리·안경, f2 검정 정장·단발·안경).

- [ ] **Step 4: 4명을 PixelLab 캐릭터로 등록한다**

`create-character-v3`에 전신을 레퍼런스로 주고 `image_size: {width: 64, height: 64}`로 등록한다. 등록본(south)이 원본과 같은지 눈으로 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/public/sprites/commute
git commit -m "feat(frontend): 출근 장면 면접관 4명 64x64 전신 기본 스프라이트"
```

---

### Task 6: 동작 7종 × 4명

**Files:**
- Create: `frontend/public/sprites/commute/{m1,f3,m2,f2}/{idle_home,yawn,dress,bag,walk,walk_watch,arrive}.png`
- Create: `frontend/public/sprites/commute/{m1,f3,m2,f2}/manifest.json`

**Interfaces:**
- Consumes: Task 5의 character_id 4개, Task 4의 `check.py`
- Produces: 면접관별 시트 7장 + `manifest.json`. 키 이름은 Task 1의 `COMMUTE[].loop`·`once`·`idles`와 같다 — `idle_home` · `yawn` · `dress` · `bag` · `walk` · `walk_watch` · `arrive`

- [ ] **Step 1: 동작별 프레임 수와 지시문을 정한다**

| 키 | 프레임 | 종류 | 지시문 요지 |
|---|---|---|---|
| `idle_home` | 16 | 루프 | 집 안에서 가만히 서 있고 숨 쉰다. 발은 고정 |
| `yawn` | 12 | 1회 | 하품하고 기지개를 켠 뒤 원래 자세로 |
| `dress` | 16 | 1회 | 양복 재킷을 집어 입는다 |
| `bag` | 12 | 1회 | 가방을 집어 어깨에 멘다 |
| `walk` | 12 | 루프 | 옆모습으로 걷는다. 제자리걸음(배경이 흐른다) |
| `walk_watch` | 12 | 1회 | 걸으며 손목시계를 보고 다시 앞을 본다 |
| `arrive` | 16 | 1회 | 걸음을 멈추고 의자에 앉는다 |

모든 지시문에 다음을 넣는다: `STATIC CAMERA: the composition is identical in every frame, the character does not drift sideways`. 1회성 동작은 `ends in the same pose as the first frame`.

- [ ] **Step 2: `animate-character` pixminimax로 생성한다**

동시 작업 8개 제한이 있으므로 7개씩 큐에 넣고 받는다. 각 클립의 0번 프레임(입력 원본)은 톤이 달라 제외한다. 생성한 모든 판은 리포 밖 `versions/`에 `index.json`(동작·프레임 수·seed·지시문)과 함께 보관한다.

- [ ] **Step 3: 시트로 묶고 manifest를 쓴다**

```json
{
 "idle_home": { "file": "idle_home.png", "frames": 16, "w": 64, "h": 64 },
 "yawn": { "file": "yawn.png", "frames": 12, "w": 64, "h": 64 },
 "dress": { "file": "dress.png", "frames": 16, "w": 64, "h": 64 },
 "bag": { "file": "bag.png", "frames": 12, "w": 64, "h": 64 },
 "walk": { "file": "walk.png", "frames": 12, "w": 64, "h": 64 },
 "walk_watch": { "file": "walk_watch.png", "frames": 12, "w": 64, "h": 64 },
 "arrive": { "file": "arrive.png", "frames": 16, "w": 64, "h": 64 }
}
```

- [ ] **Step 4: 품질 검사를 통과시킨다**

Run: `cd frontend/scripts/sprites && for w in m1 f3 m2 f2; do python check.py ../../public/sprites/commute/$w || exit 1; done`
Expected: 네 폴더 모두 "전부 통과". 걸리면 수치를 보고 seed를 바꿔 재생성하거나 후처리한다. 통과 전에는 커밋하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/public/sprites/commute
git commit -m "feat(frontend): 출근 장면 동작 7종 x 면접관 4명"
```

---

### Task 7: 배경과 소품

**Files:**
- Create: `frontend/public/sprites/commute/backgrounds/{bedroom,washroom,closet,entrance,alley,street}.png`
- Create: `frontend/public/sprites/commute/props/{cat,lamp,vending,planter,pigeon,signal}.png`
- Create: `frontend/public/sprites/commute/backgrounds/manifest.json`
- Create: `frontend/public/sprites/commute/props/manifest.json`

**Interfaces:**
- Consumes: 없음
- Produces: 배경 6장(키는 Task 1의 `COMMUTE[].bg` — `bedroom`·`washroom`·`closet`·`entrance`·`alley`·`street`), 소품 6장(키는 Task 3의 `PROP_KEYS`)

- [ ] **Step 1: 배경을 만든다**

실내 3장(`bedroom`·`washroom`·`closet`)과 현관(`entrance`)은 **480×120 정지 배경**이다. `entrance`는 문을 나서는 순간이라 한 번만 지나가고 곧 `alley`로 넘어간다. 실외 2장(`alley`·`street`)은 **좌우로 이어 붙여도 이음새가 없어야** 한다(스크롤). `create-image-pixen`으로 만들고, 실외는 왼쪽 끝 열과 오른쪽 끝 열이 맞는지 픽셀로 확인한다.

Run(이음새 확인):
```python
from PIL import Image
im = Image.open('alley.png').convert('RGBA'); px = im.load()
diff = sum(1 for y in range(im.height) if px[0, y] != px[im.width - 1, y])
print('이음새 불일치 행', diff)   # 0이어야 한다
```

- [ ] **Step 2: 소품을 만든다**

`cat`·`lamp`·`vending`·`planter`·`pigeon`·`signal`. 바닥에 놓이므로 아래쪽이 기준선에 맞아야 한다. 크기는 자유지만 높이 64px을 넘지 않는다.

- [ ] **Step 3: manifest를 쓴다**

```json
// backgrounds/manifest.json
{
 "bedroom": { "file": "bedroom.png", "w": 480, "h": 120 },
 "washroom": { "file": "washroom.png", "w": 480, "h": 120 },
 "closet": { "file": "closet.png", "w": 480, "h": 120 },
 "entrance": { "file": "entrance.png", "w": 480, "h": 120 },
 "alley": { "file": "alley.png", "w": 480, "h": 120 },
 "street": { "file": "street.png", "w": 480, "h": 120 }
}
```

```json
// props/manifest.json
{
 "cat": { "file": "cat.png", "w": 24, "h": 16 },
 "lamp": { "file": "lamp.png", "w": 16, "h": 56 },
 "vending": { "file": "vending.png", "w": 32, "h": 48 },
 "planter": { "file": "planter.png", "w": 28, "h": 20 },
 "pigeon": { "file": "pigeon.png", "w": 16, "h": 12 },
 "signal": { "file": "signal.png", "w": 16, "h": 60 }
}
```

실제 생성물의 크기에 맞춰 값을 채운다.

- [ ] **Step 4: 커밋**

```bash
git add frontend/public/sprites/commute/backgrounds frontend/public/sprites/commute/props
git commit -m "feat(frontend): 출근 장면 배경 5종·소품 6종"
```

---

### Task 8: 시트 로드와 대체

**Files:**
- Create: `frontend/src/utils/commuteAssets.ts`
- Test: `frontend/src/utils/commuteAssets.test.ts`

**Interfaces:**
- Consumes: Task 1의 `COMMUTE`
- Produces: `COMMUTE_IDS: readonly string[]`, `resolveInterviewer(id: string | null | undefined): string`, `sheetPath(interviewer: string, key: string): string`, `type SheetSet = Record<string, { file: string; frames: number; w: number; h: number }>`, `isComplete(set: SheetSet | null): boolean`, `REQUIRED_KEYS: readonly string[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// frontend/src/utils/commuteAssets.test.ts
import { describe, expect, it } from 'vitest'
import {
  COMMUTE_IDS,
  REQUIRED_KEYS,
  isComplete,
  resolveInterviewer,
  sheetPath,
} from './commuteAssets'

describe('에셋 해석', () => {
  it('아는 면접관은 그대로 쓴다', () => {
    expect(resolveInterviewer('m2')).toBe('m2')
  })
  it('아직 안 골랐으면 기본 면접관으로 떨어진다', () => {
    expect(resolveInterviewer(null)).toBe('f3')
    expect(resolveInterviewer(undefined)).toBe('f3')
  })
  it('모르는 값(옛 localStorage)도 기본 면접관으로 떨어진다', () => {
    expect(resolveInterviewer('gentle')).toBe('f3')
    expect(resolveInterviewer('')).toBe('f3')
  })
  it('경로는 면접관 폴더 아래다', () => {
    expect(sheetPath('m1', 'walk')).toBe('/sprites/commute/m1/walk.png')
  })
  it('필요한 동작이 하나라도 빠지면 그 세트는 쓰지 않는다', () => {
    const full = Object.fromEntries(
      REQUIRED_KEYS.map((k) => [k, { file: `${k}.png`, frames: 12, w: 64, h: 64 }]),
    )
    expect(isComplete(full)).toBe(true)
    const missing = { ...full }
    delete missing.walk
    expect(isComplete(missing)).toBe(false)
    expect(isComplete(null)).toBe(false)
  })
  it('면접관 4명이 전부 정의돼 있다', () => {
    expect(COMMUTE_IDS).toEqual(['m1', 'f3', 'm2', 'f2'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteAssets.test.ts`
Expected: FAIL — `Failed to resolve import "./commuteAssets"`

- [ ] **Step 3: 최소 구현**

```ts
// frontend/src/utils/commuteAssets.ts
/** 출근 장면 에셋 경로와 대체 규칙. 브라우저 API를 쓰지 않는 순수 모듈 */

export const COMMUTE_IDS: readonly string[] = ['m1', 'f3', 'm2', 'f2']
/** 아직 고르지 않았거나 모르는 값일 때 쓸 면접관 */
const DEFAULT_ID = 'f3'

/** 한 면접관을 그리는 데 반드시 있어야 하는 동작. 하나라도 빠지면 그 면접관은 통째로 대체한다 */
export const REQUIRED_KEYS: readonly string[] = [
  'idle_home',
  'yawn',
  'dress',
  'bag',
  'walk',
  'walk_watch',
  'arrive',
]

export type SheetSet = Record<string, { file: string; frames: number; w: number; h: number }>

export function resolveInterviewer(id: string | null | undefined): string {
  return id && COMMUTE_IDS.includes(id) ? id : DEFAULT_ID
}

export function sheetPath(interviewer: string, key: string): string {
  return `/sprites/commute/${interviewer}/${key}.png`
}

/** 동작마다 다른 캐릭터가 섞이지 않게, 세트는 전부 있거나 전부 없거나다 */
export function isComplete(set: SheetSet | null): boolean {
  if (!set) return false
  return REQUIRED_KEYS.every((k) => !!set[k])
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteAssets.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/utils/commuteAssets.ts frontend/src/utils/commuteAssets.test.ts
git commit -m "feat(frontend): 출근 장면 에셋 경로와 대체 규칙"
```

---

### Task 9: PixelProgress 개편

**Files:**
- Modify: `frontend/src/components/ui/PixelProgress.vue`
- Modify: `frontend/src/components/ui/PixelProgress.test.ts`
- Modify: `frontend/src/views/PrepareView.vue`

**Interfaces:**
- Consumes: Task 1~3의 `COMMUTE`·`advanceStages`·`stageAt`·`captionAt`·`nextIdleAt`·`pickIdle`·`stepProps`·`spawnProp`, Task 8의 `resolveInterviewer`·`sheetPath`·`isComplete`
- Produces: `PixelProgress`에 `interviewer?: string` prop 추가 (기본값 `''`)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
// PixelProgress.test.ts 끝에 추가
describe('출근 장면', () => {
  it('구간 문구가 새 구간을 따른다', () => {
    const w = mount(PixelProgress, {
      props: { ...base, progress: 50, phase: 'download', interviewer: 'm1' },
    })
    expect(w.text()).toContain('가방도 챙겼습니다')
  })
  it('캔버스가 480x120이다', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 10, phase: 'download' } })
    const c = w.find('canvas').element as HTMLCanvasElement
    expect([c.width, c.height]).toEqual([480, 120])
  })
  it('면접관을 안 넘겨도 그려진다', () => {
    const w = mount(PixelProgress, { props: { ...base, progress: 10, phase: 'download' } })
    expect(w.find('canvas').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && pnpm vitest run src/components/ui/PixelProgress.test.ts`
Expected: FAIL — 문구가 옛 구간("가방도 챙겼습니다"는 70%)이고 캔버스가 320×64

- [ ] **Step 3: 컴포넌트를 고친다**

`W`/`H`를 480/120으로, `CHAR_X`를 90으로 올린다. prop에 `interviewer?: string`을 추가하고 기본값 `''`을 둔다.

`loadSheets()`는 세 가지를 읽는다 — 고른 면접관의 `manifest.json`, `backgrounds/manifest.json`, `props/manifest.json`. 면접관 세트가 `isComplete`를 통과하지 못하면 `legacy = true`로 두고 기존 `/sprites/manifest.json`을 읽어 예전 장면으로 그린다.

`frame()`은 이렇게 바뀐다.

```ts
// 1) 진행 속도와 구간
samples.push({ t: now, p: props.progress })
while (samples.length && now - samples[0].t > RATE_WINDOW_MS) samples.shift()
const rate = progressRate(samples, now)
state = advanceStages(state, props.progress)
const stage = COMMUTE[state.stage]

// 2) 배경 — 실내는 고정, 실외만 흐른다
const moving = stage.kind === 'outdoor' && (rate > 0 || state.queue.length > 0)
if (moving) scroll += SCROLL * dt

// 3) 잔동작 — 시간으로만 돈다. 전환 중에는 끼어들지 않는다
if (!once && now >= idleAt) {
  const pick = pickIdle(stage, Math.random)
  if (pick) once = { name: pick, start: now }
  idleAt = nextIdleAt(now, Math.random)
}

// 4) 소품 — 실외에서만
if (stage.kind === 'outdoor') {
  scenic = stepProps(scenic, moving ? dt : 0, SCROLL, W)
  if (now >= propAt) {
    scenic.push(spawnProp(W, Math.random))
    const [a, b] = PROP_GAP
    propAt = now + a + Math.random() * (b - a)
  }
} else {
  scenic = []
}
```

그리는 순서는 배경 → 소품 → 캐릭터다. 배경은 실외일 때 `scroll % W`만큼 두 장을 이어 그린다.

`setScene(p)`은 진행률이 뒤로 갈 때만 부른다(기존과 같다). 호출되면 `state`·`scroll`·`scenic`·`idleAt`을 모두 초기화한다.

`utils/progressStages.ts`의 `stepScene`·`STAGES`는 **지우지 않는다.** 에셋이 없는 면접관을 기존 32×32 장면으로 그리는 대체 경로가 그대로 쓴다. 새 장면은 `commuteScene.ts`, 옛 장면은 `progressStages.ts`가 맡는다.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && pnpm vitest run src/components/ui/PixelProgress.test.ts`
Expected: PASS

- [ ] **Step 5: PrepareView에서 면접관을 넘긴다**

```vue
<PixelProgress
  :progress="model.overallProgress"
  :interviewer="interviewerId"
  ...
/>
```

`interviewerId`는 `src/interviewers/` 스토어가 main에 들어온 뒤 연결한다. 그 전에는 `''`로 두면 기본 면접관으로 그려진다.

- [ ] **Step 6: 전체 게이트**

Run: `cd frontend && pnpm test && pnpm lint && pnpm exec prettier --check . && pnpm exec vue-tsc --noEmit && pnpm build`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/components/ui/PixelProgress.vue frontend/src/components/ui/PixelProgress.test.ts frontend/src/views/PrepareView.vue
git commit -m "feat(frontend): 준비 화면을 새 출근 장면으로 교체 (480x120, 구간 8개, 고른 면접관)"
```

---

### Task 10: 속도별 통합 확인

**Files:**
- Modify: `frontend/src/utils/commuteScene.test.ts`
- Modify: `docs/demo-checklist.md`

**Interfaces:**
- Consumes: Task 1~3의 전체 API
- Produces: 없음(검증만)

- [ ] **Step 1: 속도별 통합 테스트를 쓴다**

```ts
// commuteScene.test.ts 끝에 추가
describe('속도가 달라도 구간을 빠짐없이 지난다', () => {
  /** 진행률을 fps로 흘려보내고 지나간 전환을 모은다 */
  function run(totalSecs: number, fps = 10) {
    let state: StageState = { stage: 0, queue: [] }
    const seen: string[] = []
    const frames = totalSecs * fps
    for (let i = 0; i <= frames; i++) {
      state = advanceStages(state, (i / frames) * 100)
      while (state.queue.length) seen.push(state.queue.shift() as string)
    }
    return { stage: state.stage, seen }
  }
  it('5분', () => {
    const r = run(300)
    expect(r.stage).toBe(COMMUTE.length - 1)
    expect(r.seen).toEqual(['dress', 'bag', 'arrive'])
  })
  it('15분', () => {
    const r = run(900)
    expect(r.stage).toBe(COMMUTE.length - 1)
    expect(r.seen).toEqual(['dress', 'bag', 'arrive'])
  })
  it('진행률이 한 번에 0에서 100으로 뛰어도 전환이 빠지지 않는다', () => {
    let s: StageState = { stage: 0, queue: [] }
    s = advanceStages(s, 100)
    expect(s.queue).toEqual(['dress', 'bag', 'arrive'])
  })
})
```

- [ ] **Step 2: 통과를 확인한다**

Run: `cd frontend && pnpm vitest run src/utils/commuteScene.test.ts`
Expected: PASS

- [ ] **Step 3: 데모 체크리스트에 수동 시나리오를 추가한다**

`docs/demo-checklist.md`에 넣는다.

```markdown
## 준비 화면 출근 장면

- [ ] 면접관을 고르고 준비 화면에 들어가면 **고른 면접관**이 출근한다
- [ ] 0~45%는 실내(배경 고정), 45%에서 문을 나서고 그 뒤로 배경이 흐른다
- [ ] 30%에서 양복, 45%에서 가방, 100%에서 착석 — 셋 다 건너뛰지 않는다
- [ ] 다운로드가 멈춘 동안(초기화)에도 캐릭터는 하품·시계 보기를 한다
- [ ] 탭을 다른 데 두었다 돌아와도 소품이 순간이동하지 않는다
- [ ] 면접관을 고르지 않고 들어가도 기본 면접관으로 그려진다
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/utils/commuteScene.test.ts docs/demo-checklist.md
git commit -m "test(frontend): 출근 장면 속도별 통합 + 데모 체크리스트"
```
