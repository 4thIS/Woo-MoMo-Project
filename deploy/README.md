# 배포 (라즈베리파이, docker-compose)

파이에는 리포를 **git clone**해서 올리고, 이미지는 파이에서 직접 빌드한다(GHCR 불필요).
프론트 빌드 산출물이 없어도 `web` 이미지는 플레이스홀더 페이지로 기동한다.

## 최초 1회
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
