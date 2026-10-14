# syntax=docker/dockerfile:1
# 1단계: 프론트 빌드. 빌드 머신 아키텍처로 돈다(산출물은 정적 파일이라 arm64와 무관).
# 의존성 파일만 먼저 복사해 설치한다 — 소스만 바뀌면 설치 층을 캐시에서 그대로 쓴다.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src/frontend
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
# postinstall(wasm 복사)이 scripts/를 쓴다
COPY frontend/scripts ./scripts
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY frontend ./
RUN pnpm build

# 2단계: nginx
FROM nginx:1.27-alpine
COPY deploy/nginx-http.conf /etc/nginx/conf.d/00-limits.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html
RUN mkdir -p /usr/share/nginx/models
EXPOSE 80
