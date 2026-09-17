import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/tokens.css'
import './styles/base.css'

createApp(App).use(createPinia()).mount('#app')

// 개발 콘솔에서 TTS 단독 확인용 (이슈 #12 완료 기준). 프로덕션 번들엔 들어가지 않는다
if (import.meta.env.DEV) {
  void Promise.all([
    import('./services/tts'),
    import('./services/audio'),
    import('./services/api'),
  ]).then(([tts, audio, api]) => {
    ;(window as unknown as Record<string, unknown>).__momoTts = {
      ...tts,
      ...audio,
      getManifest: api.getManifest,
    }
  })
}
