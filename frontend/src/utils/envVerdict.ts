export type Verdict = 'ok' | 'no-webgpu' | 'no-space'

export function verdict(
  env: { webgpu: boolean; storageFree: number | null },
  needBytes: number,
): Verdict {
  if (!env.webgpu) return 'no-webgpu'
  if (env.storageFree !== null && env.storageFree < needBytes) return 'no-space'
  return 'ok'
}
