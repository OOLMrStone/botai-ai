"""Local dev launcher, so `python main.py` and the PyCharm run button work.

The real application lives in `app/main.py`; docker compose and any process
manager should target `app.main:app` directly.
"""

from __future__ import annotations

import uvicorn

from app.config import get_settings


def run() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.app.host,
        port=settings.app.port,
        reload=not settings.app.is_prod,
        log_config=None,  # app.core.logging owns handler setup
    )


if __name__ == "__main__":
    run()
