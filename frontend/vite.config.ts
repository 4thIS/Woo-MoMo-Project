import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      // 로컬 개발용 모델 파일: 예) C:\MyCode\models 에서 `python -m http.server 8765`
      '/models': { target: 'http://localhost:8765', rewrite: (p) => p.replace(/^\/models/, '') },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
})
