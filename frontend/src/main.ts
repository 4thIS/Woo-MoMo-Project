import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { setAccountApi } from './stores/account'
import { httpAccount } from './services/httpAccount'
import './styles/tokens.css'
import './styles/base.css'

/* 앱은 진짜 서버를 본다. 스토어의 기본값은 목업이라 테스트는 서버 없이 돈다 —
   바꾸는 자리를 여기 하나로 둔다 */
setAccountApi(httpAccount)

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
