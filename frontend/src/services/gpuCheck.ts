export interface EnvCheck {
  webgpu: boolean
  /** WebGPU 실패 원인: 'no-api' = 브라우저에 navigator.gpu 없음, 'no-adapter' = 있으나 어댑터 없음(그래픽 가속 꺼짐·GPU 차단 등) */
  webgpuReason: 'no-api' | 'no-adapter' | null
  gpuName: string | null
  storageFree: number | null
}

/** 랜딩 "장비 확인" 창의 재료. 실패는 전부 "없음/알 수 없음"으로 흡수한다 — 여기서 던지면 안 된다. */
export async function checkEnvironment(): Promise<EnvCheck> {
  let webgpu = false
  let webgpuReason: EnvCheck['webgpuReason'] = 'no-api'
  let gpuName: string | null = null
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
  if (gpu) {
    webgpuReason = 'no-adapter'
    const adapter = await gpu.requestAdapter().catch(() => null)
    if (adapter) {
      webgpu = true
      webgpuReason = null
      const info = (adapter as GPUAdapter & { info?: Partial<GPUAdapterInfo> }).info
      gpuName = info?.description || info?.vendor || null
    }
  }
  let storageFree: number | null = null
  const storage = (navigator as Navigator & { storage?: StorageManager }).storage
  if (storage?.estimate) {
    const est = await storage.estimate().catch(() => null)
    if (est && est.quota != null) storageFree = est.quota - (est.usage ?? 0)
  }
  return { webgpu, webgpuReason, gpuName, storageFree }
}
