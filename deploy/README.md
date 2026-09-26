# 배포 (라즈베리파이, docker-compose)

파이에는 리포를 **git clone**해서 올리고, 이미지는 파이에서 직접 빌드한다(GHCR 불필요).
프론트 빌드 산출물이 없어도 `web` 이미지는 플레이스홀더 페이지로 기동한다.

> **2026-09-17: 모델·TTS 다운로드는 Hugging Face로 전환됐다.** 매니페스트가 HF 주소를 가리키므로 브라우저는 파이에서 모델을 받지 않는다.
> 파이 볼륨 `/srv/momo/models`의 파일과 nginx `/models/` 규칙은 **복귀용으로 지우지 말고 유지**한다(HF 장애 롤백, 파인튜닝 모델 배포).
> 복귀 절차: `docs/specs/backend/2026-09-17-model-hosting-hf-design.md` 7절. 아래 모델 배치 절차는 복귀할 때 쓴다.

## 실제 파이 구성 (webPi, 2026-09-15 기준)

위의 일반 절차와 다른 점만 적는다. **이 절이 우선한다.**

| 항목 | 값 |
|---|---|
| 접속 | Tailscale SSH, `admin@webPi` (키 인증) |
| 클론 위치 | `/srv/apps/Woo-MoMo-Project` (모든 프로젝트가 `/srv/apps/` 아래) |
| 클론 주소 | `git@github.com:4thIS/Woo-MoMo-Project.git` (private 리포, 파이 SSH 키가 GitHub `ssenu`로 인증됨) |
| 호스트 포트 | **8006** (8000~8005는 다른 프로젝트가 사용) → `deploy/.env`에 `WEB_BIND=127.0.0.1:8006` |
| 모델 볼륨 | `/srv/momo/models` (admin 소유) |
| cloudflared | 호스트 프로세스, 터널 `web`, **로컬 관리** `~/.cloudflared/config-web.yml` |
| 도메인 | `momo.ssenu.cloud` → `http://localhost:8006` |

### 배포
```
ssh admin@webPi
cd /srv/apps/Woo-MoMo-Project && git pull
cd deploy
docker compose up -d --build
curl -s http://127.0.0.1:8006/api/health
curl -I -H "Range: bytes=0-1023" http://127.0.0.1:8006/models/gemma4-e4b-it-web.litertlm   # 206
```

### TTS 모델 파일 배치 (Supertonic 3, 약 398MB)
파이 서빙으로 복귀할 때 쓴다(현재 파일은 배치돼 있음). 매니페스트 `tts.baseUrl`을 `/models/tts/supertonic-3/`로 되돌리면, 그 경로·`files[].path`와 일치해야 한다.
```
mkdir -p /srv/momo/models/tts/supertonic-3/onnx /srv/momo/models/tts/supertonic-3/voice_styles
cd /srv/momo/models/tts/supertonic-3
B=https://huggingface.co/Supertone/supertonic-3/resolve/main
for f in onnx/text_encoder.onnx onnx/duration_predictor.onnx onnx/vector_estimator.onnx onnx/vocoder.onnx onnx/tts.json onnx/unicode_indexer.json voice_styles/F1.json voice_styles/F2.json voice_styles/F3.json voice_styles/F4.json voice_styles/F5.json voice_styles/M1.json voice_styles/M2.json voice_styles/M3.json voice_styles/M4.json voice_styles/M5.json; do
  curl -L -o "$f" "$B/$f"
done
ls -l onnx voice_styles
curl -I -H "Range: bytes=0-1023" http://127.0.0.1:8006/models/tts/supertonic-3/onnx/vocoder.onnx   # 206
```
크기는 매니페스트 값과 같아야 한다(프론트가 수신 바이트를 대조한다). nginx 변경 없음 — 기존 `/models/` 규칙이 하위 디렉터리를 그대로 서빙한다.

`tts.voices`(2026-09-26)가 있으면 목소리 10개(`voice_styles/F1~F5, M1~M5.json`)가 모두 있어야 한다. 지금 파이에는 M2만 있으므로, 복귀할 때 위 반복문으로 나머지 9개를 함께 받는다.

### 도메인 라우트 (대시보드 Public Hostname 사용 금지)
터널이 설정 파일로 로컬 관리되므로 Cloudflare 대시보드의 Public Hostname을 쓰면 원격 관리와 충돌한다.
라우트는 파이의 `cloudflare-gui-tool` "라우트 추가"로 넣는다(`config-web.yml` ingress + DNS CNAME을 함께 생성).
수동으로 넣을 때는 `~/.cloudflared/config-web.yml`의 ingress에서 **마지막 catch-all(`service: http_status:404`) 앞에** 추가한다.
```yaml
  - hostname: momo.ssenu.cloud
    service: http://localhost:8006
```
cloudflared는 설정 파일을 다시 읽지 않으므로 **재시작이 필요**하다(sudo).
```
cloudflared tunnel ingress validate --config ~/.cloudflared/config-web.yml   # 문법 검증 먼저
sudo systemctl restart cloudflared
curl -s https://momo.ssenu.cloud/api/health
curl -I -H "Range: bytes=0-1023" https://momo.ssenu.cloud/models/gemma4-e4b-it-web.litertlm   # 206
```

### 기타
- Cloudflare 존 설정(Rocket Loader·Auto Minify OFF)은 `ssenu.cloud` 존 전체에 적용된다. 다른 서브도메인 서비스에도 영향이 가지만 끄는 방향이라 해는 없다.
- GUI 앱의 `HOST_PORT` 자동 채움은 `WEB_BIND`가 주소:포트 한 변수라 동작하지 않는다. 실행/정지/상태/배포는 정상. 변수를 나누려면 compose 변경이라 공동 리뷰 후 별도 PR.
- 모델 파일은 `.done` 표시만 믿지 말고 크기를 확인한다: E4B 2,969,059,328 / E2B 2,008,432,640 bytes.

## 최초 1회 (일반 절차)
```
sudo mkdir -p /srv/momo/models
# 모델 파일을 /srv/momo/models/ 에 넣는다. 파일명은 backend/data/manifest.json 의 url 과 같아야 한다.
#   예: gemma4-e4b-it-web.litertlm, gemma4-e2b-it-web.litertlm (fallback)
git clone https://github.com/4thIS/Woo-MoMo-Project.git ~/Woo-MoMo-Project
cd ~/Woo-MoMo-Project/deploy
docker compose up -d --build
```
- `docker compose`는 반드시 `deploy/` 디렉터리에서 실행한다 (빌드 context가 `..`, `../backend` 상대 경로).
- 첫 빌드는 파이에서 수 분 걸린다 (python:3.12-slim + uv sync). 이후 갱신은 변경된 레이어만 다시 빌드한다.
- 기존 리버스 프록시가 `http://127.0.0.1:8080`을 upstream으로 보게 설정한다 (아래 "바인딩").

## 갱신 (main 머지 후)
```
cd ~/Woo-MoMo-Project
git pull
cd deploy
docker compose up -d --build
```
`--build`를 빼면 이전에 빌드한 이미지를 그대로 쓴다. `docker compose pull`은 GHCR에 이미지가 있을 때만 쓴다(아래 "GHCR 이미지 사용" 참고).

## 모델·질문 파일만 바꿀 때
- 모델 교체: `/srv/momo/models/`에 파일 추가 → `backend/data/manifest.json` 수정(PR) → `git pull` → `docker compose up -d --build` (api 이미지에 data/가 들어가므로 재빌드 필요, 수 초).
- 코드 변경 없이 매니페스트만 바꾸는 것이므로 프론트 재배포는 없다.

## 바인딩 (`WEB_BIND`)

`web` 컨테이너는 기본적으로 파이에 이미 떠 있는 리버스 프록시 뒤에 숨는다.
기본값은 `WEB_BIND=127.0.0.1:8080` — 컨테이너의 80 포트를 로컬호스트 8080에만 바인딩한다.
기존 리버스 프록시(도메인·TLS 종료)가 `http://127.0.0.1:8080`을 upstream으로 바라보게 설정하면 된다.

이 컨테이너 자체가 엣지(공인 IP에 직접 노출)라면 `deploy/.env`에 다음을 두고 배포한다.
```
WEB_BIND=0.0.0.0:80
```

## 도메인 연결 (Cloudflare Tunnel)

파이는 Tailscale SSH로 접속하고, 도메인은 Cloudflare Tunnel로 연결한다. TLS는 Cloudflare가 종료하므로 파이에 인증서는 필요 없다.
**HTTPS는 필수다.** WebGPU와 마이크(Web Speech API)는 보안 컨텍스트에서만 동작한다.

1. `cloudflared` 실행 방식 확인
   ```
   systemctl is-active cloudflared                                   # active → 호스트 서비스
   docker ps --format '{{.Names}} {{.Image}}' | grep -i cloudflared  # 출력 → 도커 컨테이너
   ```
2. Cloudflare Zero Trust → Networks → Tunnels → 터널 선택 → Public Hostname → Add
   - Subdomain: `momo` (예), Domain: 보유 도메인
   - Service Type: `HTTP`
   - URL: 호스트 서비스면 `127.0.0.1:8080`.
     도커 컨테이너면 `deploy/.env`에 `WEB_BIND=0.0.0.0:8080`을 두고 `docker compose up -d` 후, URL을 `<파이 LAN IP 또는 Tailscale IP>:8080`으로. (컨테이너 안의 127.0.0.1은 파이 호스트가 아니다)
3. Cloudflare 대시보드 → Speed → Optimization: **Rocket Loader 끔, Auto Minify(JS) 끔**. ES module·WASM 로드를 깨뜨릴 수 있다.
   `/models/`에 "Cache Everything" 규칙을 걸지 않는다. 3GB 파일은 Cloudflare가 캐시하지 않고 통과시키며 Range 요청도 통과한다.
4. 확인
   ```
   curl -s https://momo.<도메인>/api/health
   curl -I -H "Range: bytes=0-1023" https://momo.<도메인>/models/gemma4-e4b-it-web.litertlm   # 206 기대
   ```
   브라우저에서 열면 플레이스홀더 페이지가 뜬다.

- 터널 대역폭은 파이 업링크가 한계다. 데모 노트북은 리허설 때 모델을 미리 받아 캐시해 둔다.
- Tailscale IP로 직접 열려면 `WEB_BIND=0.0.0.0:8080`이 필요하다(기본은 127.0.0.1). 외부 노출은 터널로만 되므로 0.0.0.0 바인딩도 안전하다.

## GHCR 이미지 사용 (선택)
CI(`.github/workflows/ci.yml`)가 main push마다 arm64 이미지를 `ghcr.io/4this/woo-momo-{web,api}`로 푸시한다.
파이에서 빌드하지 않고 받아 쓰려면:
```
docker login ghcr.io          # read:packages 토큰
cd ~/Woo-MoMo-Project/deploy
docker compose pull
docker compose up -d
```
CI가 돌지 않거나 조직 패키지 권한이 없으면 이 방법은 실패한다. 그때는 위의 `--build` 방식을 쓴다.

## 확인
```
curl -s http://127.0.0.1:8080/api/health
curl -s http://127.0.0.1:8080/api/manifest | head -c 200
curl -I -H "Range: bytes=0-1023" http://127.0.0.1:8080/models/gemma4-e4b-it-web.litertlm   # 206 기대
```

`/models/`가 404면 볼륨이 비어 있거나 파일명이 `manifest.json`의 `url`과 다른 것이다.

## 로컬 스모크 테스트

실제 모델 파일 없이 배포 구성을 검증한다. 더미 파일로 `/models/` Range 서빙과 API 헬스체크를 확인한다.

```
mkdir -p /tmp/momo-models
dd if=/dev/zero of=/tmp/momo-models/gemma4-e4b-it-web.litertlm bs=1M count=8

# deploy/docker-compose.local.yml은 web.volumes를 ./models(더미 볼륨)로 덮어쓴다
cd deploy
mkdir -p models
cp /tmp/momo-models/gemma4-e4b-it-web.litertlm models/
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d

curl -I -H "Range: bytes=0-1023" http://127.0.0.1:8080/models/gemma4-e4b-it-web.litertlm   # 206 기대
curl -s http://127.0.0.1:8080/   # 플레이스홀더 HTML 기대

docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

`deploy/models/`와 `*.litertlm`은 이미 루트 `.gitignore`에 걸려 있어 커밋되지 않는다.

## 로컬에서 직접 빌드(arm64 크로스)
```
docker buildx build --platform linux/arm64 -f deploy/api.Dockerfile -t ghcr.io/4this/woo-momo-api:latest backend
docker buildx build --platform linux/arm64 -f deploy/web.Dockerfile -t ghcr.io/4this/woo-momo-web:latest .
```
