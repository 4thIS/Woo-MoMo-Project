// node_modules/@litert-lm/core/wasm → public/litert-wasm (같은 오리진 서빙, CDN 금지)
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/@litert-lm/core/wasm')
const dst = resolve(root, 'public/litert-wasm')
if (!existsSync(src)) {
  console.error('copy-litert-wasm: source not found:', src)
  process.exit(1)
}
rmSync(dst, { recursive: true, force: true })
mkdirSync(dst, { recursive: true })
cpSync(src, dst, { recursive: true })
console.log('copy-litert-wasm: copied to', dst)
