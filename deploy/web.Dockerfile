# 1단계: 프론트 빌드. frontend/package.json이 없으면 플레이스홀더만 복사한다.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY deploy/placeholder /out
COPY frontend* /src/frontend/
RUN if [ -f /src/frontend/package.json ]; then \
      corepack enable && cd /src/frontend && pnpm install --frozen-lockfile && pnpm build \
      && rm -rf /out && cp -r dist /out; \
    fi

# 2단계: nginx
FROM nginx:1.27-alpine
COPY deploy/nginx-http.conf /etc/nginx/conf.d/00-limits.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html
RUN mkdir -p /usr/share/nginx/models
EXPOSE 80
