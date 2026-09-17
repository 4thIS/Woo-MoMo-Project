# 모델·TTS 다운로드를 Hugging Face로 전환 (+ 파이 자체 서빙 복귀 절차) — 설계 (spec)

- 생성일시: 2026-09-17
- 수정일시: 2026-09-17

## 0. 배경 · 위치

전체 설계서 5.4절은 모델 파일을 파이 볼륨(`/srv/momo/models`)에 두고 nginx `/models/`로 서빙하도록 정했다.
이렇게 한 이유는 **나중에 파인튜닝한 모델을 배포하려면 우리 서버에서 내려받게 해야 하기 때문**이다.
Hugging Face 원본에는 파인튜닝 모델이 없다.

그런데 파이의 회선(업링크)과 Cloudflare Tunnel이 병목이다. 사이트 접속은 문제없지만 Gemma(약 3GB)와
Supertonic TTS(약 398MB) 다운로드가 오래 걸린다. 파인튜닝은 "나중에" 하기로 했으므로(2026-09-17 결정),
**지금은 원본 모델을 Hugging Face에서 직접 받게 한다.** 파인튜닝 모델이 생기면 아래 7절 절차로 파이 서빙에 돌아간다.

### 측정 (2026-09-17, 같은 PC에서 200MB 구간)

| 받는 곳 | 속도 |
|---|---|
| 파이 (`https://momo.ssenu.cloud/models/...`) | 약 11MB/s |
| Hugging Face (`huggingface.co/.../resolve/...`) | 약 27MB/s |
| Google Drive (참고, 공개 테스트 파일) | 약 28MB/s |

Google Drive는 기각했다. 공개 파일에 다운로드 한도가 있어 24시간 막힐 수 있고, 대용량 파일은 비공식 주소(`drive.usercontent.google.com` + `confirm=t`)로만 받을 수 있다.
파일마다 ID가 달라 `tts.baseUrl + path` 구조와도 맞지 않는다. Hugging Face는 원래 모델을 받아 오던 원본이라 새로 올릴 파일이 없다.

## 1. 목표 · 비목표

### 목표
- 매니페스트의 `url`·`fallback.url`·`tts.baseUrl`을 Hugging Face 주소로 바꿔 브라우저가 HF에서 직접 받는다.
- **파이 자체 서빙으로 되돌리는 일이 `backend/data/manifest.json` 수정만으로 끝나게** 한다(스키마·테스트·프론트 수정 불필요).

### 비목표
- 파인튜닝 모델 배포(후속, 7절 절차 사용)
- 프론트의 옛 캐시 정리(주소가 바뀌어 기존 캐시가 남음 → 프론트 후속 이슈)
- nginx `/models/` 규칙·파이 볼륨 제거(복귀용으로 **그대로 둔다**)

## 2. 데이터 · 계약

- `/api/manifest` 응답 **형태는 불변**(필드 추가·삭제 없음). 값과 검증 규칙만 바뀐다.
- 스키마 검증: `url`·`tts.baseUrl`은 `/models/` **또는** `https://huggingface.co/`로 시작해야 한다(`ALLOWED_URL_PREFIXES`). `tts.baseUrl`은 계속 `/`로 끝나야 한다.
- 매니페스트 값 (커밋 해시 고정):

| 항목 | 주소 |
|---|---|
| `url` (E4B) | `https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it-web.litertlm` |
| `fallback.url` (E2B) | `https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1/gemma-4-E2B-it-web.litertlm` |
| `tts.baseUrl` | `https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323/` |

`id`·`size`·`files[]`는 그대로다(HF 파일 크기가 기존 매니페스트 값과 일치함을 확인).

## 3. 접근 제어 / 제약

- **허용 목록만.** 임의 외부 주소는 거부한다. `http://huggingface.co/`, `https://huggingface.co.evil.example/`, `//huggingface.co/`는 테스트로 막았다.
- **커밋 해시 고정.** HF 주소는 `resolve/main/`이 아니라 `resolve/<40자리 커밋>/`을 쓴다. 원본 저장소가 바뀌어도 매니페스트 `size` 대조가 깨지지 않게 하려는 것이다. `test_repo_manifest_pins_hugging_face_revisions`가 강제한다(`/models/` 항목은 검사하지 않음).
- **라이선스·접근.** 세 저장소 모두 비gated(로그인 불필요)다. Gemma 4 web은 Apache-2.0, Supertonic 3는 OpenRAIL-M(고지: `docs/licenses/`).
- **개인정보.** 사용자 브라우저가 HF로 요청을 보내므로 HF는 IP를 볼 수 있다. 이력서·대화·리포트는 여전히 서버 어디로도 가지 않는다(프로젝트 핵심 가치 유지).
- **ORT·LiteRT WASM 런타임은 계속 같은 오리진**(`/ort-wasm/`, `/litert-wasm/`)에서 서빙한다. 이번 변경과 무관하다.

## 4. 인터페이스 계약

| 메서드·경로 / 함수 | 접근 | 설명 |
|---|---|---|
| `GET /api/manifest` | public | 형태 불변. `url`·`tts.baseUrl` 값이 HF 주소 |
| `app.schemas.ALLOWED_URL_PREFIXES` | internal | `("/models/", "https://huggingface.co/")` |
| `app.schemas._validate_model_url` | internal | `ModelRef.url`과 `TtsManifest.baseUrl` 공용 검증 |

## 5. 영역별 영향

- **backend:** 스키마 허용 목록 추가, 매니페스트 값 변경, 테스트
- **frontend:** 코드 변경 없음. 다운로드는 `fetch(url)`로, TTS는 `baseUrl + path`로 주소를 그대로 쓴다. 캐시 키 `/models-cache/{id}{url}`에 절대 주소가 들어가도 유효한 Request URL이다. 주소가 바뀌어 기존 사용자는 한 번 다시 받는다(옛 항목은 캐시에 남음 → 후속 이슈).
- **deploy:** 변경 없음. `/models/` 규칙과 파이 볼륨의 파일은 복귀용으로 유지한다.

### 브라우저 검증 (2026-09-17, Chrome, 오리진 `https://momo.ssenu.cloud`)

프론트 `downloadModel`과 같은 방식(`fetch` → `Content-Length` 대조 → 스트림 수신)으로 확인했다.

| 파일 | 결과 |
|---|---|
| E4B·E2B `.litertlm` | 200, `Content-Length` = 매니페스트 size (앞 20MB 수신 확인) |
| `text_encoder`·`duration_predictor` `.onnx` | 200, 전체 수신 바이트 = size |
| `vector_estimator`·`vocoder` `.onnx` | 200, `Content-Length` = size (앞 20MB 수신 확인) |
| `tts.json`·`unicode_indexer.json`·`M2.json` | 200, 전체 수신 바이트 = size (HF가 brotli·chunked로 보내 `Content-Length`가 없으면 프론트는 매니페스트 size로 대조한다 — 통과) |

리다이렉트: `huggingface.co` 302/307 → `us.aws.cdn.hf.co` 또는 `/api/resolve-cache`. 두 단계 모두 `Access-Control-Allow-Origin`이 있다.

## 6. 무회귀 · 롤아웃

1. 이 PR 머지 → 파이에서 api만 재빌드(`docker compose build api && docker compose up -d api`). web·nginx는 재배포하지 않는다.
2. 확인: `curl -s https://momo.ssenu.cloud/api/manifest | grep -o 'https://huggingface.co[^"]*'` → 주소 3개.
3. 브라우저 강력 새로고침 → 준비 화면에서 모델·목소리 다운로드가 끝나고 면접이 시작되는지 본다.
4. **HF 장애 시 즉시 롤백:** 7절 A를 그대로 하면 된다(파이 파일은 이미 있음).

## 7. 파이 자체 서빙으로 복귀하는 절차

복귀가 필요한 경우:
- **파인튜닝 모델 배포**(원래 목적)
- HF 장애·차단·속도 저하
- 원본 저장소 삭제·gated 전환

스키마가 두 방식을 모두 허용하므로 **`backend/data/manifest.json`만 고치면 된다.** 항목별로 섞어도 된다(예: Gemma는 파이, TTS는 HF).

### A. 원본 모델을 다시 파이에서 서빙 (롤백)

파이에는 파일이 이미 있다(2026-09-17 기준, 지우지 말 것).
```
/srv/momo/models/gemma4-e4b-it-web.litertlm          2,969,059,328
/srv/momo/models/gemma4-e2b-it-web.litertlm          2,008,432,640
/srv/momo/models/tts/supertonic-3/onnx/*, voice_styles/M2.json
```
1. `backend/data/manifest.json`을 전환 전 값으로 되돌린다. `git show 50a1eaa:backend/data/manifest.json`이 그 원본이다.
   - `"url": "/models/gemma4-e4b-it-web.litertlm"`
   - `"fallback": { ..., "url": "/models/gemma4-e2b-it-web.litertlm" }`
   - `"tts": { ..., "baseUrl": "/models/tts/supertonic-3/" }`
2. `cd backend && uv run pytest -q` → 통과해야 한다(테스트 수정 불필요, 전환 작업 중 시뮬레이션으로 확인함).
3. PR → 머지 → 파이에서 api만 재빌드.
4. 확인: `curl -I -H "Range: bytes=0-1023" https://momo.ssenu.cloud/models/gemma4-e4b-it-web.litertlm` → 206.

### B. 파인튜닝 모델을 파이에서 서빙

1. **변환:** Colab에서 파인튜닝 → 웹용 `.litertlm`으로 변환(`finetune/`). 파일명 예: `momo-e4b-ft-v1-web.litertlm`.
2. **배치:** 파이 `/srv/momo/models/`에 복사하고 크기를 기록한다.
   ```
   scp momo-e4b-ft-v1-web.litertlm admin@webPi:/srv/momo/models/
   ssh admin@webPi "stat -c %s /srv/momo/models/momo-e4b-ft-v1-web.litertlm"
   ```
3. **매니페스트 수정:**
   - `id`: 새 값(예: `momo-e4b-ft-v1`). **반드시 바꾼다.** 캐시 키에 `id`가 들어가므로 옛 모델 캐시와 섞이지 않는다.
   - `url`: `/models/momo-e4b-ft-v1-web.litertlm`
   - `size`: 2단계에서 잰 바이트
   - `template`·`systemPromptOverride`: 파인튜닝 결과에 맞게(짧은 프롬프트로 대체 가능)
   - `fallback`: 원본 E2B를 HF에 둘지 파이로 돌릴지 선택(둘 다 허용)
   - `tts`: 그대로 HF에 둬도 된다
4. `uv run pytest -q` → PR(`feat(api)`, 프론트 담당과 사전 협의) → 머지 → 파이 api 재빌드.
5. 확인: 206 응답 + 브라우저에서 면접 1회 완주 + 리포트 JSON 파싱(계층 규율 기준).

**주의:** 파이로 돌아가면 다운로드 속도 문제도 돌아온다. 데모 노트북은 리허설 때 미리 받아 캐시해 두고, 당일 파이 회선 부하를 피한다(전체 설계서 5.4절).
대안으로 파인튜닝 모델을 **팀의 공개 HF 저장소**에 올리고 커밋 고정 주소를 넣는 방법도 있다(스키마상 허용). 이렇게 하면 파이 회선을 쓰지 않는다. 비공개 저장소는 브라우저가 인증 없이 받을 수 없어 쓸 수 없다.

### 다른 호스트(R2·GitHub Releases 등)를 추가하려면

`ALLOWED_URL_PREFIXES`에 접두사를 추가하고 테스트를 추가한다. 그 호스트는 `Access-Control-Allow-Origin`을 줘야 하고, 압축 없이 `Content-Length`를 주거나 매니페스트 size와 일치하는 바이트를 보내야 한다. 이 문서 5절의 브라우저 검증을 반복한다.

## 8. 역할 분담

| 영역 | 담당 |
|------|------|
| backend (스키마·매니페스트·이 문서) | @ssenu |
| frontend (옛 캐시 정리, 후속 이슈) | @leemonta9482 |
| docs 공동 (전체 설계서 5.4절) | @ssenu @leemonta9482 |

## 9. 성공 기준

- `/api/manifest`가 HF 주소 3개를 반환한다.
- 새 브라우저 프로필에서 준비 화면의 모델·목소리 다운로드가 파이 서빙 때보다 빨리 끝나고 면접이 시작된다.
- 매니페스트를 `50a1eaa` 값으로 되돌려도 백엔드 테스트가 통과한다(복귀 경로 보장).
