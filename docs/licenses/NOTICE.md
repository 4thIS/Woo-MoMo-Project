# 서드파티 고지

## Supertonic 3 (면접관 음성)
- 저작권: Supertone Inc. — https://huggingface.co/Supertone/supertonic-3
- 모델 라이선스: BigScience Open RAIL-M (`SUPERTONIC-OpenRAIL-M.txt`). 사용 제한(Attachment A)을 준수한다. 이 사이트는 모의면접 질문 읽기 용도로만 합성하며, 생성 음성임을 화면 문구로 밝힌다.
- 예제 코드(`web/helper.js`) 라이선스: MIT — https://github.com/supertone-inc/supertonic
- 배포 방식(2026-09-18 갱신): 사용자 브라우저가 Hugging Face 원본 저장소(`Supertone/supertonic-3`, 커밋 고정)에서 직접 받는다. 우리 서버는 모델 파일을 재배포하지 않는다. 원본 저장소에 라이선스가 함께 있고, 이 리포에도 사본(`SUPERTONIC-OpenRAIL-M.txt`)을 둔다.
  - 파이 자체 서빙으로 복귀하면(`docs/specs/backend/2026-09-17-model-hosting-hf-design.md` 7절) 재배포가 되므로, 그때는 라이선스 사본을 함께 서빙하거나 화면에서 링크한다.
- 화면 고지: 생성 음성 안내 문구는 프론트 이슈 #34에서 구현한다(2026-09-18 기준 미구현).

## Gemma 4 (면접관 LLM)
- Google, Gemma Terms of Use — https://ai.google.dev/gemma/terms
- 파일: https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm, gemma-4-E2B-it-litert-lm (저장소 라이선스 표기 Apache-2.0). 브라우저가 HF에서 직접 받는다(커밋 고정).
