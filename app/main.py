"""ASGI entry point; the reusable factory does not read environment on import."""
from app.application import create_app, lifespan

app = create_app()
