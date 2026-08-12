FROM python:3.14-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

# Dependency layer first so code edits do not invalidate it.
COPY requirements.txt requirements-dev.txt ./
RUN pip install -r requirements.txt

# ---------------------------------------------------------------------------
# dev target: extra tooling + source mounted as a volume by docker compose
# ---------------------------------------------------------------------------
FROM base AS dev
RUN pip install -r requirements-dev.txt
# pyproject carries the pytest config (asyncio_mode, testpaths); without it the
# suite silently skips every async test inside the container.
COPY pyproject.toml ./
COPY app ./app
COPY prompts ./prompts
COPY tests ./tests
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/srv/app"]

# ---------------------------------------------------------------------------
# prod target: no dev deps, non-root, no reloader
# ---------------------------------------------------------------------------
FROM base AS prod
COPY app ./app
COPY prompts ./prompts
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /srv
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
