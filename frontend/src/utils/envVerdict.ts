export type Verdict = 'ok' | 'no-webgpu' | 'no-space'

/**
 * 휴대폰·태블릿인가. **기기 종류를 묻지 않고 "못 돌리는 손 기기"인지만 본다** —
 * userAgent는 위장되고, 모바일 브라우저가 WebGPU를 지원하게 되면 그날로 이 판정이 저절로 풀린다.
 * 터치를 함께 보는 이유: 그래픽 가속을 끈 데스크톱도 WebGPU가 없는데, 그쪽은 켜면 되는 문제다.
 */
export function isHandheld(env: { webgpu: boolean; touch: boolean }): boolean {
  return !env.webgpu && env.touch
}

/**
 * 이 기기로 면접을 볼 수 있는가.
 *
 * `needsWebgpu`가 false면 WebGPU를 보지 않는다 — **벤(프리미엄)은 서버가 추론하므로**
 * 이 기기의 그래픽 성능과 무관하다. 없는 조건으로 막으면 돌아갈 사람까지 돌려보낸다.
 */
export function verdict(
  env: { webgpu: boolean; storageFree: number | null },
  needBytes: number,
  needsWebgpu = true,
): Verdict {
  if (needsWebgpu && !env.webgpu) return 'no-webgpu'
  if (env.storageFree !== null && env.storageFree < needBytes) return 'no-space'
  return 'ok'
}
