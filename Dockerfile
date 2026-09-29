FROM python:3.14-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv
COPY requirements.txt ./
RUN pip install -r requirements.txt

FROM base AS dev
COPY requirements-dev.txt ./
RUN pip install -r requirements-dev.txt
COPY pyproject.toml ./
COPY app ./app
COPY tasks/common/prompts ./prompts/common
COPY prompts/legacy ./prompts/legacy
COPY tasks/14/prompts ./prompts/14
COPY tasks/15/prompts ./prompts/15
COPY tasks/16/prompts ./prompts/16
COPY tasks/17/prompts ./prompts/17
COPY tasks/18/prompts ./prompts/18
COPY tasks/19/prompts ./prompts/19
COPY tasks/20/prompts ./prompts/20
COPY scripts/validate_response.py ./scripts/validate_response.py
COPY tests ./tests
COPY deploy/build_runtime.py ./deploy/build_runtime.py
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "/srv/app"]

FROM base AS prod
COPY app ./app
COPY tasks/common/prompts ./prompts/common
COPY prompts/legacy ./prompts/legacy
COPY tasks/14/prompts ./prompts/14
COPY tasks/15/prompts ./prompts/15
COPY tasks/16/prompts ./prompts/16
COPY tasks/17/prompts ./prompts/17
COPY tasks/18/prompts ./prompts/18
COPY tasks/19/prompts ./prompts/19
COPY tasks/20/prompts ./prompts/20
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /srv/data/suspicious-submissions \
    && chmod 700 /srv/data/suspicious-submissions \
    && chown appuser:appuser /srv/data/suspicious-submissions
# Code and prompts remain owned by root; only reports are writable.
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
