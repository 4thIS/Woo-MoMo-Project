# 배포 (라즈베리파이, docker-compose)

## 최초 1회
1. 모델 파일을 `/srv/momo/models/`에 복사한다 (`backend/data/manifest.json`의 `url` 파일명과 일치).
2. `deploy/` 디렉터리를 파이로 복사한다.
3. `docker login ghcr.io` (읽기 토큰).

## 배포/갱신
```
cd deploy
docker compose pull
docker compose up -d
```

## 확인
```
curl -s http://localhost/api/health
curl -s http://localhost/api/manifest | head -c 200
curl -I -H "Range: bytes=0-1023" http://localhost/models/gemma4-e4b-it-web.litertlm   # 206 기대
```

## 로컬에서 직접 빌드(arm64 크로스)
```
docker buildx build --platform linux/arm64 -f deploy/api.Dockerfile -t ghcr.io/4this/woo-momo-api:latest backend
docker buildx build --platform linux/arm64 -f deploy/web.Dockerfile -t ghcr.io/4this/woo-momo-web:latest .
```
