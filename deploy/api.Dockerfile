FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY data ./data

# /data: 계정 DB·녹음(호스트 볼륨이 덮는다). 호스트 폴더도 uid 10001 소유여야 쓸 수 있다.
RUN useradd -r -u 10001 app && mkdir -p /data && chown -R app:app /app /data

ENV PATH="/app/.venv/bin:$PATH" MOMO_DATA_DIR=/app/data DATA_DIR=/data
EXPOSE 8000
USER app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
