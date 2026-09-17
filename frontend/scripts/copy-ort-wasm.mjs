// node_modules/onnxruntime-web/dist 의 WebGPU(jsep) 글루만 public/ort-wasm 으로 (같은 오리진 서빙, CDN 금지)
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/onnxruntime-web/dist')
const dst = resolve(root, 'public/ort-wasm')
const files = ['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs']
for (const f of files) {
  if (!existsSync(resolve(src, f))) {
    console.error('copy-ort-wasm: source not found:', resolve(src, f))
    process.exit(1)
  }
}
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
for (const f of files) copyFileSync(resolve(src, f), resolve(dst, f))
console.log('copy-ort-wasm: copied', files.length, 'files to', dst)
