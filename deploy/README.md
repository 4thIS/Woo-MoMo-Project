# 배포 (라즈베리파이, docker-compose)

## 최초 1회
1. 모델 파일을 `/srv/momo/models/`에 복사한다 (`backend/data/manifest.json`의 `url` 파일명과 일치).
2. `deploy/` 디렉터리를 파이로 복사한다.
3. `docker login ghcr.io` (읽기 토큰).

## 바인딩 (`WEB_BIND`)

`web` 컨테이너는 기본적으로 파이에 이미 떠 있는 리버스 프록시 뒤에 숨는다.
기본값은 `WEB_BIND=127.0.0.1:8080` — 컨테이너의 80 포트를 로컬호스트 8080에만 바인딩한다.
기존 리버스 프록시(도메인·TLS 종료)가 `http://127.0.0.1:8080`을 upstream으로 바라보게 설정하면 된다.

이 컨테이너 자체가 엣지(공인 IP에 직접 노출)라면 `deploy/.env`에 다음을 두고 배포한다.
```
WEB_BIND=0.0.0.0:80
```

## 배포/갱신
```
cd deploy
docker compose pull
docker compose up -d
```

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
