# 배포 (라즈베리파이, docker-compose)

> **2026-10-18 서버 이전:** 라즈베리파이(arm64)에서 `myserver`(Ubuntu, x86_64, Tailscale `ssenu@myserver`)로 옮겼다. 폴더 구조(`/srv/apps/Woo-MoMo-Project`, `/srv/apps/Woo-MoMo-Project-dev`, `/srv/momo-dev/data`)와 compose 프로젝트 이름은 그대로다. 아래 "파이"는 배포 서버로 읽는다.

배포 서버에는 리포를 **git clone**해서 올린다. 이미지는 CI가 **amd64**로 빌드해 GHCR에 올리고(main=`:latest`, dev=`:dev`), 서버는 받기만 한다.
demomo(dev)는 자동 재배포 타이머가 2분마다 확인해 반영한다(아래 "자동 재배포"). 파이에서 직접 빌드(`--build`)도 여전히 된다.

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

### TTS 모델 파일 배치 (Supertonic 3, 엔진 약 398MB + 목소리 10개 약 2.9MB)
파이 서빙으로 복귀할 때 쓴다(현재 파일은 배치돼 있음). 매니페스트 `tts.baseUrl`을 `/models/tts/supertonic-3/`로 되돌리면, 그 경로·`files[].path`와 일치해야 한다.
```
mkdir -p /srv/momo/models/tts/supertonic-3/onnx /srv/momo/models/tts/supertonic-3/voice_styles
cd /srv/momo/models/tts/supertonic-3
B=https://huggingface.co/Supertone/supertonic-3/resolve/3cadd1ee6394adea1bd021217a0e650ede09a323  # 매니페스트 크기와 같은 고정 커밋
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

## 계정·보관함·벤 (2026-10-13~)

계정 DB(sqlite)와 녹음 파일은 api 컨테이너의 `/data`에 쌓이고, 호스트 폴더를 볼륨으로 붙인다. 설계: `docs/specs/backend/2026-10-13-accounts-backend-design.md`.

| 환경 | 클론 폴더 | 호스트 데이터 폴더 | `deploy/.env` |
|---|---|---|---|
| demomo(dev) | `/srv/apps/Woo-MoMo-Project-dev` | `/srv/momo-dev/data` | `COMPOSE_PROJECT_NAME=momo-dev`, `WEB_BIND=127.0.0.1:8081`, `DATA_HOST_DIR=/srv/momo-dev/data` |
| momo(운영) | `/srv/apps/Woo-MoMo-Project` | `/srv/momo/data` | `COMPOSE_PROJECT_NAME=deploy`, `WEB_BIND=127.0.0.1:8006` (`DATA_HOST_DIR`은 기본값이라 안 적는다) — **지시 전까지 반영하지 않는다** |

폴더마다 `deploy/.env`에 `COMPOSE_PROJECT_NAME`과 `WEB_BIND`가 들어 있으므로, 어느 폴더에서든 `docker compose up --build -d`만 쳐도 서로의 컨테이너를 건드리지 않는다.

### 데이터 폴더 (최초 1회, 첫 기동 전)
api 컨테이너는 uid 10001로 돈다. 호스트 폴더를 먼저 만들고 그 uid 소유로 준다(안 하면 api가 `/data`에 쓰지 못한다).
```
sudo mkdir -p /srv/momo/data /srv/momo-dev/data && sudo chown -R 10001:10001 /srv/momo/data /srv/momo-dev/data
```

### `deploy/.env` 항목 (커밋 금지 — `.gitignore`가 막는다)

| 키 | 예 | 설명 |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | 운영 `deploy` / dev `momo-dev` | compose 프로젝트 이름. 폴더마다 다르게 둬 컨테이너·네트워크가 섞이지 않게 한다 |
| `WEB_BIND` | `127.0.0.1:8006` | web 바인딩(주소:포트). 폴더마다 다른 포트 |
| `DATA_HOST_DIR` | `/srv/momo-dev/data` | 호스트의 데이터 폴더(dev만 적는다). 없으면 `/srv/momo/data` |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | 벤(Claude) 키. 없으면 벤 시작이 `503 ben_unavailable` |
| `ADMIN_LOGIN` | `admin` | 관리자 아이디. **이메일 모양이 아닌 아이디**로 둔다. 이메일 값이 기존 사용자와 같으면 그 사용자가 관리자로 바뀐다. 목업 결제는 이 계정만 |
| `ADMIN_PASSWORD` | (긴 무작위 문자열) | **`.env`에만 둔다. 추측하기 쉬운 값 금지.** 공개 사이트라 약하면 누구나 티켓을 충전해 하루 `BEN_DAILY_LIMIT`번까지 Claude 비용을 쓸 수 있다. `$`는 쓰지 않는다(compose가 변수로 읽는다) |
| `BEN_DAILY_LIMIT` | `30` | 서버 전체 하루(한국 날짜) 벤 면접 수 상한. 마지막 방어선 |
| `CORS_ORIGINS` | 운영 `https://momo.ssenu.cloud` / dev `https://demomo.ssenu.cloud,http://localhost:5173` | **폴더마다 자기 오리진만 둔다.** 정확한 오리진만, 쉼표로. `*` 금지(기동 실패). 비우면 코드 기본값(셋 다)이 들어가니 꼭 적는다. 두 도메인이 같은 site(`ssenu.cloud`)라 `SameSite=Lax` 쿠키가 서로의 요청에도 실리므로, 한쪽 오리진을 다른 쪽 API에 열어 두면 dev 페이지가 로그인된 운영 계정으로 요청을 보낼 수 있다 |
| `COOKIE_SECURE` | `1` | 세션 쿠키 `Secure`. HTTPS 뒤라 `1` 유지 |

`ADMIN_LOGIN`·`ADMIN_PASSWORD` 중 하나라도 비우면 다음 기동 때 관리자 표시가 지워지고 목업 결제는 아무도 못 쓴다. 비밀번호를 바꾸려면 `.env`를 고치고 `docker compose up -d`로 api를 다시 띄운다(기동 때 맞춘다).

### 벤 리포트 버전 2 켜기 (`BEN_REPORT_V2`)

기본은 꺼짐(`false`)이다. 켜면 리포트 원문이 JSON 객체(구조화 출력)라 예전 프론트의 리포트 파서가 읽지 못한다. **프론트의 버전 2 리포트 화면이 배포된 뒤에만** 켠다.
```
# deploy/.env 에 한 줄 추가
BEN_REPORT_V2=true
docker compose up -d --no-build     # api만 다시 뜬다. 끄려면 false(또는 줄 삭제) 후 같은 명령
```
이미 만든 리포트는 켜고 꺼도 그대로 다시 받을 수 있다.

### 반영(demomo)
```
cd /srv/apps/Woo-MoMo-Project-dev/deploy
git pull
docker compose config -q && docker compose config | grep -E "DATA_DIR|/data"   # 볼륨·환경변수 확인
docker compose up -d --build
docker compose exec web nginx -t                  # nginx 설정을 바꿨다면 문법 확인
curl -s https://demomo.ssenu.cloud/api/health
curl -s https://demomo.ssenu.cloud/api/me        # null
ls -l /srv/momo-dev/data                          # momo.sqlite3, recordings/
```
수동 확인(spec 8절): 가입 → 이력서 저장 → 보관함 6번째 저장에 가장 오래된 기록 자동 삭제 → 관리자 로그인 → 목업 결제 → 벤 1회 완주(실제 Claude) → 리포트 → 보관함 저장 → 녹음 재생.

### 백업 (수동 — 자동화는 다음 단계)
DB는 실행 중에도 sqlite 백업 API로 안전하게 복사한다. 녹음은 파일 그대로 복사한다.
```
sudo install -d /srv/momo-dev/backup
cd /srv/apps/Woo-MoMo-Project-dev/deploy
docker compose exec api python -c "import sqlite3; s=sqlite3.connect('/data/momo.sqlite3'); d=sqlite3.connect('/data/backup.sqlite3'); s.backup(d); d.close(); s.close()"
sudo mv /srv/momo-dev/data/backup.sqlite3 /srv/momo-dev/backup/momo-$(date +%F).sqlite3
sudo rsync -a /srv/momo-dev/data/recordings/ /srv/momo-dev/backup/recordings/
```
호스트에 `sqlite3`가 있으면 `sqlite3 /srv/momo-dev/data/momo.sqlite3 ".backup '/srv/momo-dev/backup/momo-$(date +%F).sqlite3'"`도 된다.

복원: `docker compose stop api` → 백업 파일을 `/srv/momo-dev/data/momo.sqlite3`로 복사(같은 폴더의 `momo.sqlite3-wal`·`momo.sqlite3-shm`은 지운다) → `sudo chown 10001:10001 /srv/momo-dev/data/momo.sqlite3` → `docker compose start api`. 기동 때 DB에 없는 녹음 파일은 자동으로 지워진다.

### nginx
`/api/recordings`와 `/api/premium/interviews/{id}/voice/…`(목소리 분석 WAV)만 요청 크기 6MB(`client_max_body_size 6m`), 나머지 `/api/`는 기본 1MB. 벤 스트림(SSE)은 앱이 `X-Accel-Buffering: no`로 버퍼링을 끄고, `/api/`의 `proxy_read_timeout`은 300초다. nginx 설정을 바꾼 뒤에는 `docker compose exec web nginx -t`로 문법을 확인한다(`--build`로 web을 다시 띄운 다음).

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
CI(`.github/workflows/ci.yml`)가 main push마다 amd64 이미지를 `ghcr.io/4this/woo-momo-{web,api}`로 푸시한다.
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

## 로컬에서 직접 빌드(amd64)
```
docker buildx build --platform linux/amd64 -f deploy/api.Dockerfile -t ghcr.io/4this/woo-momo-api:latest backend
docker buildx build --platform linux/amd64 -f deploy/web.Dockerfile -t ghcr.io/4this/woo-momo-web:latest .
```

## 자동 재배포 (demomo 2026-10-14~, momo 2026-10-31~)

dev에 머지되면 CI가 `ghcr.io/4this/woo-momo-{web,api}:dev`를 올리고, 파이의 사용자 타이머가 2분마다 `deploy/autodeploy/autodeploy.sh`를 돌린다.
스크립트는 ① dev 새 커밋을 fast-forward로 받고 ② 이미지를 pull해서 ③ 둘 중 하나라도 바뀌면 `docker compose up -d --no-build`(바뀐 컨테이너만 재시작) 후 태그 빠진 옛 이미지를 지운다. 파이로 들어오는 경로(웹훅·SSH 키)는 만들지 않는다.
운영(momo)도 같은 스크립트를 쓴다(2026-10-31~). main에 머지되면 CI가 `:latest`를 올리고, 운영 클론의 타이머(`momo-autodeploy.timer`)가 **5분마다** 같은 방식으로 반영한다.

**배포 순서(팀 규칙):** 작업 PR은 항상 `dev`로 머지 → demomo에 자동 반영 → 작업자가 demomo에서 눈으로 확인 → 정상이면 작업자가 `dev → main` PR을 올려 **merge commit**(`gh pr merge <번호> --merge`)으로 머지 → momo에 자동 반영. main에 직접 push하거나 dev를 거치지 않은 PR을 main에 머지하지 않는다.

CI의 이미지 올리기는 같은 브랜치에서 한 번에 하나씩 차례로 돌고, 시작할 때 그 커밋이 아직 브랜치 끝이 아니면 건너뛴다(옛 커밋 이미지가 새 이미지를 덮지 않게).

### 최초 설치 (한 번)
```
# 1) GHCR 로그인 — 리포가 private라 이미지도 private. read:packages 권한만 준 classic 토큰
read -rsp 'token: ' T; echo "$T" | docker login ghcr.io -u ssenu --password-stdin; unset T

# 2) demomo 클론이 :dev 이미지를 쓰게
cd /srv/apps/Woo-MoMo-Project-dev/deploy
grep -q '^IMAGE_TAG=' .env || echo 'IMAGE_TAG=dev' >> .env
docker compose pull && docker compose up -d --no-build

# 3) 타이머 설치 (sudo 불필요, linger=yes라 로그아웃 뒤에도 돈다)
mkdir -p ~/.config/systemd/user
cp autodeploy/momo-dev-autodeploy.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now momo-dev-autodeploy.timer

# 4) 운영(momo) 타이머 — 운영 클론은 main을 따라가고, .env에 IMAGE_TAG가 없어 :latest를 쓴다
cp /srv/apps/Woo-MoMo-Project/deploy/autodeploy/momo-autodeploy.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now momo-autodeploy.timer
```

### 확인·운영
```
systemctl --user list-timers momo-dev-autodeploy.timer     # 다음 실행 시각
journalctl --user -u momo-dev-autodeploy -n 50              # 최근 실행 로그(바뀐 게 없으면 조용하다)
systemctl --user start momo-dev-autodeploy                  # 지금 바로 한 번
systemctl --user disable --now momo-dev-autodeploy.timer    # 끄기
# 운영은 같은 명령에서 이름만 momo-autodeploy로 바꾼다
journalctl --user -u momo-autodeploy -n 50
```
- CI 빌드가 끝나기 전에 커밋을 먼저 받으면, 이미지는 다음 확인 때 바뀐다(머지 후 보통 5분 안쪽 반영).
- 유닛 파일을 고쳤으면 다시 `cp` 후 `daemon-reload`.

## 관리자 대시보드 (2026-10-17~)

관리자 화면(`/admin`)과 관리자 API(`/api/admin/*`)는 **관리자 계정만** 쓸 수 있다. 관리자는 두 가지 방법으로 정해진다.

- `ADMIN_EMAILS`에 적힌 이메일의 계정: **목록 반영은 재기동 때만** 이뤄진다(가입만으로는 관리자가 되지 않는다). 목록에서 빼면 재기동 때 관리자 권한이 해제된다.
- `ADMIN_LOGIN` / `ADMIN_PASSWORD`(비상용): 기존 방식 그대로 유지한다. 이메일 목록이 망가졌을 때 들어가는 통로다.

Cloudflare Access는 바깥 1차 관문이고, 서버는 관리자 권한을 따로 검사한다(2차). Access만 믿지 않는다.

### `ADMIN_EMAILS` 설정 (`deploy/.env`, 커밋 금지)

순서가 중요하다. 가입에는 이메일 인증이 없어서, 목록에 먼저 넣으면 아직 가입 안 한 그 이메일을 **남이 먼저 가입해 선점**할 수 있다. 그래서 반드시 이 순서로 한다.

1. **본인이 먼저 그 이메일로 가입한다.**
2. **계정이 본인 것인지 확인한다**(그 이메일·비밀번호로 로그인해 본다).
3. **`ADMIN_EMAILS`에 추가한다.**
4. **`docker compose up -d --no-build`** 로 api를 재기동한다(이때 관리자로 반영).

demomo와 momo는 DB가 따로라 각각 먼저 가입해야 한다.

쉼표로 구분한 이메일 목록이다. `.env`는 `.gitignore`가 막으니 직접 편집한다.

demomo(dev)와 momo(운영)의 `deploy/` 폴더에서 각각 실행한다.
```
cd /srv/apps/Woo-MoMo-Project-dev/deploy      # 운영은 /srv/apps/Woo-MoMo-Project/deploy
grep -q '^ADMIN_EMAILS=' .env || echo 'ADMIN_EMAILS=me@example.com,partner@example.com' >> .env
grep '^ADMIN_EMAILS=' .env                     # 값 확인
docker compose up -d --no-build                # 재기동해야 반영된다
```
- `grep -q`로 이미 있는 줄은 덧붙이지 않는다. 값을 바꾸려면 `.env`를 직접 열어 고친다.
- 위 예시의 이메일은 자리표시자다. 실제 주소는 `.env`에만 쓰고 README나 커밋에는 적지 않는다.
- `--no-build`: 이미지를 다시 빌드하지 않고 `.env` 변경만 반영한다(demomo 자동 재배포와 같은 방식).

### 비상용 관리자 비밀번호

- `ADMIN_PASSWORD`는 **12자 이상**을 권장한다. 12자 미만이면 관리자 화면이 경고를 띄운다.
- 공개 사이트라 약한 비밀번호는 누구나 추측할 수 있다. 추측되면 티켓을 충전해 Claude 비용을 쓸 수 있다.
- `$`는 쓰지 않는다(compose가 변수로 읽는다). 비밀번호에 `|`와 `&`도 쓰지 않는다(아래 `sed` 명령에서 구분자·치환 문자로 쓰인다).

비밀번호를 바꿀 때는 입력값이 화면이나 셸 기록에 남지 않도록 `read -rsp`로 받는다.
```
cd /srv/apps/Woo-MoMo-Project-dev/deploy
cp .env .env.bak-$(date +%F)                   # 실패하면 되돌릴 백업
read -rsp '새 관리자 비밀번호: ' P; echo
sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$P|" .env
unset P
grep -c '^ADMIN_PASSWORD=' .env                # 1 이면 줄이 한 개 남아 있다
docker compose up -d --no-build
```
- 백업 파일도 비밀번호를 담고 있으니 확인이 끝나면 지운다.

### Cloudflare Access 설정 (관리자 화면 앞단)

Access는 로그인하지 않은 요청을 Cloudflare 로그인 화면으로 보낸다. 대시보드에서 아래 순서로 만든다.

1. Cloudflare 대시보드 → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**
2. Application name: `momo-admin-demomo` (예). Session duration은 기본값으로 둔다.
3. Application domain: 도메인 `demomo.ssenu.cloud`, 경로(Path) **`admin`** 과 **`api/admin`** 을 **둘 다** 추가한다(경로마다 한 줄씩 Add).
4. **Policy**: 이름은 자유, Action은 **Allow**.
   - Include → **Emails**: 본인과 공동 개발자 이메일을 넣는다. 또는
   - Include → **GitHub organization**: `4thIS`. 이 옵션은 Zero Trust의 Login methods에 GitHub를 먼저 추가해야 보인다.
5. 저장한다.
6. momo 운영 배포 때 같은 절차를 `momo.ssenu.cloud` 도메인(경로 `admin`, `api/admin`)으로 한 번 더 한다. 운영은 지시가 있을 때만 한다.

확인:
```
curl -sI https://demomo.ssenu.cloud/api/admin/overview
# 기대: HTTP/2 302 와 Location에 Cloudflare Access 로그인 주소
# JSON이 바로 나오면 Access 정책이 적용되지 않은 것이다(Application 경로·도메인 확인)
curl -sI https://demomo.ssenu.cloud/admin
# 기대: 마찬가지로 302 + Cloudflare Access 로그인 주소
```
- `/api/premium/purchase`(목업 결제)는 Access 경로 밖이다. 서버가 관리자인지 검사해 막는다(관리자 전용).
- Access 로그인을 통과한 뒤에도 관리자 API는 서버가 관리자 여부를 다시 검사한다. 관리자가 아닌 계정은 Access를 통과해도 403이 난다.

## 목소리 분석 (BAZE, 2026-10-23~)

벤 면접에서 사용자가 목소리 분석에 동의한 경우에만, 답변 녹음을 학교 BAZE 게이트웨이(Google Gemini)로 보내 받아쓰기·말하기 지표를 얻는다. 동의하지 않은 면접과 비로그인 사용자는 이 경로를 타지 않는다.

### `.env` 항목 (커밋 금지)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `BAZE_API_KEYS` | (없음) | 학교 키를 쉼표로 구분해 넣는다. 앞 키부터 쓰고, 소진되면 다음 키로 넘어간다. |
| `BAZE_VOICE_MODEL` | `gemini-3.8-flash` | 분석에 쓰는 모델 이름. |
| `BAZE_MIN_REMAINING` | `50` | 키의 남은 크레딧이 이 값 미만이면 그 키는 `low`가 되어, 쓸 수 있는 키(`ok`)가 있는 동안은 건너뛴다. `ok` 키가 하나도 없을 때만 마지막 수단으로 `low` 키를 쓴다. |

키는 셸 기록이나 화면에 남지 않게 `read -rsp`로 넣는다.

```
cd /srv/apps/Woo-MoMo-Project-dev/deploy      # 운영은 /srv/apps/Woo-MoMo-Project/deploy
read -rsp 'BAZE 키들(쉼표로 구분): ' K; echo
sed -i '/^BAZE_API_KEYS=/d' .env
printf 'BAZE_API_KEYS=%s\n' "$K" >> .env
unset K
chmod 600 .env
docker compose up -d --no-build
```

- 키를 바꾼 뒤에도 같은 순서로 다시 넣는다. 이전 줄은 `sed`가 지운다.
- `docker compose up -d --no-build`는 이미지를 새로 빌드하지 않고 환경 변수만 반영한다.

### 키 상태와 동작

- 키는 값으로 표시하지 않고 순번(키 1, 키 2 …)으로만 식별한다. 로그에도 키 값은 남지 않는다.
- 잔액은 기동 시와 30분마다 확인한다.
- 402(크레딧 부족): 그 키는 매월 1일 갱신 때까지 건너뛴다.
- 401(인증 실패): 그 키는 서버를 재시작할 때까지 건너뛴다. 키를 고쳐 넣은 뒤에는 재시작이 필요하다.
- 쓸 수 있는 키가 하나도 없으면 목소리 분석은 꺼진다. 면접은 계속되고, 리포트는 브라우저에서 잰 지표만으로 만든다.

### 개인정보

- 분석 대상은 목소리 분석에 동의한 벤 면접의 답변 녹음뿐이다(면접 단위 동의, `voiceAnalysisConsent`).
- 서버의 임시 녹음은 `DATA_DIR/voice_tmp`에 저장되고 분석이 끝나면 바로 지운다.
- nginx는 녹음 업로드 경로에만 `client_max_body_size 6m`을 허용한다. 나머지 `/api/`는 기본 1MB를 그대로 쓴다.

### 잔액 확인 (키 값 출력 없음)

`.env`를 읽어 각 키의 순번과 남은 크레딧만 출력한다. 키 값은 화면에 나오지 않는다.

```
python3 -c "import json,urllib.request as u; L=[l.strip().split('=',1)[1] for l in open('.env') if l.startswith('BAZE_API_KEYS=')]; ks=[k.strip() for k in (L[0] if L else '').split(',') if k.strip()]; [print('키', i+1, json.load(u.urlopen(u.Request('https://factchat-cloud.mindlogic.ai/v1/gateway/credits/', headers={'Authorization': 'Bearer '+k, 'User-Agent': 'woo-momo/1.0'})))['total']['remaining']) for i,k in enumerate(ks)]"
```

- 출력은 `키 1 <남은 크레딧>` 형태다. 응답 형식이 바뀌었거나 키가 틀리면 예외 메시지가 나올 수 있으니, 그 메시지에 키 값이 섞이지 않았는지 확인한다.

## 가입 이메일 인증 (2026-10-27~)

가입할 때 메일로 6자리 인증번호(PIN)를 보내고, 맞게 입력한 뒤에만 계정을 만든다. 메일은 개인 메일 API(`send.ssenu.cloud`)로 보낸다.

### `.env` 항목 (커밋 금지)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SIGNUP_EMAIL_VERIFY` | `false` | `true`로 켜면 가입에 인증번호가 필요하다. 꺼져 있으면 가입은 예전과 같다. |
| `MAIL_API_KEY` | (없음) | 메일 API 키. |
| `MAIL_API_URL` | `https://send.ssenu.cloud/v1/send` | 발송 주소. |

키는 셸 기록이나 화면에 남지 않게 `read -rsp`로 넣는다.

```
cd /srv/apps/Woo-MoMo-Project-dev/deploy      # 운영은 /srv/apps/Woo-MoMo-Project/deploy
read -rsp 'MAIL_API_KEY: ' K; echo; sed -i '/^MAIL_API_KEY=/d' .env; printf 'MAIL_API_KEY=%s\n' "$K" >> .env; unset K; chmod 600 .env
docker compose up -d --no-build
```

### 켜는 순서

1. 백엔드를 꺼진 채(`SIGNUP_EMAIL_VERIFY=false`)로 먼저 배포하고 `MAIL_API_KEY`를 넣는다.
2. 프론트의 인증번호 입력 화면을 배포한다.
3. 그다음 `SIGNUP_EMAIL_VERIFY=true`로 바꾸고 `docker compose up -d --no-build`.

- 켰는데 `MAIL_API_KEY`가 비어 있으면 인증번호 요청이 `503 mail_unavailable`이 되어 가입이 막힌다. 설정 실수로 인증이 조용히 빠지지 않게 한 것이다.
- 로그에는 인증번호·메일 주소·키가 남지 않는다.

### 가입 약관 동의 (2026-10-28~)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `SIGNUP_TERMS_REQUIRED` | `false` | `true`로 켜면 가입 요청에 `termsAgreed: true`가 있어야 한다(없으면 `422 terms_required`). 꺼져 있어도 `termsAgreed`를 보내면 약관 버전·시각이 저장된다. |

켜는 순서: 백엔드를 꺼진 채로 먼저 배포 → 프론트의 약관 동의 화면 배포 → `SIGNUP_TERMS_REQUIRED=true`로 바꾸고 `docker compose up -d --no-build`. 프론트보다 먼저 켜면 예전 가입 화면은 가입이 막힌다.

가입 비밀번호 규칙(8~64자·영문+숫자)은 설정 없이 바로 적용된다.
