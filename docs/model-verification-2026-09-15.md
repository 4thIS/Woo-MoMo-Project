# Gemma 4 웹용 모델·템플릿 검증 결과 (2026-09-15)

설계서 섹션 10 "알려진 리스크"의 1순위 항목(모델 URL·템플릿 실체) 검증. 결론: **참고 코드의 템플릿과 모델 URL은 정확하다.** 코드 변경 없이 매니페스트 크기 값만 정정.

## 1. 모델 파일 (Hugging Face, litert-community)

| 모델 | 웹용 파일 | 크기 (bytes) |
|---|---|---|
| E2B | `gemma-4-E2B-it-litert-lm/gemma-4-E2B-it-web.litertlm` | 2,008,432,640 (약 2.0GB) |
| E4B | `gemma-4-E4B-it-litert-lm/gemma-4-E4B-it-web.litertlm` | 2,969,059,328 (약 3.0GB) |

- 설계서·매니페스트의 "E4B 약 4.4GB"는 오기. 실제 웹용은 약 3.0GB. `backend/data/manifest.json`과 `docs/API.md`를 실제 값으로 수정함.
- 같은 레포에 `-web.task`(MediaPipe용)와 `-web.litertlm`(LiteRT-LM용)이 둘 다 있음. 모델 카드: "Web on LiteRT-LM uses a specially optimized model for Web because of its unique memory constraints. Currently the model is text-only."
- 명목 컨텍스트 32K.

## 2. 채팅 템플릿 (공식 확인)

출처: HF 레포의 `chat_template.jinja`, Google "Gemma 4 Prompt Formatting" 문서.

```
<|turn>system
{시스템 프롬프트}<turn|>
<|turn>user
{사용자}<turn|>
<|turn>model
{응답}<turn|>
<|turn>model          ← 생성 프롬프트
```

- 역할명: `system`, `user`, `model` (assistant → model로 변환)
- system은 **별도 턴**으로 맨 앞에 둔다 (Gemma 3처럼 user에 합치지 않음)
- 사고 모드: 시스템 프롬프트에 `<|think|>`를 넣으면 활성화. 출력에 `<|channel>thought ... <channel|>`이 나올 수 있으므로 표시 전 제거. 기본은 비활성.
- BOS 토큰은 템플릿 앞에 붙음 (런타임이 처리)
- **매니페스트의 `template` 값(`<|turn>`, `<turn|>`, roles system/user/model)은 그대로 확정.**
- 주의: 웹 검색 요약 중 `<start_of_turn>` 형식이라고 나오는 것은 Gemma 3 이하 형식. Gemma 4는 다르다.

## 3. 브라우저 실측 (참고 코드 index.html, MediaPipe tasks-genai 0.10.29)

환경: Chrome, Intel 내장 GPU(xe-3lpg), WebGPU maxBufferSize 2GB, 스토리지 쿼터 10.7GB.

| 항목 | 결과 |
|---|---|
| E2B 다운로드 + GPU 로드 | 81초 (약 25MB/s 회선) |
| 한국어 면접 질문 1개 생성 | 0.7초, 첫 토큰 0.18초, 48자 |
| 멀티턴(답변 후 꼬리질문) | 1.5초, 앞 답변 내용을 정확히 반영 |
| 리포트 JSON 생성 지시 | 4.3초, 요구한 `[{question, answerSummary, feedback}]` 형식으로 출력 |
| Cache API 저장 | 재방문 시 "캐시됨 (다운로드 생략)" |

- 리포트 JSON은 ```` ```json ```` 코드 펜스로 감싸 나옴. **프론트 `reportParser`는 펜스를 벗기고 파싱해야 함.**
- E4B는 이 기기에서 미실측. 데모 노트북에서 별도 확인 필요 (파일 3.0GB, GPU 메모리 여유 필요).

## 4. 프론트 구현에 영향 주는 발견 (중요)

**MediaPipe LLM Inference API는 유지보수 모드다.** Google 공식 문서: "The MediaPipe LLM Inference API is in maintenance-only mode. We recommend migrating your Web projects to LiteRT-LM JavaScript API."

- 권장 대체: npm `@litert-lm/core` (LiteRT-LM JS API, WebGPU 전용, 조기 프리뷰)
- 공식 지원 모델이 정확히 `gemma-4-E2B-it-web.litertlm`, `gemma-4-E4B-it-web.litertlm`
- API 형태: `Engine.create({model: url})` → `engine.createConversation()` → `conversation.sendMessage()` / `sendMessageStreaming()` (ReadableStream) / `cancel()`. 시스템 프롬프트는 preface messages의 `role: 'system'`으로 전달. 옵션 `maxNumTokens`(컨텍스트), `maxOutputTokens`.
- 즉 LiteRT-LM JS를 쓰면 **채팅 템플릿을 직접 조립할 필요가 없고 스트리밍·중단이 내장**된다. 참고 코드(MediaPipe)는 검증에는 충분했지만 프론트 구현은 `@litert-lm/core`를 1순위로 검토할 것. 단 조기 프리뷰이므로 D-6 안에 안 붙으면 MediaPipe 0.10.29로 폴백(동작 확인됨).
- 매니페스트의 `template` 필드는 어느 런타임을 쓰든 유지(MediaPipe 폴백 시 필요).

## 5. 후속

- 데모 노트북에서 E4B 로드·응답 시간 실측 → 안 되면 매니페스트 `id/url/size`를 E2B로 교체(코드 변경 없음)
- 프론트 spec에 런타임 선택(LiteRT-LM JS 우선, MediaPipe 폴백)과 JSON 펜스 제거를 반영
